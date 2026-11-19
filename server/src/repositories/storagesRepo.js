import crypto from 'node:crypto';
import { notFound } from '../errors.js';
import {
  buildPlacePaths,
  classifyExpiry,
  emptyCounts,
  formatDateOnly,
  formatIso,
  getExpiryBounds,
  requireOrgId,
} from './helpers.js';
import { listImagesForOwner, listImagesForOwners } from './imagesRepo.js';

/**
 * Compute whether a storage inspection is due.
 * @param {number | null} intervalDays
 * @param {string | null} lastInspectedAt
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isInspectionDue(intervalDays, lastInspectedAt, now = new Date()) {
  if (intervalDays == null || intervalDays <= 0) return false;
  if (!lastInspectedAt) return true;
  const lastMs = new Date(lastInspectedAt).getTime();
  if (Number.isNaN(lastMs)) return true;
  return now.getTime() - lastMs >= intervalDays * 86400_000;
}

/**
 * Map a storage DB row + counts to StorageSummary.
 * @param {Record<string, any>} row
 * @param {import('../types.js').Counts} counts
 * @returns {import('../types.js').StorageSummary}
 */
export function mapStorageSummary(row, counts) {
  const lastInspectedAt = formatIso(row.last_inspected_at);
  const interval = row.inspection_interval_days != null ? Number(row.inspection_interval_days) : null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    description: row.description || '',
    hasImage: Boolean(row.image_key),
    hasLogo: Boolean(row.logo_key),
    logoUrl: row.logo_key ? `/api/files/${row.logo_key}` : null,
    publicListed: Boolean(row.public_listed),
    inspectionIntervalDays: interval,
    lastInspectedAt,
    inspectionDue: isInspectionDue(interval, lastInspectedAt),
    counts,
  };
}

/**
 * List storage summaries for an organization with optional filters.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {{ kind?: string, q?: string, publicOnly?: boolean }} [filters]
 * @returns {Promise<import('../types.js').StorageSummary[]>}
 */
export async function listStorageSummaries(db, ctx, filters = {}) {
  const orgId = requireOrgId(ctx);
  const conditions = ['organization_id = $1', 'archived_at IS NULL'];
  /** @type {unknown[]} */
  const params = [orgId];

  if (filters.publicOnly) {
    conditions.push('public_listed = TRUE');
  }
  if (filters.kind) {
    params.push(filters.kind);
    conditions.push(`kind = $${params.length}`);
  }
  if (filters.q) {
    params.push(`%${filters.q.toLowerCase()}%`);
    conditions.push(`(LOWER(name) LIKE $${params.length} OR LOWER(description) LIKE $${params.length})`);
  }

  const storagesRes = await db.query(
    `SELECT * FROM storages WHERE ${conditions.join(' AND ')} ORDER BY name ASC`,
    params
  );
  if (storagesRes.rows.length === 0) {
    return [];
  }

  const storageIds = storagesRes.rows.map((r) => r.id);
  const countsMap = new Map(storageIds.map((id) => [id, emptyCounts()]));

  const storagePlaceholders = storageIds.map((_, idx) => `$${idx + 2}`).join(', ');
  const placesRes = await db.query(
    `SELECT id, storage_id FROM places
     WHERE organization_id = $1 AND archived_at IS NULL AND storage_id IN (${storagePlaceholders})`,
    [orgId, ...storageIds]
  );
  const placeToStorage = new Map();
  for (const p of placesRes.rows) {
    placeToStorage.set(p.id, p.storage_id);
    const c = countsMap.get(p.storage_id);
    if (c) c.places += 1;
  }

  const placeIds = placesRes.rows.map((p) => p.id);
  const { todayStr, soonStr } = getExpiryBounds();

  if (placeIds.length > 0) {
    const placePlaceholders = placeIds.map((_, idx) => `$${idx + 2}`).join(', ');
    const itemsRes = await db.query(
      `SELECT id, place_id, status, expires_on FROM items
       WHERE organization_id = $1 AND archived_at IS NULL AND place_id IN (${placePlaceholders})`,
      [orgId, ...placeIds]
    );
    for (const item of itemsRes.rows) {
      const sid = placeToStorage.get(item.place_id);
      const c = sid ? countsMap.get(sid) : null;
      if (!c) continue;
      c.items += 1;
      if (item.status === 'depleted') c.depleted += 1;
      if (item.status === 'broken') c.broken += 1;
      const exp = classifyExpiry(formatDateOnly(item.expires_on), todayStr, soonStr);
      if (exp.isExpired) c.expired += 1;
      if (exp.isExpiringSoon) c.expiringSoon += 1;
    }

    const entriesRes = await db.query(
      `SELECT id, place_id, status, expires_on FROM place_entries
       WHERE organization_id = $1 AND archived_at IS NULL AND place_id IN (${placePlaceholders})`,
      [orgId, ...placeIds]
    );
    for (const entry of entriesRes.rows) {
      const sid = placeToStorage.get(entry.place_id);
      const c = sid ? countsMap.get(sid) : null;
      if (!c) continue;
      c.entries += 1;
      if (entry.status === 'depleted') c.depleted += 1;
      const exp = classifyExpiry(formatDateOnly(entry.expires_on), todayStr, soonStr);
      if (exp.isExpired) c.expired += 1;
      if (exp.isExpiringSoon) c.expiringSoon += 1;
    }

    const reportsRes = await db.query(
      `SELECT id, place_id FROM reports
       WHERE organization_id = $1 AND status = 'open' AND place_id IN (${placePlaceholders})`,
      [orgId, ...placeIds]
    );
    for (const rep of reportsRes.rows) {
      const sid = placeToStorage.get(rep.place_id);
      const c = sid ? countsMap.get(sid) : null;
      if (c) c.openReports += 1;
    }
  }

  return storagesRes.rows.map((row) =>
    mapStorageSummary(row, countsMap.get(row.id) || emptyCounts())
  );
}

/**
 * Get a single storage row (throws 404 if not found).
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} id
 */
export async function getStorageRow(db, ctx, id) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    'SELECT * FROM storages WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL',
    [orgId, id]
  );
  if (res.rows.length === 0) {
    throw notFound('Storage not found', 'STORAGE_NOT_FOUND');
  }
  return res.rows[0];
}

/**
 * Get full StorageDetail including hierarchical places, items, entries, counts, and openReports.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} id
 * @returns {Promise<import('../types.js').StorageDetail>}
 */
export async function getStorageDetail(db, ctx, id) {
  const orgId = requireOrgId(ctx);
  const storageRow = await getStorageRow(db, ctx, id);

  const placesRes = await db.query(
    `SELECT * FROM places
     WHERE organization_id = $1 AND storage_id = $2 AND archived_at IS NULL
     ORDER BY name ASC`,
    [orgId, id]
  );
  const pathMap = buildPlacePaths(placesRes.rows);
  const placeIds = placesRes.rows.map((p) => p.id);

  /** @type {Map<string, import('../types.js').Item[]>} */
  const itemsByPlace = new Map(placeIds.map((pid) => [pid, []]));
  /** @type {Map<string, import('../types.js').Entry[]>} */
  const entriesByPlace = new Map(placeIds.map((pid) => [pid, []]));
  /** @type {Map<string, import('../types.js').Counts>} */
  const countsByPlace = new Map(placeIds.map((pid) => [pid, emptyCounts()]));

  const storageCounts = emptyCounts();
  storageCounts.places = placesRes.rows.length;

  /** @type {Map<string, number>} */
  const openReportKinds = new Map();

  const { todayStr, soonStr } = getExpiryBounds();

  if (placeIds.length > 0) {
    const placePlaceholders = placeIds.map((_, idx) => `$${idx + 2}`).join(', ');
    const [itemsRes, itemCodesRes, entriesRes, reportsRes] = await Promise.all([
      db.query(
        `SELECT * FROM items
         WHERE organization_id = $1 AND archived_at IS NULL AND place_id IN (${placePlaceholders})
         ORDER BY name ASC`,
        [orgId, ...placeIds]
      ),
      db.query(
        `SELECT target_id, code FROM codes
         WHERE organization_id = $1 AND kind = 'item' AND voided_at IS NULL`,
        [orgId]
      ),
      db.query(
        `SELECT * FROM place_entries
         WHERE organization_id = $1 AND archived_at IS NULL AND place_id IN (${placePlaceholders})
         ORDER BY sort_order ASC, name ASC`,
        [orgId, ...placeIds]
      ),
      db.query(
        `SELECT place_id, kind FROM reports
         WHERE organization_id = $1 AND status = 'open' AND place_id IN (${placePlaceholders})`,
        [orgId, ...placeIds]
      ),
    ]);

    const itemCodeMap = new Map(itemCodesRes.rows.map((c) => [c.target_id, c.code]));

    for (const row of itemsRes.rows) {
      const expiresOn = formatDateOnly(row.expires_on);
      /** @type {import('../types.js').Item} */
      const item = {
        id: row.id,
        placeId: row.place_id,
        name: row.name,
        description: row.description || '',
        category: row.category || '',
        status: row.status,
        expiresOn,
        minQuantity: row.min_quantity != null ? Number(row.min_quantity) : null,
        code: itemCodeMap.get(row.id) || null,
        leaseable: Boolean(row.leaseable),
        leasedTo: row.leased_to || null,
        leasedAt: formatIso(row.leased_at),
      };
      itemsByPlace.get(row.place_id)?.push(item);

      const pc = countsByPlace.get(row.place_id);
      if (pc) {
        pc.items += 1;
        if (item.status === 'depleted') pc.depleted += 1;
        if (item.status === 'broken') pc.broken += 1;
        const exp = classifyExpiry(expiresOn, todayStr, soonStr);
        if (exp.isExpired) pc.expired += 1;
        if (exp.isExpiringSoon) pc.expiringSoon += 1;
      }

      storageCounts.items += 1;
      if (item.status === 'depleted') storageCounts.depleted += 1;
      if (item.status === 'broken') storageCounts.broken += 1;
      const exp = classifyExpiry(expiresOn, todayStr, soonStr);
      if (exp.isExpired) storageCounts.expired += 1;
      if (exp.isExpiringSoon) storageCounts.expiringSoon += 1;
    }

    for (const row of entriesRes.rows) {
      const expiresOn = formatDateOnly(row.expires_on);
      /** @type {import('../types.js').Entry} */
      const entry = {
        id: row.id,
        placeId: row.place_id,
        name: row.name,
        quantityNote: row.quantity_note || '',
        quantity: row.quantity != null ? Number(row.quantity) : null,
        minQuantity: row.min_quantity != null ? Number(row.min_quantity) : null,
        expiresOn,
        status: row.status,
        sortOrder: Number(row.sort_order ?? 0),
      };
      entriesByPlace.get(row.place_id)?.push(entry);

      const pc = countsByPlace.get(row.place_id);
      if (pc) {
        pc.entries += 1;
        if (entry.status === 'depleted') pc.depleted += 1;
        const exp = classifyExpiry(expiresOn, todayStr, soonStr);
        if (exp.isExpired) pc.expired += 1;
        if (exp.isExpiringSoon) pc.expiringSoon += 1;
      }

      storageCounts.entries += 1;
      if (entry.status === 'depleted') storageCounts.depleted += 1;
      const exp = classifyExpiry(expiresOn, todayStr, soonStr);
      if (exp.isExpired) storageCounts.expired += 1;
      if (exp.isExpiringSoon) storageCounts.expiringSoon += 1;
    }

    for (const rep of reportsRes.rows) {
      const pc = countsByPlace.get(rep.place_id);
      if (pc) pc.openReports += 1;
      storageCounts.openReports += 1;
      openReportKinds.set(rep.kind, (openReportKinds.get(rep.kind) || 0) + 1);
    }
  }

  const storageCodeRes = await db.query(
    `SELECT code FROM codes
     WHERE organization_id = $1 AND kind = 'storage' AND target_id = $2 AND voided_at IS NULL
     LIMIT 1`,
    [orgId, id]
  );

  /** @type {import('../types.js').PlaceDetail[]} */
  const places = placesRes.rows.map((p) => ({
    id: p.id,
    storageId: p.storage_id,
    parentPlaceId: p.parent_place_id ?? null,
    name: p.name,
    description: p.description || '',
    pinX: p.pin_x != null ? Number(p.pin_x) : null,
    pinY: p.pin_y != null ? Number(p.pin_y) : null,
    pinLabel: p.pin_label || '',
    path: pathMap.get(p.id) || [p.name],
    reportConfig: p.report_config || {},
    items: itemsByPlace.get(p.id) || [],
    entries: entriesByPlace.get(p.id) || [],
    counts: countsByPlace.get(p.id) || emptyCounts(),
  }));

  const storageImages = await listImagesForOwner(db, ctx, 'storage', id);
  const allItemIds = places.flatMap((p) => p.items.map((it) => it.id));
  if (allItemIds.length > 0) {
    const itemImagesMap = await listImagesForOwners(db, ctx, 'item', allItemIds);
    for (const p of places) {
      for (const it of p.items) {
        it.images = itemImagesMap.get(it.id) || [];
      }
    }
  }

  const summary = mapStorageSummary(storageRow, storageCounts);
  return {
    ...summary,
    imageUrl: storageRow.image_key ? `/api/files/${storageRow.image_key}` : null,
    imageWidth: storageRow.image_width != null ? Number(storageRow.image_width) : null,
    imageHeight: storageRow.image_height != null ? Number(storageRow.image_height) : null,
    images: storageImages,
    code: storageCodeRes.rows[0]?.code || null,
    places,
    openReports: Array.from(openReportKinds.entries()).map(([kind, count]) => ({
      kind: /** @type {import('../types.js').ReportKind} */ (kind),
      count,
    })),
  };
}

/**
 * Create a new storage.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {{
 *   name: string,
 *   kind?: import('../types.js').StorageKind,
 *   description?: string,
 *   publicListed?: boolean,
 *   inspectionIntervalDays?: number | null,
 *   reportConfig?: import('../types.js').ReportConfig
 * }} data
 */
export async function createStorage(db, ctx, data) {
  const orgId = requireOrgId(ctx);
  const id = crypto.randomUUID();
  const res = await db.query(
    `INSERT INTO storages (
       id, organization_id, name, kind, description, public_listed, inspection_interval_days, report_config
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     RETURNING *`,
    [
      id,
      orgId,
      data.name,
      data.kind || 'room',
      data.description ?? '',
      data.publicListed !== undefined ? Boolean(data.publicListed) : true,
      data.inspectionIntervalDays ?? null,
      JSON.stringify(data.reportConfig || {}),
    ]
  );
  return mapStorageSummary(res.rows[0], emptyCounts());
}

/**
 * Update an existing storage.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} id
 * @param {Record<string, any>} data
 */
export async function updateStorage(db, ctx, id, data) {
  const orgId = requireOrgId(ctx);
  const existing = await getStorageRow(db, ctx, id);

  const name = data.name !== undefined ? data.name : existing.name;
  const kind = data.kind !== undefined ? data.kind : existing.kind;
  const description = data.description !== undefined ? data.description : existing.description;
  const publicListed =
    data.publicListed !== undefined ? Boolean(data.publicListed) : existing.public_listed;
  const inspectionIntervalDays =
    data.inspectionIntervalDays !== undefined
      ? data.inspectionIntervalDays
      : existing.inspection_interval_days;
  const reportConfig =
    data.reportConfig !== undefined ? data.reportConfig : existing.report_config;

  await db.query(
    `UPDATE storages
     SET name = $3,
         kind = $4,
         description = $5,
         public_listed = $6,
         inspection_interval_days = $7,
         report_config = $8::jsonb,
         updated_at = CURRENT_TIMESTAMP
     WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL`,
    [
      orgId,
      id,
      name,
      kind,
      description,
      publicListed,
      inspectionIntervalDays,
      JSON.stringify(reportConfig || {}),
    ]
  );

  return getStorageDetail(db, ctx, id);
}

/**
 * Soft-delete (archive) a storage.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} id
 */
export async function archiveStorage(db, ctx, id) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    `UPDATE storages SET archived_at = CURRENT_TIMESTAMP
     WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL
     RETURNING id`,
    [orgId, id]
  );
  if (res.rows.length === 0) {
    throw notFound('Storage not found', 'STORAGE_NOT_FOUND');
  }
}

/**
 * Update a storage's image metadata.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} id
 * @param {{ imageKey: string, imageWidth: number, imageHeight: number }} img
 */
export async function updateStorageImage(db, ctx, id, img) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    `UPDATE storages
     SET image_key = $3, image_width = $4, image_height = $5, updated_at = CURRENT_TIMESTAMP
     WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL
     RETURNING *`,
    [orgId, id, img.imageKey, img.imageWidth, img.imageHeight]
  );
  if (res.rows.length === 0) {
    throw notFound('Storage not found', 'STORAGE_NOT_FOUND');
  }
  return getStorageDetail(db, ctx, id);
}

/**
 * Record a storage inspection (e.g. for first-aid boxes) and log to item_history.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} id
 * @param {string} actorSub
 */
export async function recordInspection(db, ctx, id, actorSub) {
  const orgId = requireOrgId(ctx);
  await getStorageRow(db, ctx, id);

  await db.withTransaction(async (client) => {
    await client.query(
      `UPDATE storages
       SET last_inspected_at = CURRENT_TIMESTAMP,
           last_inspected_by_sub = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL`,
      [orgId, id, actorSub]
    );

    await client.query(
      `INSERT INTO item_history (id, organization_id, storage_id, event_type, actor_sub)
       VALUES ($1, $2, $3, 'inspection', $4)`,
      [crypto.randomUUID(), orgId, id, actorSub]
    );
  });

  return getStorageDetail(db, ctx, id);
}

/**
 * Update or clear a storage's custom QR logo key.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} id
 * @param {string | null} logoKey
 */
export async function updateStorageLogo(db, ctx, id, logoKey) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    `UPDATE storages
     SET logo_key = $3, updated_at = CURRENT_TIMESTAMP
     WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL
     RETURNING id`,
    [orgId, id, logoKey]
  );
  if (res.rows.length === 0) {
    throw notFound('Storage not found', 'STORAGE_NOT_FOUND');
  }
  return getStorageDetail(db, ctx, id);
}

/**
 * Get the organization's default logo key (if uploaded).
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @returns {Promise<string | null>}
 */
export async function getOrganizationLogoKey(db, ctx) {
  const orgId = requireOrgId(ctx);
  const res = await db.query('SELECT logo_key FROM organizations WHERE id = $1', [orgId]);
  return res.rows[0]?.logo_key || null;
}

/**
 * Set or clear the organization's default QR logo key.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string | null} logoKey
 * @returns {Promise<string | null>}
 */
export async function updateOrganizationLogo(db, ctx, logoKey) {
  const orgId = requireOrgId(ctx);
  await db.query('UPDATE organizations SET logo_key = $2 WHERE id = $1', [orgId, logoKey]);
  return logoKey;
}

/**
 * Resolve the effective logo key for a label target (storage logo -> org logo -> null).
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {import('../types.js').LabelTarget} target
 * @returns {Promise<string | null>}
 */
export async function resolveLogoKeyForTarget(db, ctx, target) {
  const orgId = requireOrgId(ctx);
  if (target.storageId) {
    const res = await db.query(
      'SELECT logo_key FROM storages WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL',
      [orgId, target.storageId]
    );
    if (res.rows[0]?.logo_key) {
      return res.rows[0].logo_key;
    }
  }
  return getOrganizationLogoKey(db, ctx);
}

/**
 * Resolve the effective logo key for a QR code (storage logo -> org logo -> null).
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} code
 * @returns {Promise<string | null>}
 */
export async function resolveLogoKeyForCode(db, ctx, code) {
  const orgId = requireOrgId(ctx);
  const codeRes = await db.query(
    'SELECT kind, target_id FROM codes WHERE organization_id = $1 AND code = $2 AND voided_at IS NULL',
    [orgId, code]
  );
  if (codeRes.rows.length > 0) {
    const { kind, target_id: targetId } = codeRes.rows[0];
    let storageId = null;
    if (kind === 'storage') {
      storageId = targetId;
    } else if (kind === 'place') {
      const pRes = await db.query(
        'SELECT storage_id FROM places WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL',
        [orgId, targetId]
      );
      storageId = pRes.rows[0]?.storage_id || null;
    } else if (kind === 'item') {
      const iRes = await db.query(
        `SELECT p.storage_id
         FROM items i
         JOIN places p ON p.id = i.place_id
         WHERE i.organization_id = $1 AND i.id = $2 AND i.archived_at IS NULL`,
        [orgId, targetId]
      );
      storageId = iRes.rows[0]?.storage_id || null;
    }
    if (storageId) {
      const sRes = await db.query(
        'SELECT logo_key FROM storages WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL',
        [orgId, storageId]
      );
      if (sRes.rows[0]?.logo_key) {
        return sRes.rows[0].logo_key;
      }
    }
  }
  return getOrganizationLogoKey(db, ctx);
}
