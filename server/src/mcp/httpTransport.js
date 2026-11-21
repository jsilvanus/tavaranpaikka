import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';

function methodNotAllowed() {
  return {
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed.' },
    id: null,
  };
}

/**
 * Create Express router mounting MCP Streamable HTTP endpoint.
 *
 * @param {{
 *   db: import('../db.js').DbClient,
 *   storage: import('../storage.js').ObjectStorage,
 *   config: import('../config.js').AppConfig
 * }} deps
 * @returns {import('express').Router}
 */
export function createMcpRouter({ db, storage, config }) {
  const router = express.Router();
  let cachedDefaultOrgId = '';

  router.head('/mcp', (_req, res) => {
    res.status(200).end();
  });

  router.get('/mcp', (_req, res) => {
    res.status(405).json(methodNotAllowed());
  });

  router.delete('/mcp', (_req, res) => {
    res.status(405).json(methodNotAllowed());
  });

  router.post('/mcp', async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      let defaultOrgId = ctx?.organizationId || cachedDefaultOrgId;

      if (!defaultOrgId) {
        const orgRes = await db.query('SELECT id FROM organizations WHERE slug = $1', [
          config.defaultOrganizationSlug,
        ]);
        if (orgRes.rows.length > 0) {
          cachedDefaultOrgId = orgRes.rows[0].id;
          defaultOrgId = cachedDefaultOrgId;
        }
      }

      const mcpServer = createMcpServer({
        db,
        storage,
        config,
        defaultOrgId,
        defaultLocale: ctx?.locale || config.defaultLocale,
      });

      const transport = new StreamableHTTPServerTransport({});
      // @ts-ignore
      await mcpServer.connect(transport);

      res.on('close', () => {
        transport.close().catch(() => {});
        mcpServer.close().catch(() => {});
      });

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
