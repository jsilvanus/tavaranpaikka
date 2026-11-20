import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { badRequest } from '../errors.js';
import { processImage, processLogoImage } from '../images.js';
import { generateSummaryPdf } from '../labels/summaryPdf.js';
import { requireRole } from '../middleware/auth.js';
import { issueCode, voidCode } from '../repositories/codesRepo.js';
import {
  addImageOverlay,
  addOwnerImage,
  deleteImageOverlay,
  deleteOwnerImage,
} from '../repositories/imagesRepo.js';
import {
  archiveItem,
  createItem,
  getItemById,
  listItems,
  listLeaseHistory,
  moveItem,
  updateItem,
} from '../repositories/itemsRepo.js';
import { runPrivacyRetentionCleanup, updateTenantPrivacy } from '../repositories/privacyRepo.js';
import {
  checkAndNotifyUpcomingExpiries,
  listInboxNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../repositories/notificationsRepo.js';
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
  getOrganizationLogoKey,
  getStorageDetail,
  listStorageSummaries,
  recordInspection,
  updateOrganizationLogo,
  updateStorage,
  updateStorageImage,
  updateStorageLogo,
} from '../repositories/storagesRepo.js';

/**
 * Read the authenticated user attached by authMiddleware.
 * @param {import('express').Request} req
 * @returns {import('../middleware/auth.js').AuthUser | null}
 */
function getAuthUser(req) {
  return /** @type {any} */ (req).user || null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const storageSchema = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(['room', 'kit', 'cabinet', 'vehicle', 'other', 'first_aid']).optional(),
  description: z.string().max(2000).optional(),
  publicListed: z.boolean().optional(),
  inspectionIntervalDays: z.number().int().positive().nullable().optional(),
  notifyBeforeDays: z.number().int().min(1).max(365).nullable().optional(),
  reportConfig: z.record(z.any()).optional(),
  responsiblePersonType: z.enum(['tunnus', 'external']).nullable().optional(),
  responsiblePersonSub: z.string().max(500).nullable().optional(),
  responsiblePersonName: z.string().max(200).nullable().optional(),
  responsiblePersonEmail: z.string().email().max(320).nullable().optional(),
  responsiblePersonPhone: z.string().max(50).nullable().optional(),
});

const storageUpdateSchema = storageSchema.partial();

/**
 * Limit creator audit details to administrators and the responsible person.
 * External contacts can authenticate through any account using their recorded email.
 * @param {any} detail
 * @param {any} user
 */
function presentStorageDetail(detail, user) {
  const responsible = detail.responsiblePerson;
  const isResponsible = user?.sub && user.sub === responsible?.sub;
  const emailMatches = user?.email && responsible?.email &&
    String(user.email).toLowerCase() === String(responsible.email).toLowerCase();
  const canSeeCreator = user?.role === 'admin' || isResponsible || emailMatches;
  return { ...detail, createdBy: canSeeCreator ? detail.createdBy : null };
}


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
  leaseable: z.boolean().optional(),
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
 *   storage: import('../storage.js').ObjectStorage,
 *   config?: import('../config.js').AppConfig
 * }} deps
 */
export function createKeeperRouter({ db, storage, config }) {
  const router = express.Router();

  router.get('/me', async (req, res, next) => {
    try {
      // @ts-ignore
      const user = getAuthUser(req);
      // @ts-ignore
      const ctx = req.ctx;

      /** @type {Array<{ id: string, slug: string, name: string, role: string }>} */
      let organizations = [];
      if (user) {
        const orgsRes = await db.query('SELECT id, slug, name FROM organizations ORDER BY name');
        if (user.orgRoles && typeof user.orgRoles === 'object') {
          for (const row of orgsRes.rows) {
            const r = user.orgRoles[row.id];
            if (r) {
              organizations.push({ id: row.id, slug: row.slug, name: row.name, role: r });
            }
          }
        } else {
          organizations = orgsRes.rows.map((row) => ({
            id: row.id,
            slug: row.slug,
            name: row.name,
            role: user.role,
          }));
        }
      }

      res.json({
        user,
        authMode: config?.authMode || 'dev',
        organizationId: ctx.organizationId,
        organizations,
        locale: ctx.locale,
      });
    } catch (err) {
      next(err);
    }
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
      if (data.responsiblePersonType && !data.responsiblePersonName?.trim()) {
        throw badRequest('Responsible person name is required', 'VALIDATION_ERROR');
      }
      if (data.responsiblePersonType === 'tunnus' && !data.responsiblePersonSub?.trim()) {
        throw badRequest('Tunnus user subject is required', 'VALIDATION_ERROR');
      }
      const created = await createStorage(db, ctx, /** @type {any} */ ({ ...data, createdBy: getAuthUser(req) }));
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.get('/storages/:id', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const detail = await getStorageDetail(db, ctx, String(req.params.id));
      res.json(presentStorageDetail(detail, getAuthUser(req)));
    } catch (err) {
      next(err);
    }
  });

  router.put('/storages/:id', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const data = parseBody(storageUpdateSchema, req.body);
      if (data.responsiblePersonType && !data.responsiblePersonName?.trim()) {
        throw badRequest('Responsible person name is required', 'VALIDATION_ERROR');
      }
      if (data.responsiblePersonType === 'tunnus' && !data.responsiblePersonSub?.trim()) {
        throw badRequest('Tunnus user subject is required', 'VALIDATION_ERROR');
      }
      const updated = await updateStorage(db, ctx, String(req.params.id), data);
      res.json(presentStorageDetail(updated, getAuthUser(req)));
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
      await getStorageDetail(db, ctx, storageId);
      const processed = await processImage(req.file.buffer);
      const uid = crypto.randomUUID();
      const displayKey = `storages/${storageId}/${uid}.${processed.ext}`;
      const originalKey = `storages/${storageId}/${uid}_orig.${processed.ext}`;

      await storage.putObject(displayKey, processed.displayBuffer, processed.contentType);
      await storage.putObject(originalKey, processed.originalBuffer, processed.contentType);

      await addOwnerImage(db, ctx, {
        ownerKind: 'storage',
        ownerId: storageId,
        imageKey: displayKey,
        width: processed.width,
        height: processed.height,
      });

      const updated = await updateStorageImage(db, ctx, storageId, {
        imageKey: displayKey,
        imageWidth: processed.width,
        imageHeight: processed.height,
      });
      res.json(presentStorageDetail(updated, getAuthUser(req)));
    } catch (err) {
      next(err);
    }
  });

  router.post('/storages/:id/images', keeper, upload.single('image'), async (req, res, next) => {
    try {
      if (!req.file) {
        return next(badRequest('Image file field "image" is required', 'MISSING_IMAGE'));
      }
      // @ts-ignore
      const ctx = req.ctx;
      const storageId = String(req.params.id);
      await getStorageDetail(db, ctx, storageId);
      const processed = await processImage(req.file.buffer);
      const uid = crypto.randomUUID();
      const displayKey = `storages/${storageId}/${uid}.${processed.ext}`;
      await storage.putObject(displayKey, processed.displayBuffer, processed.contentType);
      const caption = typeof req.body?.caption === 'string' ? req.body.caption.slice(0, 200) : '';
      const created = await addOwnerImage(db, ctx, {
        ownerKind: 'storage',
        ownerId: storageId,
        imageKey: displayKey,
        width: processed.width,
        height: processed.height,
        caption,
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.post('/items/:id/images', keeper, upload.single('image'), async (req, res, next) => {
    try {
      if (!req.file) {
        return next(badRequest('Image file field "image" is required', 'MISSING_IMAGE'));
      }
      // @ts-ignore
      const ctx = req.ctx;
      const itemId = String(req.params.id);
      await getItemById(db, ctx, itemId);
      const processed = await processImage(req.file.buffer);
      const uid = crypto.randomUUID();
      const displayKey = `items/${itemId}/${uid}.${processed.ext}`;
      await storage.putObject(displayKey, processed.displayBuffer, processed.contentType);
      const caption = typeof req.body?.caption === 'string' ? req.body.caption.slice(0, 200) : '';
      const created = await addOwnerImage(db, ctx, {
        ownerKind: 'item',
        ownerId: itemId,
        imageKey: displayKey,
        width: processed.width,
        height: processed.height,
        caption,
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/images/:id', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      await deleteOwnerImage(db, ctx, String(req.params.id));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  const overlaySchema = z.object({
    targetKind: z.enum(['place', 'item', 'general']),
    targetId: z.string().min(1).nullable().optional(),
    shape: z.enum(['rect', 'polygon', 'pin']).default('rect'),
    coords: z.record(z.any()),
    label: z.string().max(200).optional(),
    color: z.string().max(30).optional(),
  });

  router.post('/images/:id/overlays', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const data = parseBody(overlaySchema, req.body);
      const created = await addImageOverlay(db, ctx, String(req.params.id), /** @type {any} */ (data));
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/overlays/:id', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      await deleteImageOverlay(db, ctx, String(req.params.id));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post('/storages/:id/logo', keeper, upload.single('logo'), async (req, res, next) => {
    try {
      if (!req.file) {
        return next(badRequest('Logo file field "logo" is required', 'MISSING_LOGO'));
      }
      // @ts-ignore
      const ctx = req.ctx;
      const storageId = String(req.params.id);
      await getStorageDetail(db, ctx, storageId);
      const processed = await processLogoImage(req.file.buffer);
      const uid = crypto.randomUUID();
      const logoKey = `logos/storages/${storageId}/${uid}.${processed.ext}`;
      await storage.putObject(logoKey, processed.buffer, processed.contentType);
      const updated = await updateStorageLogo(db, ctx, storageId, logoKey);
      res.json(presentStorageDetail(updated, getAuthUser(req)));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/storages/:id/logo', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const updated = await updateStorageLogo(db, ctx, String(req.params.id), null);
      res.json(presentStorageDetail(updated, getAuthUser(req)));
    } catch (err) {
      next(err);
    }
  });

  router.get('/organization/logo', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const key = await getOrganizationLogoKey(db, ctx);
      res.json({ logoUrl: key ? `/api/files/${key}` : null });
    } catch (err) {
      next(err);
    }
  });

  router.post('/organization/logo', keeper, upload.single('logo'), async (req, res, next) => {
    try {
      if (!req.file) {
        return next(badRequest('Logo file field "logo" is required', 'MISSING_LOGO'));
      }
      // @ts-ignore
      const ctx = req.ctx;
      const processed = await processLogoImage(req.file.buffer);
      const uid = crypto.randomUUID();
      const logoKey = `logos/org/${ctx.organizationId}/${uid}.${processed.ext}`;
      await storage.putObject(logoKey, processed.buffer, processed.contentType);
      await updateOrganizationLogo(db, ctx, logoKey);
      res.json({ logoUrl: `/api/files/${logoKey}` });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/organization/logo', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      await updateOrganizationLogo(db, ctx, null);
      res.json({ logoUrl: null });
    } catch (err) {
      next(err);
    }
  });

  router.post('/storages/:id/inspect', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      // @ts-ignore
      const actorSub = getAuthUser(req)?.sub || 'dev-user';
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
      const actorSub = getAuthUser(req)?.sub || 'dev-user';
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
      const actorSub = getAuthUser(req)?.sub || 'dev-user';
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
      const actorSub = getAuthUser(req)?.sub || 'dev-user';
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
      const actorSub = getAuthUser(req)?.sub || 'dev-user';
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

  // Admin-only lease audit history
  router.get('/admin/leases', requireRole('admin'), async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const itemId = typeof req.query.itemId === 'string' ? req.query.itemId : undefined;
      const storageId = typeof req.query.storageId === 'string' ? req.query.storageId : undefined;
      res.json(await listLeaseHistory(db, ctx, { itemId, storageId }));
    } catch (err) {
      next(err);
    }
  });

  const privacySchema = z.object({
    controllerName: z.string().max(200).optional(),
    controllerContact: z.string().max(500).optional(),
    processors: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
          purpose: z.string().max(300).default(''),
          location: z.string().max(200).default(''),
        })
      )
      .optional(),
    privacyExtra: z.string().max(4000).optional(),
    leaseRetentionDays: z.number().int().min(1).max(3650).optional(),
  });

  router.put('/admin/privacy', requireRole('admin'), async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const data = parseBody(privacySchema, req.body);
      res.json(await updateTenantPrivacy(db, ctx, /** @type {any} */ (data)));
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/cleanup', requireRole('admin'), async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const result = await runPrivacyRetentionCleanup(db, {}, { organizationId: ctx.organizationId });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // Keeper & admin notifications inbox
  router.get('/notifications', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      // @ts-ignore
      const role = getAuthUser(req)?.role || 'keeper';
      const unreadOnly = req.query.unreadOnly === '1' || req.query.unreadOnly === 'true';
      res.json(await listInboxNotifications(db, ctx, role, { unreadOnly }));
    } catch (err) {
      next(err);
    }
  });

  router.post('/notifications/:id/read', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      await markNotificationRead(db, ctx, String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/notifications/read-all', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      await markAllNotificationsRead(db, ctx);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/notifications/check-expiries', keeper, async (req, res, next) => {
    try {
      // @ts-ignore
      const ctx = req.ctx;
      const cfg = config || /** @type {any} */ ({ defaultNotifyBeforeDays: 60, mailProvider: 'console', mailAdminFallback: [], baseUrl: '' });
      res.json(await checkAndNotifyUpcomingExpiries(db, ctx, cfg));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
