import crypto from 'node:crypto';
import { notFound } from '../errors.js';
import { formatDateOnly, requireOrgId } from './helpers.js';

/**
 * Map an item row + optional active code to Item.
 * @param {Record<string, any>} row
 * @param {string | null} [code]
 * @returns {import('../types.js').Item}
 */
export function mapItem(row, code = null) {
  return {
    id: row.id,
    placeId: row.place_id ?? null,
    name: row.name,
    description: row.description || '',
    category: row.category || '',
    status: row.status,
    expiresOn: formatDateOnly(row.expires_on),
    minQuantity: row.min_quantity != null ? Number(row.min_quantity) : null,
    code: code ?? row.code ?? null,
  };
}

/**
 * List items with optional filters (q, placeId, storageId, status).
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {{ q?: string, placeId?: string, storageId?: string, status?: string }} [filters]
 * @returns {Promise<import('../types.js').Item[]>}
 */
export async function listItems(db, ctx, filters = {}) {
  const orgId = requireOrgId(ctx);
  const conditions = ['i.organization_id = $1', 'i.archived_at IS NULL'];
  /** @type {unknown[]} */
  const params = [orgId];

  if (filters.placeId) {
    params.push(filters.placeId);
    conditions.push(`i.place_id = $${params.length}`);
  }
  if (filters.storageId) {
    params.push(filters.storageId);
    conditions.push(
      `i.place_id IN (SELECT id FROM places WHERE organization_id = $1 AND storage_id = $${params.length} AND archived_at IS NULL)`
    );
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`i.status = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q.toLowerCase()}%`);
    conditions.push(
      `(LOWER(i.name) LIKE $${params.length} OR LOWER(i.description) LIKE $${params.length} OR LOWER(i.category) LIKE $${params.length})`
    );
  }

  const res = await db.query(
    `SELECT i.*, c.code
     FROM items i
     LEFT JOIN codes c
       ON c.organization_id = i.organization_id
      AND c.kind = 'item'
      AND c.target_id = i.id
      AND c.voided_at IS NULL
     WHERE ${conditions.join(' AND ')}
     ORDER BY i.name ASC`,
    params
  );
  return res.rows.map((r) => mapItem(r, r.code || null));
}

/**
 * Get a single item by ID.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} id
 * @returns {Promise<import('../types.js').Item>}
 */
export async function getItemById(db, ctx, id) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    `SELECT i.*, c.code
     FROM items i
     LEFT JOIN codes c
       ON c.organization_id = i.organization_id
      AND c.kind = 'item'
      AND c.target_id = i.id
      AND c.voided_at IS NULL
     WHERE i.organization_id = $1 AND i.id = $2 AND i.archived_at IS NULL`,
    [orgId, id]
  );
  if (res.rows.length === 0) {
    throw notFound('Item not found', 'ITEM_NOT_FOUND');
  }
  return mapItem(res.rows[0], res.rows[0].code || null);
}

/**
 * Create a new tracked item.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {Record<string, any>} data
 */
export async function createItem(db, ctx, data) {
  const orgId = requireOrgId(ctx);
  if (data.placeId) {
    const placeRes = await db.query(
      'SELECT id FROM places WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL',
      [orgId, data.placeId]
    );
    if (placeRes.rows.length === 0) {
      throw notFound('Place not found', 'PLACE_NOT_FOUND');
    }
  }

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO items (
       id, organization_id, place_id, name, description, category, status, expires_on, min_quantity
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      orgId,
      data.placeId ?? null,
      data.name,
      data.description ?? '',
      data.category ?? '',
      data.status || 'ok',
      data.expiresOn ?? null,
      data.minQuantity ?? null,
    ]
  );
  return getItemById(db, ctx, id);
}

/**
 * Update a tracked item.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} id
 * @param {Record<string, any>} data
 */
export async function updateItem(db, ctx, id, data) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    'SELECT * FROM items WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL',
    [orgId, id]
  );
  if (res.rows.length === 0) {
    throw notFound('Item not found', 'ITEM_NOT_FOUND');
  }
  const existing = res.rows[0];

  const placeId = data.placeId !== undefined ? data.placeId : existing.place_id;
  if (placeId) {
    const placeRes = await db.query(
      'SELECT id FROM places WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL',
      [orgId, placeId]
    );
    if (placeRes.rows.length === 0) {
      throw notFound('Place not found', 'PLACE_NOT_FOUND');
    }
  }

  await db.query(
    `UPDATE items
     SET place_id = $3,
         name = $4,
         description = $5,
         category = $6,
         status = $7,
         expires_on = $8,
         min_quantity = $9,
         updated_at = CURRENT_TIMESTAMP
     WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL`,
    [
      orgId,
      id,
      placeId,
      data.name !== undefined ? data.name : existing.name,
      data.description !== undefined ? data.description : existing.description,
      data.category !== undefined ? data.category : existing.category,
      data.status !== undefined ? data.status : existing.status,
      data.expiresOn !== undefined ? data.expiresOn : formatDateOnly(existing.expires_on),
      data.minQuantity !== undefined ? data.minQuantity : existing.min_quantity,
    ]
  );

  return getItemById(db, ctx, id);
}

/**
 * Soft-delete (archive) a tracked item.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} id
 */
export async function archiveItem(db, ctx, id) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    `UPDATE items SET archived_at = CURRENT_TIMESTAMP
     WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL
     RETURNING id`,
    [orgId, id]
  );
  if (res.rows.length === 0) {
    throw notFound('Item not found', 'ITEM_NOT_FOUND');
  }
}

/**
 * Move an item to a new place and record the move in item_history.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} id
 * @param {string | null} toPlaceId
 * @param {string} [actorSub]
 * @returns {Promise<import('../types.js').Item>}
 */
export async function moveItem(db, ctx, id, toPlaceId, actorSub = 'dev-user') {
  const orgId = requireOrgId(ctx);
  const existingRes = await db.query(
    'SELECT * FROM items WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL',
    [orgId, id]
  );
  if (existingRes.rows.length === 0) {
    throw notFound('Item not found', 'ITEM_NOT_FOUND');
  }
  const fromPlaceId = existingRes.rows[0].place_id ?? null;

  if (toPlaceId) {
    const placeRes = await db.query(
      'SELECT id FROM places WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL',
      [orgId, toPlaceId]
    );
    if (placeRes.rows.length === 0) {
      throw notFound('Target place not found', 'PLACE_NOT_FOUND');
    }
  }

  await db.withTransaction(async (client) => {
    await client.query(
      `UPDATE items SET place_id = $3, updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL`,
      [orgId, id, toPlaceId]
    );
    await client.query(
      `INSERT INTO item_history (
         id, organization_id, item_id, from_place_id, to_place_id, event_type, actor_sub
       ) VALUES ($1, $2, $3, $4, $5, 'move', $6)`,
      [crypto.randomUUID(), orgId, id, fromPlaceId, toPlaceId, actorSub]
    );
  });

  return getItemById(db, ctx, id);
}
