import crypto from 'node:crypto';
import { notFound } from '../errors.js';
import { requireOrgId } from './helpers.js';

/**
 * List non-archived images and their overlays for an owner ('storage' | 'item').
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {'storage' | 'item'} ownerKind
 * @param {string} ownerId
 * @returns {Promise<import('../types.js').OwnerImage[]>}
 */
export async function listImagesForOwner(db, ctx, ownerKind, ownerId) {
  const map = await listImagesForOwners(db, ctx, ownerKind, [ownerId]);
  return map.get(ownerId) || [];
}

/**
 * Batch-load images and overlays for multiple owners of the same kind.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {'storage' | 'item'} ownerKind
 * @param {string[]} ownerIds
 * @returns {Promise<Map<string, import('../types.js').OwnerImage[]>>}
 */
export async function listImagesForOwners(db, ctx, ownerKind, ownerIds) {
  const orgId = requireOrgId(ctx);
  /** @type {Map<string, import('../types.js').OwnerImage[]>} */
  const byOwner = new Map(ownerIds.map((id) => [id, []]));
  if (ownerIds.length === 0) return byOwner;

  const placeholders = ownerIds.map((_, idx) => `$${idx + 3}`).join(', ');
  const imgRes = await db.query(
    `SELECT * FROM images
     WHERE organization_id = $1
       AND owner_kind = $2
       AND archived_at IS NULL
       AND owner_id IN (${placeholders})
     ORDER BY sort_order ASC, created_at ASC`,
    [orgId, ownerKind, ...ownerIds]
  );

  if (imgRes.rows.length === 0) return byOwner;

  const imageIds = imgRes.rows.map((r) => r.id);
  const ovPlaceholders = imageIds.map((_, idx) => `$${idx + 2}`).join(', ');
  const ovRes = await db.query(
    `SELECT * FROM image_overlays
     WHERE organization_id = $1 AND image_id IN (${ovPlaceholders})
     ORDER BY created_at ASC`,
    [orgId, ...imageIds]
  );

  /** @type {Map<string, import('../types.js').ImageOverlay[]>} */
  const overlaysByImage = new Map(imageIds.map((id) => [id, []]));
  for (const row of ovRes.rows) {
    overlaysByImage.get(row.image_id)?.push({
      id: row.id,
      imageId: row.image_id,
      targetKind: row.target_kind,
      targetId: row.target_id || null,
      shape: row.shape,
      coords: row.coords || {},
      label: row.label || '',
      color: row.color || '#dc2626',
    });
  }

  for (const row of imgRes.rows) {
    byOwner.get(row.owner_id)?.push({
      id: row.id,
      ownerKind: row.owner_kind,
      ownerId: row.owner_id,
      url: `/api/files/${row.image_key}`,
      width: row.width != null ? Number(row.width) : null,
      height: row.height != null ? Number(row.height) : null,
      caption: row.caption || '',
      sortOrder: Number(row.sort_order || 0),
      overlays: overlaysByImage.get(row.id) || [],
    });
  }

  return byOwner;
}

/**
 * Add an image to a storage or item.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {{
 *   ownerKind: 'storage' | 'item',
 *   ownerId: string,
 *   imageKey: string,
 *   width: number,
 *   height: number,
 *   caption?: string
 * }} input
 * @returns {Promise<import('../types.js').OwnerImage>}
 */
export async function addOwnerImage(db, ctx, input) {
  const orgId = requireOrgId(ctx);
  const id = crypto.randomUUID();

  await db.query(
    `INSERT INTO images (
       id, organization_id, owner_kind, owner_id, image_key, width, height, caption, sort_order
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)`,
    [
      id,
      orgId,
      input.ownerKind,
      input.ownerId,
      input.imageKey,
      input.width,
      input.height,
      input.caption || '',
    ]
  );

  // Backwards compatibility: if storage has no primary image_key yet, set it
  if (input.ownerKind === 'storage') {
    await db.query(
      `UPDATE storages
       SET image_key = COALESCE(image_key, $3),
           image_width = COALESCE(image_width, $4),
           image_height = COALESCE(image_height, $5)
       WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL`,
      [orgId, input.ownerId, input.imageKey, input.width, input.height]
    );
  } else if (input.ownerKind === 'item') {
    await db.query(
      `UPDATE items
       SET photo_key = COALESCE(photo_key, $3)
       WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL`,
      [orgId, input.ownerId, input.imageKey]
    );
  }

  const list = await listImagesForOwner(db, ctx, input.ownerKind, input.ownerId);
  const created = list.find((img) => img.id === id);
  if (!created) throw notFound('Image not found', 'IMAGE_NOT_FOUND');
  return created;
}

/**
 * Soft-delete an image.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} imageId
 */
export async function deleteOwnerImage(db, ctx, imageId) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    `UPDATE images SET archived_at = CURRENT_TIMESTAMP
     WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL
     RETURNING id`,
    [orgId, imageId]
  );
  if (res.rows.length === 0) {
    throw notFound('Image not found', 'IMAGE_NOT_FOUND');
  }
}

/**
 * Add a drawn overlay (rect, polygon, or pin) onto an image.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} imageId
 * @param {{
 *   targetKind: 'place' | 'item' | 'general',
 *   targetId?: string | null,
 *   shape: 'rect' | 'polygon' | 'pin',
 *   coords: Record<string, any>,
 *   label?: string,
 *   color?: string
 * }} data
 * @returns {Promise<import('../types.js').ImageOverlay>}
 */
export async function addImageOverlay(db, ctx, imageId, data) {
  const orgId = requireOrgId(ctx);
  const imgRes = await db.query(
    'SELECT id FROM images WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL',
    [orgId, imageId]
  );
  if (imgRes.rows.length === 0) {
    throw notFound('Image not found', 'IMAGE_NOT_FOUND');
  }

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO image_overlays (
       id, organization_id, image_id, target_kind, target_id, shape, coords, label, color
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
    [
      id,
      orgId,
      imageId,
      data.targetKind,
      data.targetId || null,
      data.shape,
      JSON.stringify(data.coords),
      data.label || '',
      data.color || '#dc2626',
    ]
  );

  return {
    id,
    imageId,
    targetKind: data.targetKind,
    targetId: data.targetId || null,
    shape: data.shape,
    coords: data.coords,
    label: data.label || '',
    color: data.color || '#dc2626',
  };
}

/**
 * Delete an overlay from an image.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} overlayId
 */
export async function deleteImageOverlay(db, ctx, overlayId) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    'DELETE FROM image_overlays WHERE organization_id = $1 AND id = $2 RETURNING id',
    [orgId, overlayId]
  );
  if (res.rows.length === 0) {
    throw notFound('Overlay not found', 'OVERLAY_NOT_FOUND');
  }
}
