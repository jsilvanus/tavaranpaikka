import crypto from 'node:crypto';
import { badRequest, notFound } from '../errors.js';
import { buildPlacePaths, formatDateOnly, requireOrgId } from './helpers.js';

const MAX_PLACE_DEPTH = 4;

/**
 * Map a place row + path to Place.
 * @param {Record<string, any>} row
 * @param {string[]} path
 * @returns {import('../types.js').Place}
 */
export function mapPlace(row, path) {
  return {
    id: row.id,
    storageId: row.storage_id,
    parentPlaceId: row.parent_place_id ?? null,
    name: row.name,
    description: row.description || '',
    pinX: row.pin_x != null ? Number(row.pin_x) : null,
    pinY: row.pin_y != null ? Number(row.pin_y) : null,
    pinLabel: row.pin_label || '',
    path,
    reportConfig: row.report_config || {},
  };
}

/**
 * Map a place_entries row to Entry.
 * @param {Record<string, any>} row
 * @returns {import('../types.js').Entry}
 */
export function mapEntry(row) {
  return {
    id: row.id,
    placeId: row.place_id,
    name: row.name,
    quantityNote: row.quantity_note || '',
    quantity: row.quantity != null ? Number(row.quantity) : null,
    minQuantity: row.min_quantity != null ? Number(row.min_quantity) : null,
    expiresOn: formatDateOnly(row.expires_on),
    status: row.status,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

/**
 * List places for an organization (optionally filtered by storageId).
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {{ storageId?: string }} [filters]
 * @returns {Promise<import('../types.js').Place[]>}
 */
export async function listPlaces(db, ctx, filters = {}) {
  const orgId = requireOrgId(ctx);
  const conditions = ['organization_id = $1', 'archived_at IS NULL'];
  /** @type {unknown[]} */
  const params = [orgId];

  if (filters.storageId) {
    params.push(filters.storageId);
    conditions.push(`storage_id = $${params.length}`);
  }

  const res = await db.query(
    `SELECT * FROM places WHERE ${conditions.join(' AND ')} ORDER BY name ASC`,
    params
  );
  const pathMap = buildPlacePaths(res.rows);
  return res.rows.map((r) => mapPlace(r, pathMap.get(r.id) || [r.name]));
}

/**
 * Get a single place with its full path.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} id
 * @returns {Promise<import('../types.js').Place>}
 */
export async function getPlaceById(db, ctx, id) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    'SELECT * FROM places WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL',
    [orgId, id]
  );
  if (res.rows.length === 0) {
    throw notFound('Place not found', 'PLACE_NOT_FOUND');
  }
  const row = res.rows[0];
  const siblingRes = await db.query(
    'SELECT id, parent_place_id, name FROM places WHERE organization_id = $1 AND storage_id = $2 AND archived_at IS NULL',
    [orgId, row.storage_id]
  );
  const pathMap = buildPlacePaths(siblingRes.rows);
  return mapPlace(row, pathMap.get(row.id) || [row.name]);
}

/**
 * Validate parentPlaceId: exists in same org and storage, no cycles, depth <= MAX_PLACE_DEPTH.
 * @param {import('../db.js').DbClient} db
 * @param {string} orgId
 * @param {string} storageId
 * @param {string | null} parentPlaceId
 * @param {string | null} selfId
 */
async function validateParentPlace(db, orgId, storageId, parentPlaceId, selfId) {
  if (!parentPlaceId) return;
  if (selfId && parentPlaceId === selfId) {
    throw badRequest('Place cannot be its own parent', 'PLACE_CYCLE');
  }

  const res = await db.query(
    'SELECT id, parent_place_id, storage_id FROM places WHERE organization_id = $1 AND storage_id = $2 AND archived_at IS NULL',
    [orgId, storageId]
  );
  const byId = new Map(res.rows.map((r) => [r.id, r]));
  if (!byId.has(parentPlaceId)) {
    throw badRequest('Parent place not found in this storage', 'INVALID_PARENT_PLACE');
  }

  // Walk up from parentPlaceId to check cycle and depth.
  let depth = 1; // 1 for the child itself
  let curr = parentPlaceId;
  const seen = new Set();
  while (curr) {
    if (selfId && curr === selfId) {
      throw badRequest('Circular place hierarchy is not allowed', 'PLACE_CYCLE');
    }
    if (seen.has(curr)) {
      throw badRequest('Circular place hierarchy detected', 'PLACE_CYCLE');
    }
    seen.add(curr);
    depth += 1;
    if (depth > MAX_PLACE_DEPTH) {
      throw badRequest(`Place nesting cannot exceed ${MAX_PLACE_DEPTH} levels`, 'MAX_DEPTH_EXCEEDED');
    }
    curr = byId.get(curr)?.parent_place_id || null;
  }
}

/**
 * Create a place.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {{
 *   storageId: string,
 *   parentPlaceId?: string | null,
 *   name: string,
 *   description?: string,
 *   pinX?: number | null,
 *   pinY?: number | null,
 *   pinLabel?: string,
 *   reportConfig?: import('../types.js').ReportConfig
 * }} data
 */
export async function createPlace(db, ctx, data) {
  const orgId = requireOrgId(ctx);

  const storageRes = await db.query(
    'SELECT id FROM storages WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL',
    [orgId, data.storageId]
  );
  if (storageRes.rows.length === 0) {
    throw notFound('Storage not found', 'STORAGE_NOT_FOUND');
  }

  const parentPlaceId = data.parentPlaceId || null;
  await validateParentPlace(db, orgId, data.storageId, parentPlaceId, null);

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO places (
       id, organization_id, storage_id, parent_place_id, name, description, pin_x, pin_y, pin_label, report_config
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
    [
      id,
      orgId,
      data.storageId,
      parentPlaceId,
      data.name,
      data.description ?? '',
      data.pinX ?? null,
      data.pinY ?? null,
      data.pinLabel ?? '',
      JSON.stringify(data.reportConfig || {}),
    ]
  );

  return getPlaceById(db, ctx, id);
}

/**
 * Update a place.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} id
 * @param {Record<string, any>} data
 */
export async function updatePlace(db, ctx, id, data) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    'SELECT * FROM places WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL',
    [orgId, id]
  );
  if (res.rows.length === 0) {
    throw notFound('Place not found', 'PLACE_NOT_FOUND');
  }
  const existing = res.rows[0];

  const parentPlaceId =
    data.parentPlaceId !== undefined ? data.parentPlaceId : existing.parent_place_id;
  if (parentPlaceId !== existing.parent_place_id) {
    await validateParentPlace(db, orgId, existing.storage_id, parentPlaceId, id);
  }

  await db.query(
    `UPDATE places
     SET parent_place_id = $3,
         name = $4,
         description = $5,
         pin_x = $6,
         pin_y = $7,
         pin_label = $8,
         report_config = $9::jsonb,
         updated_at = CURRENT_TIMESTAMP
     WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL`,
    [
      orgId,
      id,
      parentPlaceId,
      data.name !== undefined ? data.name : existing.name,
      data.description !== undefined ? data.description : existing.description,
      data.pinX !== undefined ? data.pinX : existing.pin_x,
      data.pinY !== undefined ? data.pinY : existing.pin_y,
      data.pinLabel !== undefined ? data.pinLabel : existing.pin_label,
      JSON.stringify(
        data.reportConfig !== undefined ? data.reportConfig : existing.report_config || {}
      ),
    ]
  );

  return getPlaceById(db, ctx, id);
}

/**
 * Soft-delete (archive) a place.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} id
 */
export async function archivePlace(db, ctx, id) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    `UPDATE places SET archived_at = CURRENT_TIMESTAMP
     WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL
     RETURNING id`,
    [orgId, id]
  );
  if (res.rows.length === 0) {
    throw notFound('Place not found', 'PLACE_NOT_FOUND');
  }
}

/**
 * List group entries for a place.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} placeId
 * @returns {Promise<import('../types.js').Entry[]>}
 */
export async function listPlaceEntries(db, ctx, placeId) {
  const orgId = requireOrgId(ctx);
  await getPlaceById(db, ctx, placeId);
  const res = await db.query(
    `SELECT * FROM place_entries
     WHERE organization_id = $1 AND place_id = $2 AND archived_at IS NULL
     ORDER BY sort_order ASC, name ASC`,
    [orgId, placeId]
  );
  return res.rows.map(mapEntry);
}

/**
 * Create a group entry in a place.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} placeId
 * @param {Record<string, any>} data
 */
export async function createPlaceEntry(db, ctx, placeId, data) {
  const orgId = requireOrgId(ctx);
  await getPlaceById(db, ctx, placeId);

  const id = crypto.randomUUID();
  const res = await db.query(
    `INSERT INTO place_entries (
       id, organization_id, place_id, name, quantity_note, quantity, min_quantity, expires_on, status, sort_order
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      id,
      orgId,
      placeId,
      data.name,
      data.quantityNote ?? '',
      data.quantity ?? null,
      data.minQuantity ?? null,
      data.expiresOn ?? null,
      data.status || 'ok',
      data.sortOrder ?? 0,
    ]
  );
  return mapEntry(res.rows[0]);
}

/**
 * Update a group entry.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} placeId
 * @param {string} entryId
 * @param {Record<string, any>} data
 */
export async function updatePlaceEntry(db, ctx, placeId, entryId, data) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    `SELECT * FROM place_entries
     WHERE organization_id = $1 AND place_id = $2 AND id = $3 AND archived_at IS NULL`,
    [orgId, placeId, entryId]
  );
  if (res.rows.length === 0) {
    throw notFound('Entry not found', 'ENTRY_NOT_FOUND');
  }
  const existing = res.rows[0];

  const updated = await db.query(
    `UPDATE place_entries
     SET name = $4,
         quantity_note = $5,
         quantity = $6,
         min_quantity = $7,
         expires_on = $8,
         status = $9,
         sort_order = $10,
         updated_at = CURRENT_TIMESTAMP
     WHERE organization_id = $1 AND place_id = $2 AND id = $3 AND archived_at IS NULL
     RETURNING *`,
    [
      orgId,
      placeId,
      entryId,
      data.name !== undefined ? data.name : existing.name,
      data.quantityNote !== undefined ? data.quantityNote : existing.quantity_note,
      data.quantity !== undefined ? data.quantity : existing.quantity,
      data.minQuantity !== undefined ? data.minQuantity : existing.min_quantity,
      data.expiresOn !== undefined ? data.expiresOn : formatDateOnly(existing.expires_on),
      data.status !== undefined ? data.status : existing.status,
      data.sortOrder !== undefined ? data.sortOrder : existing.sort_order,
    ]
  );
  return mapEntry(updated.rows[0]);
}

/**
 * Soft-delete (archive) a group entry.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} placeId
 * @param {string} entryId
 */
export async function archivePlaceEntry(db, ctx, placeId, entryId) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    `UPDATE place_entries SET archived_at = CURRENT_TIMESTAMP
     WHERE organization_id = $1 AND place_id = $2 AND id = $3 AND archived_at IS NULL
     RETURNING id`,
    [orgId, placeId, entryId]
  );
  if (res.rows.length === 0) {
    throw notFound('Entry not found', 'ENTRY_NOT_FOUND');
  }
}
