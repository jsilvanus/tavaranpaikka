import { generateCode, isValidCode, normalizeCode } from '../labels/codes.js';
import { badRequest, notFound } from '../errors.js';
import { formatDateOnly, formatIso, requireOrgId } from './helpers.js';
import { getItemById } from './itemsRepo.js';
import { getStorageDetail } from './storagesRepo.js';

const VALID_CODE_KINDS = new Set(['item', 'place', 'storage']);

/**
 * Verify that the target exists and is not archived in the given organization.
 * @param {import('../db.js').DbClient} db
 * @param {string} orgId
 * @param {import('../types.js').CodeKind} kind
 * @param {string} targetId
 */
async function assertTargetExists(db, orgId, kind, targetId) {
  const table = kind === 'item' ? 'items' : kind === 'place' ? 'places' : 'storages';
  const res = await db.query(
    `SELECT id FROM ${table} WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL`,
    [orgId, targetId]
  );
  if (res.rows.length === 0) {
    throw notFound(`${kind} not found`, `${kind.toUpperCase()}_NOT_FOUND`);
  }
}

/**
 * Issue a code for a target (idempotent if an active code already exists).
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {import('../types.js').CodeKind} kind
 * @param {string} targetId
 */
export async function issueCode(db, ctx, kind, targetId) {
  const orgId = requireOrgId(ctx);
  if (!VALID_CODE_KINDS.has(kind)) {
    throw badRequest('Invalid code kind', 'INVALID_CODE_KIND');
  }
  await assertTargetExists(db, orgId, kind, targetId);

  const existing = await db.query(
    `SELECT * FROM codes
     WHERE organization_id = $1 AND kind = $2 AND target_id = $3 AND voided_at IS NULL
     LIMIT 1`,
    [orgId, kind, targetId]
  );
  if (existing.rows.length > 0) {
    const r = existing.rows[0];
    return {
      code: r.code,
      kind: r.kind,
      targetId: r.target_id,
      createdAt: formatIso(r.created_at),
      printedAt: formatIso(r.printed_at),
    };
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = normalizeCode(generateCode());
    try {
      const inserted = await db.query(
        `INSERT INTO codes (code, organization_id, kind, target_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [code, orgId, kind, targetId]
      );
      const r = inserted.rows[0];
      return {
        code: r.code,
        kind: r.kind,
        targetId: r.target_id,
        createdAt: formatIso(r.created_at),
        printedAt: null,
      };
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
        continue;
      }
      throw err;
    }
  }
  throw new Error('Failed to generate unique code after 10 attempts');
}

/**
 * Void an active code.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} rawCode
 */
export async function voidCode(db, ctx, rawCode) {
  const orgId = requireOrgId(ctx);
  const code = normalizeCode(rawCode);
  const res = await db.query(
    `UPDATE codes SET voided_at = CURRENT_TIMESTAMP
     WHERE organization_id = $1 AND code = $2 AND voided_at IS NULL
     RETURNING code, voided_at`,
    [orgId, code]
  );
  if (res.rows.length === 0) {
    throw notFound('Active code not found', 'CODE_NOT_FOUND');
  }
  return { code: res.rows[0].code, voidedAt: formatIso(res.rows[0].voided_at) };
}

/**
 * Strip StorageDetail down to StorageSummary.
 * @param {import('../types.js').StorageDetail} detail
 * @returns {import('../types.js').StorageSummary}
 */
function toSummary(detail) {
  return {
    id: detail.id,
    name: detail.name,
    kind: detail.kind,
    description: detail.description,
    hasImage: detail.hasImage,
    publicListed: detail.publicListed,
    responsiblePersonName: detail.responsiblePersonName || null,
    inspectionIntervalDays: detail.inspectionIntervalDays,
    lastInspectedAt: detail.lastInspectedAt,
    inspectionDue: detail.inspectionDue,
    counts: detail.counts,
  };
}

/**
 * Strip PlaceDetail down to Place.
 * @param {import('../types.js').PlaceDetail} pd
 * @returns {import('../types.js').Place}
 */
function toPlace(pd) {
  return {
    id: pd.id,
    storageId: pd.storageId,
    parentPlaceId: pd.parentPlaceId,
    name: pd.name,
    description: pd.description,
    pinX: pd.pinX,
    pinY: pd.pinY,
    pinLabel: pd.pinLabel,
    path: pd.path,
    reportConfig: pd.reportConfig,
  };
}

/**
 * Resolve a public code globally (returns null if invalid, unknown, voided, or target archived).
 * @param {import('../db.js').DbClient} db
 * @param {string} rawCode
 * @returns {Promise<import('../types.js').CodeResolution | null>}
 */
export async function resolvePublicCode(db, ctx, rawCode) {
  const orgId = requireOrgId(ctx);
  const code = normalizeCode(rawCode);
  if (!isValidCode(code)) {
    return null;
  }

  const res = await db.query(
    'SELECT * FROM codes WHERE organization_id = $1 AND code = $2 AND voided_at IS NULL',
    [orgId, code]
  );
  if (res.rows.length === 0) {
    return null;
  }
  const codeRow = res.rows[0];

  const loadOpenReports = async (filterSql, filterParams) => {
    const rRes = await db.query(
      `SELECT r.id, r.place_id, r.item_id, r.entry_id, r.kind, r.note, r.status, r.created_at,
              COUNT(rv.report_id) AS vote_count
       FROM reports r
       LEFT JOIN report_votes rv ON rv.report_id = r.id
       WHERE r.organization_id = $1 AND r.status IN ('open', 'acknowledged') AND ${filterSql}
       GROUP BY r.id
       ORDER BY r.created_at DESC`,
      [orgId, ...filterParams]
    );
    return rRes.rows.map((r) => ({
      id: r.id,
      placeId: r.place_id,
      itemId: r.item_id || null,
      entryId: r.entry_id || null,
      kind: r.kind,
      note: r.note || '',
      status: r.status,
      votes: 1 + Number(r.vote_count || 0),
      createdAt: formatIso(r.created_at),
    }));
  };

  try {
    if (codeRow.kind === 'storage') {
      const detail = await getStorageDetail(db, ctx, codeRow.target_id);
      const placeIds = detail.places.map((p) => p.id);
      let openReports = [];
      if (placeIds.length > 0) {
        const ph = placeIds.map((_, i) => `$${i + 2}`).join(', ');
        openReports = await loadOpenReports(`r.place_id IN (${ph})`, placeIds);
      }
      return {
        kind: 'storage',
        storage: toSummary(detail),
        place: null,
        item: null,
        placeDetail: null,
        openReports,
      };
    }

    if (codeRow.kind === 'place') {
      const placeRes = await db.query(
        'SELECT storage_id FROM places WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL',
        [orgId, codeRow.target_id]
      );
      if (placeRes.rows.length === 0) return null;
      const detail = await getStorageDetail(db, ctx, placeRes.rows[0].storage_id);
      const pd = detail.places.find((p) => p.id === codeRow.target_id) || null;
      if (!pd) return null;
      const openReports = await loadOpenReports('r.place_id = $2', [pd.id]);
      return {
        kind: 'place',
        storage: toSummary(detail),
        place: toPlace(pd),
        item: null,
        placeDetail: pd,
        openReports,
      };
    }

    if (codeRow.kind === 'item') {
      const item = await getItemById(db, ctx, codeRow.target_id);
      if (!item.placeId) {
        return {
          kind: 'item',
          // @ts-ignore - unplaced item has no storage
          storage: null,
          place: null,
          item,
          placeDetail: null,
          openReports: [],
        };
      }
      const placeRes = await db.query(
        'SELECT storage_id FROM places WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL',
        [orgId, item.placeId]
      );
      if (placeRes.rows.length === 0) return null;
      const detail = await getStorageDetail(db, ctx, placeRes.rows[0].storage_id);
      const pd = detail.places.find((p) => p.id === item.placeId) || null;
      const openReports = await loadOpenReports('r.item_id = $2', [item.id]);
      return {
        kind: 'item',
        storage: toSummary(detail),
        place: pd ? toPlace(pd) : null,
        item,
        placeDetail: pd,
        openReports,
      };
    }
  } catch (err) {
    if (err && typeof err === 'object' && 'statusCode' in err && err.statusCode === 404) {
      return null;
    }
    throw err;
  }

  return null;
}

/**
 * List label targets for the /api/labels/targets endpoint.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {{ storageId?: string, kind?: string, notPrinted?: boolean, q?: string }} [filters]
 * @returns {Promise<import('../types.js').LabelTarget[]>}
 */
export async function getLabelTargets(db, ctx, filters = {}) {
  const orgId = requireOrgId(ctx);
  const [storagesRes, placesRes, itemsRes, codesRes] = await Promise.all([
    db.query('SELECT * FROM storages WHERE organization_id = $1 AND archived_at IS NULL', [orgId]),
    db.query('SELECT * FROM places WHERE organization_id = $1 AND archived_at IS NULL', [orgId]),
    db.query('SELECT * FROM items WHERE organization_id = $1 AND archived_at IS NULL', [orgId]),
    db.query(
      'SELECT kind, target_id, code, printed_at FROM codes WHERE organization_id = $1 AND voided_at IS NULL',
      [orgId]
    ),
  ]);

  const storageMap = new Map(storagesRes.rows.map((s) => [s.id, s]));
  const placeMap = new Map(placesRes.rows.map((p) => [p.id, p]));
  const codeMap = new Map(codesRes.rows.map((c) => [`${c.kind}:${c.target_id}`, c]));

  /** @param {string} placeId */
  function getPlacePath(placeId) {
    const path = [];
    let curr = placeMap.get(placeId);
    const seen = new Set();
    while (curr && !seen.has(curr.id)) {
      seen.add(curr.id);
      path.unshift(curr.name);
      curr = curr.parent_place_id ? placeMap.get(curr.parent_place_id) : undefined;
    }
    return path;
  }

  /** @type {import('../types.js').LabelTarget[]} */
  const targets = [];

  if (!filters.kind || filters.kind === 'storage') {
    for (const s of storagesRes.rows) {
      if (filters.storageId && s.id !== filters.storageId) continue;
      const c = codeMap.get(`storage:${s.id}`);
      targets.push({
        kind: 'storage',
        id: s.id,
        code: c?.code || null,
        name: s.name,
        placePath: [],
        storageName: s.name,
        storageId: s.id,
        printedAt: formatIso(c?.printed_at),
      });
    }
  }

  if (!filters.kind || filters.kind === 'place') {
    for (const p of placesRes.rows) {
      if (filters.storageId && p.storage_id !== filters.storageId) continue;
      const s = storageMap.get(p.storage_id);
      if (!s) continue;
      const c = codeMap.get(`place:${p.id}`);
      targets.push({
        kind: 'place',
        id: p.id,
        code: c?.code || null,
        name: p.name,
        placePath: getPlacePath(p.id),
        storageName: s.name,
        storageId: s.id,
        printedAt: formatIso(c?.printed_at),
      });
    }
  }

  if (!filters.kind || filters.kind === 'item') {
    for (const item of itemsRes.rows) {
      const p = item.place_id ? placeMap.get(item.place_id) : null;
      const s = p ? storageMap.get(p.storage_id) : null;
      if (filters.storageId && (!s || s.id !== filters.storageId)) continue;
      const c = codeMap.get(`item:${item.id}`);
      targets.push({
        kind: 'item',
        id: item.id,
        code: c?.code || null,
        name: item.name,
        placePath: p ? getPlacePath(p.id) : [],
        storageName: s?.name || '',
        storageId: s?.id,
        printedAt: formatIso(c?.printed_at),
        expiresOn: formatDateOnly(item.expires_on),
      });
    }
  }

  let filtered = targets;
  if (filters.notPrinted) {
    filtered = filtered.filter((t) => !t.printedAt);
  }
  if (filters.q) {
    const q = filters.q.toLowerCase();
    filtered = filtered.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.storageName.toLowerCase().includes(q) ||
        (t.code && t.code.toLowerCase().includes(q))
    );
  }
  return filtered;
}

/**
 * Resolve specific label targets, issuing codes for any that don't have an active code yet.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {Array<{ kind: import('../types.js').CodeKind, id: string }>} refs
 * @returns {Promise<import('../types.js').LabelTarget[]>}
 */
export async function resolveLabelTargets(db, ctx, refs) {
  requireOrgId(ctx);
  for (const ref of refs) {
    await issueCode(db, ctx, ref.kind, ref.id);
  }
  const all = await getLabelTargets(db, ctx);
  const byKey = new Map(all.map((t) => [`${t.kind}:${t.id}`, t]));
  return refs.map((ref) => {
    const found = byKey.get(`${ref.kind}:${ref.id}`);
    if (!found) {
      throw notFound(`Target ${ref.kind}:${ref.id} not found`, 'TARGET_NOT_FOUND');
    }
    return found;
  });
}

/**
 * Mark codes as printed for the given targets.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {Array<{ kind: import('../types.js').CodeKind, id: string }>} refs
 */
export async function markCodesPrinted(db, ctx, refs) {
  const orgId = requireOrgId(ctx);
  for (const ref of refs) {
    await db.query(
      `UPDATE codes SET printed_at = COALESCE(printed_at, CURRENT_TIMESTAMP)
       WHERE organization_id = $1 AND kind = $2 AND target_id = $3 AND voided_at IS NULL`,
      [orgId, ref.kind, ref.id]
    );
  }
}
