import crypto from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { badRequest, notFound, tooManyRequests } from '../errors.js';
import { requireRole } from '../middleware/auth.js';
import { resolvePublicCode } from '../repositories/codesRepo.js';
import { leaseItem, returnItem } from '../repositories/itemsRepo.js';
import { notifyReportCreated } from '../repositories/notificationsRepo.js';
import { createPublicReport, voteReport } from '../repositories/reportsRepo.js';
import { getTenantPrivacy } from '../repositories/privacyRepo.js';
import { getStorageDetail, listStorageSummaries } from '../repositories/storagesRepo.js';

const createReportSchema = z.object({
  itemId: z.string().min(1).nullable().optional(),
  entryId: z.string().min(1).nullable().optional(),
  kind: z.enum(['depleted', 'broken', 'expired', 'other']),
  note: z.string().max(500).optional(),
  name: z.string().max(120).optional(),
});

const leaseSchema = z.object({
  borrowerName: z.string().trim().min(1).max(120),
});

/**
 * Compute a daily-rotating reporter hash from IP + User-Agent.
 * @param {import('express').Request} req
 * @param {string} secret
 * @returns {string}
 */
function computeReporterHash(req, secret) {
  const day = new Date().toISOString().slice(0, 10);
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const ua = req.headers['user-agent'] || '';
  return crypto.createHmac('sha256', `${secret}:${day}`).update(`${ip}|${ua}`).digest('hex');
}

/**
 * Create public API router (mounted at /api).
 * @param {{
 *   db: import('../db.js').DbClient,
 *   storage: import('../storage.js').ObjectStorage,
 *   config: import('../config.js').AppConfig
 * }} deps
 */
export function createPublicRouter({ db, storage, config }) {
  const router = express.Router();

  /** @type {Map<string, number[]>} */
  const rateBuckets = new Map();
  const RATE_WINDOW_MS = 3600_000;
  const RATE_MAX_REQUESTS = 30;

  /**
   * In-memory sliding-window rate limiter keyed by reporter hash + route group.
   * @param {string} routeGroup
   * @returns {import('express').RequestHandler}
   */
  function rateLimit(routeGroup) {
    return (req, _res, next) => {
      const now = Date.now();
      const cutoff = now - RATE_WINDOW_MS;
      const hash = computeReporterHash(req, config.reporterHashSecret);
      const key = `${routeGroup}:${hash}`;

      const timestamps = (rateBuckets.get(key) || []).filter((ts) => ts > cutoff);
      if (timestamps.length >= RATE_MAX_REQUESTS) {
        rateBuckets.set(key, timestamps);
        return next(tooManyRequests('Rate limit exceeded', 'RATE_LIMITED'));
      }

      timestamps.push(now);
      rateBuckets.set(key, timestamps);

      if (rateBuckets.size > 5000) {
        for (const [k, list] of rateBuckets.entries()) {
          const active = list.filter((ts) => ts > cutoff);
          if (active.length === 0) {
            rateBuckets.delete(k);
          } else {
            rateBuckets.set(k, active);
          }
        }
      }

      return next();
    };
  }

  function presentStorageDetail(detail, user) {
    const responsible = detail.responsiblePerson;
    const isResponsible = user?.sub && user.sub === responsible?.sub;
    const emailMatches = user?.email && responsible?.email &&
      String(user.email).toLowerCase() === String(responsible.email).toLowerCase();
    const canSeeCreator = user?.role === 'admin' || isResponsible || emailMatches;
    return { ...detail, createdBy: canSeeCreator ? detail.createdBy : null };
  }

  // Storage browsing requires login; only QR-code (/public/codes/*) views are public.
  router.use('/public/storages', requireRole('member'));
  router.get('/public/storages', async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const kind = typeof req.query.kind === 'string' && req.query.kind ? req.query.kind : undefined;
      const q = typeof req.query.q === 'string' && req.query.q ? req.query.q : undefined;
      const list = await listStorageSummaries(db, ctx, { kind, q, publicOnly: true });
      res.json(list);
    } catch (err) {
      next(err);
    }
  });

  router.get('/public/storages/:id', async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const detail = await getStorageDetail(db, ctx, req.params.id, { publicOnly: true });
      const visibleDetail = presentStorageDetail(detail, req.user || null);
      res.json({
        ...visibleDetail,
        responsiblePerson: visibleDetail.responsiblePerson ? {
          name: visibleDetail.responsiblePerson.name,
          email: visibleDetail.responsiblePerson.email,
          phone: visibleDetail.responsiblePerson.phone,
        } : null,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/public/codes/:code', async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const resolution = await resolvePublicCode(db, ctx, req.params.code);
      if (!resolution) {
        return next(notFound('Code not found', 'CODE_NOT_FOUND'));
      }
      res.json(resolution);
    } catch (err) {
      next(err);
    }
  });

  router.post('/public/places/:id/reports', async (req, res, next) => {
    try {
      const parsed = createReportSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(badRequest(parsed.error.issues[0]?.message || 'Invalid report payload', 'VALIDATION_ERROR'));
      }
      // @ts-ignore
      const ctx = req.ctx;
      // @ts-ignore
      const user = req.user || null;
      const reporterHash = computeReporterHash(req, config.reporterHashSecret);
      const report = await createPublicReport(
        db,
        ctx,
        req.params.id,
        /** @type {any} */ (parsed.data),
        reporterHash,
        user
      );
      if (!report.deduplicated) {
        await notifyReportCreated(db, ctx, config, undefined, {
          reportId: report.id,
          placeId: report.placeId,
          kind: report.kind,
          note: report.note,
          targetName: report.itemName || report.entryName || report.placeName || 'Paikka',
          storageName: report.storageName || '',
        });
      }
      res.status(report.deduplicated ? 200 : 201).json(report);
    } catch (err) {
      next(err);
    }
  });

  router.post('/public/reports/:id/vote', rateLimit('vote'), async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const voterHash = computeReporterHash(req, config.reporterHashSecret);
      const result = await voteReport(db, ctx, String(req.params.id), voterHash);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  router.post('/public/items/:id/lease', rateLimit('lease'), async (req, res, next) => {
    try {
      const parsed = leaseSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          badRequest(parsed.error.issues[0]?.message || 'Borrower name is required', 'VALIDATION_ERROR')
        );
      }
      // @ts-ignore
      const ctx = req.ctx;
      // @ts-ignore
      const actorSub = req.user?.sub || null;
      const item = await leaseItem(db, ctx, String(req.params.id), parsed.data.borrowerName, actorSub);
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  router.post('/public/items/:id/return', rateLimit('lease'), async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      // @ts-ignore
      const actorSub = req.user?.sub || null;
      const item = await returnItem(db, ctx, String(req.params.id), actorSub);
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  router.get('/public/privacy', async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      res.json(await getTenantPrivacy(db, ctx));
    } catch (err) {
      next(err);
    }
  });

  // Serve storage images only for keys belonging to non-archived storages in the org
  router.get(/^\/files\/(.+)$/, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const key = req.params[0];
      if (!key) {
        return next(notFound('File not found', 'FILE_NOT_FOUND'));
      }

      const check = await db.query(
        `SELECT id FROM storages
         WHERE organization_id = $1 AND archived_at IS NULL AND (image_key = $2 OR logo_key = $2)
         LIMIT 1`,
        [ctx.organizationId, key]
      );
      if (check.rows.length === 0) {
        const orgCheck = await db.query(
          `SELECT id FROM organizations WHERE id = $1 AND logo_key = $2 LIMIT 1`,
          [ctx.organizationId, key]
        );
        if (orgCheck.rows.length === 0) {
          const imgCheck = await db.query(
            `SELECT id FROM images WHERE organization_id = $1 AND archived_at IS NULL AND image_key = $2 LIMIT 1`,
            [ctx.organizationId, key]
          );
          if (imgCheck.rows.length === 0) {
            return next(notFound('File not found', 'FILE_NOT_FOUND'));
          }
        }
      }

      const obj = await storage.getObject(key);
      if (!obj) {
        return next(notFound('File not found', 'FILE_NOT_FOUND'));
      }

      res.setHeader('Content-Type', obj.contentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(obj.buffer);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
