import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { badRequest } from '../errors.js';
import { processImage } from '../images.js';
import { generateSummaryPdf } from '../labels/summaryPdf.js';
import { requireRole } from '../middleware/auth.js';
import { issueCode, voidCode } from '../repositories/codesRepo.js';
import {
  archiveItem,
  createItem,
  getItemById,
  listItems,
  moveItem,
  updateItem,
} from '../repositories/itemsRepo.js';
import {
  archivePlace,
  archivePlaceEntry,
  createPlace,
  createPlaceEntry,
  getPlaceById,
  listPlaceEntries,
  listPlaces,
  updatePlace,
  updatePlaceEntry,
} from '../repositories/placesRepo.js';
import {
  acknowledgeReport,
  dismissReport,
  listReports,
  resolveReport,
} from '../repositories/reportsRepo.js';
import {
  archiveStorage,
  createStorage,
  getStorageDetail,
  listStorageSummaries,
  recordInspection,
  updateStorage,
  updateStorageImage,
} from '../repositories/storagesRepo.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const storageSchema = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(['room', 'first_aid', 'cabinet', 'vehicle', 'other']).optional(),
  description: z.string().max(2000).optional(),
  publicListed: z.boolean().optional(),
  inspectionIntervalDays: z.number().int().positive().nullable().optional(),
  reportConfig: z.record(z.any()).optional(),
});

const storageUpdateSchema = storageSchema.partial();

const placeSchema = z.object({
  storageId: z.string().min(1),
  parentPlaceId: z.string().min(1).nullable().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  pinX: z.number().min(0).max(1).nullable().optional(),
  pinY: z.number().min(0).max(1).nullable().optional(),
  pinLabel: z.string().max(200).optional(),
  reportConfig: z.record(z.any()).optional(),
});

const placeUpdateSchema = placeSchema.omit({ storageId: true }).partial();

const entrySchema = z.object({
  name: z.string().min(1).max(200),
  quantityNote: z.string().max(200).optional(),
  quantity: z.number().int().min(0).nullable().optional(),
  minQuantity: z.number().int().min(0).nullable().optional(),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(['ok', 'depleted', 'retired']).optional(),
  sortOrder: z.number().int().optional(),
});

const entryUpdateSchema = entrySchema.partial();

const itemSchema = z.object({
  placeId: z.string().min(1).nullable().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(100).optional(),
  status: z.enum(['ok', 'depleted', 'broken', 'retired']).optional(),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  minQuantity: z.number().int().min(0).nullable().optional(),
});

const itemUpdateSchema = itemSchema.partial();

const issueCodeSchema = z.object({
  kind: z.enum(['item', 'place', 'storage']),
  targetId: z.string().min(1),
});

/**
 * Parse body with a Zod schema or pass AppError to next.
 * @template T
 * @param {z.ZodType<T>} schema
 * @param {unknown} body
 * @returns {T}
 */
function parseBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest(result.error.issues[0]?.message || 'Invalid request body', 'VALIDATION_ERROR');
  }
  return result.data;
}

/**
 * Create keeper API router (mounted at /api).
 * @param {{
 *   db: import('../db.js').DbClient,
 *   storage: import('../storage.js').ObjectStorage
 * }} deps
 */
export function createKeeperRouter({ db, storage }) {
  const router = express.Router();

  router.get('/me', (req, res) => {
    // @ts-ignore
    const user = req.user || null;
    // @ts-ignore
    const ctx = req.ctx;
    res.json({
      user,
      organizationId: ctx.organizationId,
      locale: ctx.locale,
    });
  });

  // All routes below require keeper role or higher
  const keeper = requireRole('keeper');

  // Storages
  router.get('/storages', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const kind = typeof req.query.kind === 'string' && req.query.kind ? req.query.kind : undefined;
      const q = typeof req.query.q === 'string' && req.query.q ? req.query.q : undefined;
      res.json(await listStorageSummaries(db, ctx, { kind, q, publicOnly: false }));
    } catch (err) {
      next(err);
    }
  });

  router.post('/storages', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const data = parseBody(storageSchema, req.body);
      const created = await createStorage(db, ctx, /** @type {any} */ (data));
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.get('/storages/:id', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      res.json(await getStorageDetail(db, ctx, String(req.params.id)));
    } catch (err) {
      next(err);
    }
  });

  router.put('/storages/:id', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const data = parseBody(storageUpdateSchema, req.body);
      res.json(await updateStorage(db, ctx, String(req.params.id), data));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/storages/:id', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      await archiveStorage(db, ctx, String(req.params.id));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post('/storages/:id/image', keeper, upload.single('image'), async (req, res, next) => {
    try {
      if (!req.file) {
        return next(badRequest('Image file field "image" is required', 'MISSING_IMAGE'));
      }
      // @ts-ignore
      const ctx = req.ctx;
      const storageId = String(req.params.id);
      const processed = await processImage(req.file.buffer);
      const uid = crypto.randomUUID();
      const displayKey = `storages/${storageId}/${uid}.${processed.ext}`;
      const originalKey = `storages/${storageId}/${uid}_orig.${processed.ext}`;

      await storage.putObject(displayKey, processed.displayBuffer, processed.contentType);
      await storage.putObject(originalKey, processed.originalBuffer, processed.contentType);

      const updated = await updateStorageImage(db, ctx, storageId, {
        imageKey: displayKey,
        imageWidth: processed.width,
        imageHeight: processed.height,
      });
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.post('/storages/:id/inspect', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      // @ts-ignore
      const actorSub = req.user?.sub || 'dev-user';
      res.json(await recordInspection(db, ctx, String(req.params.id), actorSub));
    } catch (err) {
      next(err);
    }
  });

  router.get('/storages/:id/summary.pdf', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const detail = await getStorageDetail(db, ctx, String(req.params.id));
      const pdfBuffer = await generateSummaryPdf(detail);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="storage-${detail.id}-summary.pdf"`
      );
      res.send(pdfBuffer);
    } catch (err) {
      next(err);
    }
  });

  // Places
  router.get('/places', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const storageId =
        typeof req.query.storageId === 'string' && req.query.storageId
          ? req.query.storageId
          : undefined;
      res.json(await listPlaces(db, ctx, { storageId }));
    } catch (err) {
      next(err);
    }
  });

  router.post('/places', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const data = parseBody(placeSchema, req.body);
      const created = await createPlace(db, ctx, /** @type {any} */ (data));
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.get('/places/:id', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      res.json(await getPlaceById(db, ctx, String(req.params.id)));
    } catch (err) {
      next(err);
    }
  });

  router.put('/places/:id', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const data = parseBody(placeUpdateSchema, req.body);
      res.json(await updatePlace(db, ctx, String(req.params.id), data));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/places/:id', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      await archivePlace(db, ctx, String(req.params.id));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // Place entries
  router.get('/places/:id/entries', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      res.json(await listPlaceEntries(db, ctx, String(req.params.id)));
    } catch (err) {
      next(err);
    }
  });

  router.post('/places/:id/entries', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const data = parseBody(entrySchema, req.body);
      const created = await createPlaceEntry(db, ctx, String(req.params.id), data);
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.put('/places/:id/entries/:eid', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const data = parseBody(entryUpdateSchema, req.body);
      res.json(
        await updatePlaceEntry(db, ctx, String(req.params.id), String(req.params.eid), data)
      );
    } catch (err) {
      next(err);
    }
  });

  router.delete('/places/:id/entries/:eid', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      await archivePlaceEntry(db, ctx, String(req.params.id), String(req.params.eid));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // Items
  router.get('/items', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const q = typeof req.query.q === 'string' && req.query.q ? req.query.q : undefined;
      const placeId =
        typeof req.query.placeId === 'string' && req.query.placeId
          ? req.query.placeId
          : typeof req.query.place === 'string' && req.query.place
            ? req.query.place
            : undefined;
      const storageId =
        typeof req.query.storageId === 'string' && req.query.storageId
          ? req.query.storageId
          : undefined;
      const status =
        typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
      res.json(await listItems(db, ctx, { q, placeId, storageId, status }));
    } catch (err) {
      next(err);
    }
  });

  router.post('/items', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const data = parseBody(itemSchema, req.body);
      const created = await createItem(db, ctx, data);
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.get('/items/:id', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      res.json(await getItemById(db, ctx, String(req.params.id)));
    } catch (err) {
      next(err);
    }
  });

  router.put('/items/:id', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const data = parseBody(itemUpdateSchema, req.body);
      res.json(await updateItem(db, ctx, String(req.params.id), data));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/items/:id', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      await archiveItem(db, ctx, String(req.params.id));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post('/items/:id/move', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      // @ts-ignore
      const actorSub = req.user?.sub || 'dev-user';
      const body = parseBody(z.object({ placeId: z.string().min(1).nullable() }), req.body);
      res.json(await moveItem(db, ctx, String(req.params.id), body.placeId, actorSub));
    } catch (err) {
      next(err);
    }
  });

  // Reports
  router.get('/reports', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const status =
        typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
      const storageId =
        typeof req.query.storageId === 'string' && req.query.storageId
          ? req.query.storageId
          : undefined;
      const placeId =
        typeof req.query.placeId === 'string' && req.query.placeId
          ? req.query.placeId
          : undefined;
      const kind = typeof req.query.kind === 'string' && req.query.kind ? req.query.kind : undefined;
      res.json(await listReports(db, ctx, { status, storageId, placeId, kind }));
    } catch (err) {
      next(err);
    }
  });

  router.post('/reports/:id/ack', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      // @ts-ignore
      const actorSub = req.user?.sub || 'dev-user';
      res.json(await acknowledgeReport(db, ctx, String(req.params.id), actorSub));
    } catch (err) {
      next(err);
    }
  });

  router.post('/reports/:id/resolve', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      // @ts-ignore
      const actorSub = req.user?.sub || 'dev-user';
      const itemStatus = req.body?.itemStatus === 'retired' ? 'retired' : 'ok';
      res.json(await resolveReport(db, ctx, String(req.params.id), actorSub, { itemStatus }));
    } catch (err) {
      next(err);
    }
  });

  router.post('/reports/:id/dismiss', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      // @ts-ignore
      const actorSub = req.user?.sub || 'dev-user';
      res.json(await dismissReport(db, ctx, String(req.params.id), actorSub));
    } catch (err) {
      next(err);
    }
  });

  // Codes
  router.post('/codes', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const { kind, targetId } = parseBody(issueCodeSchema, req.body);
      const created = await issueCode(db, ctx, kind, targetId);
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.post('/codes/:code/void', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      res.json(await voidCode(db, ctx, String(req.params.code)));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
