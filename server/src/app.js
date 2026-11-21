import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import pino from 'pino';
import client from 'prom-client';
import { getBasePath } from './config.js';
import { AppError } from './errors.js';
import { createLabelRouter } from './labels/router.js';
import { authMiddleware, requireRole } from './middleware/auth.js';
import { contextMiddleware } from './middleware/context.js';
import {
  getLabelTargets,
  markCodesPrinted,
  resolveLabelTargets,
} from './repositories/codesRepo.js';
import {
  resolveLogoKeyForCode,
  resolveLogoKeyForTarget,
} from './repositories/storagesRepo.js';
import { createAuthRouter } from './routes/auth.js';
import { createKeeperRouter } from './routes/keeper.js';
import { createPublicRouter } from './routes/public.js';
import { createOpenApiRouter } from './openapi.js';
import { createMcpRouter } from './mcp/httpTransport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST_DIR = path.resolve(__dirname, '../../client/dist');

/**
 * Inject `<base href="...">` and `window.__BASE_PATH__` into built client HTML.
 * @param {string} html
 * @param {string} basePath
 * @returns {string}
 */
export function injectBasePathIntoHtml(html, basePath) {
  const cleanBase = (basePath || '').replace(/\/+$/, '');
  const baseHref = `${cleanBase}/`;
  const injection = `<base href="${baseHref}" /><script>window.__BASE_PATH__ = ${JSON.stringify(cleanBase)};</script>`;
  if (html.includes('<head>')) {
    return html.replace('<head>', `<head>\n    ${injection}`);
  }
  return html.replace(/<head([^>]*)>/i, `<head$1>\n    ${injection}`);
}

/**
 * Create the configured Express 5 application.
 * @param {{
 *   db: import('./db.js').DbClient,
 *   config: import('./config.js').AppConfig,
 *   storage: import('./storage.js').ObjectStorage,
 *   logger?: import('pino').Logger
 * }} deps
 * @returns {import('express').Express}
 */
export function createApp({ db, config, storage, logger }) {
  const log =
    logger ||
    pino({
      level: config.nodeEnv === 'test' ? 'silent' : config.logLevel,
    });

  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });

  const httpRequestsTotal = new client.Counter({
    name: 'tavaranpaikka_http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'status'],
    registers: [registry],
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(express.json({ limit: '1mb' }));

  app.use((req, res, next) => {
    res.on('finish', () => {
      httpRequestsTotal.inc({ method: req.method, status: String(res.statusCode) });
    });
    next();
  });

  const basePath = config.basePath ?? getBasePath(config.baseUrl);

  const healthHandler = async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ ok: true, db: 'ok' });
    } catch {
      res.status(503).json({ ok: false, db: 'error' });
    }
  };

  if (basePath) {
    // Keep root /health alive for container HEALTHCHECK regardless of BASE_URL subpath.
    app.get('/health', healthHandler);
  }

  const mount = express.Router();

  mount.get('/health', healthHandler);

  mount.get('/metrics', async (req, res) => {
    if (config.metricsBearerToken) {
      const authHeader = req.headers.authorization || '';
      if (authHeader !== `Bearer ${config.metricsBearerToken}`) {
        return res
          .status(401)
          .json({ error: { code: 'UNAUTHORIZED', message: 'Invalid metrics token' } });
      }
    }
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  });

  const mcpRouter = createMcpRouter({ db, storage, config });
  mount.use(mcpRouter);
  mount.use('/api', mcpRouter);

  mount.use('/api', authMiddleware(config));
  mount.use('/api', contextMiddleware(db, config));

  mount.use('/api/auth', createAuthRouter({ db, config }));
  mount.use('/api', createPublicRouter({ db, storage, config }));
  mount.use('/api', createOpenApiRouter());
  mount.use('/api', createKeeperRouter({ db, storage, config }));

  const labelRouter = createLabelRouter({
    getTargets: (ctx, filters) => getLabelTargets(db, ctx, filters),
    resolveTargets: (ctx, refs) => resolveLabelTargets(db, ctx, refs),
    markPrinted: (ctx, refs) => markCodesPrinted(db, ctx, refs),
    getBaseUrl: () => config.baseUrl,
    resolveLogoBuffer: async (ctx, target) => {
      const key = await resolveLogoKeyForTarget(db, ctx, target);
      if (!key) return null;
      const obj = await storage.getObject(key);
      return obj?.buffer || null;
    },
    resolveCodeLogoBuffer: async (ctx, code) => {
      const key = await resolveLogoKeyForCode(db, ctx, code);
      if (!key) return null;
      const obj = await storage.getObject(key);
      return obj?.buffer || null;
    },
  });
  mount.use('/api/labels', requireRole('keeper'), labelRouter);

  // Unknown API routes
  mount.use('/api', (_req, _res, next) => {
    next(new AppError(404, 'NOT_FOUND', 'API endpoint not found'));
  });

  // Serve built client in production if present
  if (fs.existsSync(CLIENT_DIST_DIR)) {
    const indexPath = path.join(CLIENT_DIST_DIR, 'index.html');
    const rawIndexHtml = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : null;
    const renderedIndexHtml = rawIndexHtml ? injectBasePathIntoHtml(rawIndexHtml, basePath) : null;

    mount.use(express.static(CLIENT_DIST_DIR, { index: false }));
    mount.get(/^(?!\/api|\/health|\/metrics).*/, (_req, res) => {
      if (renderedIndexHtml) {
        res.type('html').send(renderedIndexHtml);
      } else {
        res.sendFile(indexPath);
      }
    });
  }

  app.use(basePath || '/', mount);

  // Error handler
  app.use(
    /** @type {import('express').ErrorRequestHandler} */ (
      (err, req, res, _next) => {
        if (err instanceof AppError) {
          return res.status(err.statusCode).json({
            error: {
              code: err.code,
              message: err.message,
            },
          });
        }

        if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.parse.failed') {
          return res.status(400).json({
            error: {
              code: 'INVALID_JSON',
              message: 'Invalid JSON request body',
            },
          });
        }

        log.error({ err, path: req.path, method: req.method }, 'Unhandled error');
        res.status(500).json({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
          },
        });
      }
    )
  );

  return app;
}
