import crypto from 'node:crypto';
import { badRequest, notFound, tooManyRequests, unauthorized } from '../errors.js';
import { formatIso, requireOrgId } from './helpers.js';

/**
 * Map a report row to API Report object.
 * @param {Record<string, any>} row
 */
export function mapReport(row) {
  return {
    id: row.id,
    placeId: row.place_id,
    storageId: row.storage_id ?? null,
    storageName: row.storage_name ?? null,
    placeName: row.place_name ?? null,
    itemId: row.item_id ?? null,
    itemName: row.item_name ?? null,
    entryId: row.entry_id ?? null,
    entryName: row.entry_name ?? null,
    kind: row.kind,
    note: row.note || '',
    reporterName: row.reporter_name || '',
    locale: row.locale || 'fi',
    status: row.status,
    votes: Number(row.votes ?? 1),
    createdAt: formatIso(row.created_at),
    acknowledgedAt: formatIso(row.acknowledged_at),
    resolvedAt: formatIso(row.resolved_at),
  };
}

/**
 * Resolve effective report config (place > storage > org).
 * @param {Record<string, any>} orgConfig
 * @param {Record<string, any>} storageConfig
 * @param {Record<string, any>} placeConfig
 * @returns {import('../types.js').ReportConfig}
 */
function mergeReportConfig(orgConfig, storageConfig, placeConfig) {
  return {
    kinds: ['depleted', 'broken', 'expired', 'other'],
    allowNote: true,
    allowPhoto: false,
    askName: true,
    requireSignin: false,
    ...(orgConfig || {}),
    ...(storageConfig || {}),
    ...(placeConfig || {}),
  };
}

/**
 * Create a public report with rate limiting, "me too" deduplication, status update, and outbox notification.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} placeId
 * @param {{
 *   itemId?: string | null,
 *   entryId?: string | null,
 *   kind: import('../types.js').ReportKind,
 *   note?: string,
 *   name?: string
 * }} payload
 * @param {string} reporterHash
 * @param {{ sub: string } | null} [user]
 */
export async function createPublicReport(db, ctx, placeId, payload, reporterHash, user = null) {
  const orgId = requireOrgId(ctx);

  if (payload.itemId && payload.entryId) {
    throw badRequest('Specify either itemId or entryId, not both', 'INVALID_REPORT_TARGET');
  }

  const placeRes = await db.query(
    `SELECT p.*, s.report_config AS storage_report_config, o.report_config AS org_report_config
     FROM places p
     JOIN storages s ON s.id = p.storage_id AND s.organization_id = p.organization_id
     JOIN organizations o ON o.id = p.organization_id
     WHERE p.organization_id = $1 AND p.id = $2 AND p.archived_at IS NULL AND s.archived_at IS NULL`,
    [orgId, placeId]
  );
  if (placeRes.rows.length === 0) {
    throw notFound('Place not found', 'PLACE_NOT_FOUND');
  }
  const placeRow = placeRes.rows[0];
  const effectiveConfig = mergeReportConfig(
    placeRow.org_report_config,
    placeRow.storage_report_config,
    placeRow.report_config
  );

  if (effectiveConfig.requireSignin && !user) {
    throw unauthorized('Sign-in is required to report for this place', 'SIGNIN_REQUIRED');
  }
  if (effectiveConfig.kinds && !effectiveConfig.kinds.includes(payload.kind)) {
    throw badRequest(`Report kind "${payload.kind}" is not enabled for this place`, 'INVALID_REPORT_KIND');
  }

  // Rate limit: 10/hour per reporterHash, 30/hour per place
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
  const hashRateRes = await db.query(
    `SELECT COUNT(*)::int AS cnt FROM reports
     WHERE organization_id = $1 AND reporter_hash = $2 AND created_at >= $3`,
    [orgId, reporterHash, oneHourAgo]
  );
  if (Number(hashRateRes.rows[0].cnt) >= 10) {
    throw tooManyRequests('Rate limit exceeded for reporter', 'REPORTER_RATE_LIMIT');
  }

  const placeRateRes = await db.query(
    `SELECT COUNT(*)::int AS cnt FROM reports
     WHERE organization_id = $1 AND place_id = $2 AND created_at >= $3`,
    [orgId, placeId, oneHourAgo]
  );
  if (Number(placeRateRes.rows[0].cnt) >= 30) {
    throw tooManyRequests('Rate limit exceeded for place', 'PLACE_RATE_LIMIT');
  }

  if (payload.itemId) {
    const itemRes = await db.query(
      'SELECT id FROM items WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL',
      [orgId, payload.itemId]
    );
    if (itemRes.rows.length === 0) {
      throw notFound('Item not found', 'ITEM_NOT_FOUND');
    }
  }
  if (payload.entryId) {
    const entryRes = await db.query(
      'SELECT id FROM place_entries WHERE organization_id = $1 AND id = $2 AND place_id = $3 AND archived_at IS NULL',
      [orgId, payload.entryId, placeId]
    );
    if (entryRes.rows.length === 0) {
      throw notFound('Entry not found', 'ENTRY_NOT_FOUND');
    }
  }

  // Check for existing open report of same kind on same target ("me too" deduplication)
  const dupConditions = [
    'organization_id = $1',
    'place_id = $2',
    'kind = $3',
    "status = 'open'",
  ];
  /** @type {unknown[]} */
  const dupParams = [orgId, placeId, payload.kind];

  if (payload.itemId) {
    dupParams.push(payload.itemId);
    dupConditions.push(`item_id = $${dupParams.length}`);
  } else {
    dupConditions.push('item_id IS NULL');
  }

  if (payload.entryId) {
    dupParams.push(payload.entryId);
    dupConditions.push(`entry_id = $${dupParams.length}`);
  } else {
    dupConditions.push('entry_id IS NULL');
  }

  const existingOpen = await db.query(
    `SELECT id FROM reports WHERE ${dupConditions.join(' AND ')} LIMIT 1`,
    dupParams
  );

  if (existingOpen.rows.length > 0) {
    const existingId = existingOpen.rows[0].id;
    await db.withTransaction(async (client) => {
      await client.query(
        `INSERT INTO report_votes (report_id, voter_hash)
         VALUES ($1, $2)
         ON CONFLICT (report_id, voter_hash) DO NOTHING`,
        [existingId, reporterHash]
      );
      await client.query(
        `UPDATE reports
         SET votes = (SELECT COUNT(*)::int FROM report_votes WHERE report_id = $1)
         WHERE organization_id = $2 AND id = $1`,
        [existingId, orgId]
      );
    });
    const reportRow = await getReportById(db, ctx, existingId);
    return { ...reportRow, deduplicated: true };
  }

  const reportId = crypto.randomUUID();
  const note = effectiveConfig.allowNote !== false ? (payload.note || '').slice(0, 500) : '';
  const reporterName = effectiveConfig.askName !== false ? (payload.name || '').slice(0, 120) : '';

  await db.withTransaction(async (client) => {
    await client.query(
      `INSERT INTO reports (
         id, organization_id, place_id, item_id, entry_id, kind, note, reporter_name, reporter_sub, reporter_hash, locale, status, votes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'open', 1)`,
      [
        reportId,
        orgId,
        placeId,
        payload.itemId ?? null,
        payload.entryId ?? null,
        payload.kind,
        note,
        reporterName,
        user?.sub ?? null,
        reporterHash,
        ctx.locale || 'fi',
      ]
    );

    await client.query(
      `INSERT INTO report_votes (report_id, voter_hash) VALUES ($1, $2) ON CONFLICT (report_id, voter_hash) DO NOTHING`,
      [reportId, reporterHash]
    );

    if (payload.itemId && (payload.kind === 'depleted' || payload.kind === 'broken')) {
      await client.query(
        `UPDATE items SET status = $3, updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $1 AND id = $2`,
        [orgId, payload.itemId, payload.kind]
      );
    }

    if (payload.entryId && payload.kind === 'depleted') {
      await client.query(
        `UPDATE place_entries SET status = 'depleted', updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $1 AND id = $2`,
        [orgId, payload.entryId]
      );
    }

    const recipients = Array.isArray(effectiveConfig.recipients) ? effectiveConfig.recipients : [];
    for (const recipientRef of recipients) {
      await client.query(
        `INSERT INTO notifications (id, organization_id, report_id, channel, recipient_ref, state)
         VALUES ($1, $2, $3, 'email', $4, 'pending')`,
        [crypto.randomUUID(), orgId, reportId, String(recipientRef)]
      );
    }
  });

  const created = await getReportById(db, ctx, reportId);
  return { ...created, deduplicated: false };
}

/**
 * Add a "me too" vote to a report.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} reportId
 * @param {string} voterHash
 * @returns {Promise<{ votes: number }>}
 */
export async function voteReport(db, ctx, reportId, voterHash) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    'SELECT id FROM reports WHERE organization_id = $1 AND id = $2',
    [orgId, reportId]
  );
  if (res.rows.length === 0) {
    throw notFound('Report not found', 'REPORT_NOT_FOUND');
  }

  const votes = await db.withTransaction(async (client) => {
    await client.query(
      `INSERT INTO report_votes (report_id, voter_hash)
       VALUES ($1, $2)
       ON CONFLICT (report_id, voter_hash) DO NOTHING`,
      [reportId, voterHash]
    );
    const updated = await client.query(
      `UPDATE reports
       SET votes = (SELECT COUNT(*)::int FROM report_votes WHERE report_id = $1)
       WHERE organization_id = $2 AND id = $1
       RETURNING votes`,
      [reportId, orgId]
    );
    return Number(updated.rows[0].votes);
  });

  return { votes };
}

/**
 * Get a single report with joined names.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} reportId
 */
export async function getReportById(db, ctx, reportId) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    `SELECT r.*,
            p.name AS place_name,
            p.storage_id AS storage_id,
            s.name AS storage_name,
            i.name AS item_name,
            e.name AS entry_name
     FROM reports r
     JOIN places p ON p.id = r.place_id AND p.organization_id = r.organization_id
     JOIN storages s ON s.id = p.storage_id AND s.organization_id = r.organization_id
     LEFT JOIN items i ON i.id = r.item_id AND i.organization_id = r.organization_id
     LEFT JOIN place_entries e ON e.id = r.entry_id AND e.organization_id = r.organization_id
     WHERE r.organization_id = $1 AND r.id = $2`,
    [orgId, reportId]
  );
  if (res.rows.length === 0) {
    throw notFound('Report not found', 'REPORT_NOT_FOUND');
  }
  return mapReport(res.rows[0]);
}

/**
 * List reports for the keeper inbox.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {{ status?: string, storageId?: string, placeId?: string, kind?: string }} [filters]
 */
export async function listReports(db, ctx, filters = {}) {
  const orgId = requireOrgId(ctx);
  const conditions = ['r.organization_id = $1'];
  /** @type {unknown[]} */
  const params = [orgId];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`r.status = $${params.length}`);
  }
  if (filters.storageId) {
    params.push(filters.storageId);
    conditions.push(`p.storage_id = $${params.length}`);
  }
  if (filters.placeId) {
    params.push(filters.placeId);
    conditions.push(`r.place_id = $${params.length}`);
  }
  if (filters.kind) {
    params.push(filters.kind);
    conditions.push(`r.kind = $${params.length}`);
  }

  const res = await db.query(
    `SELECT r.*,
            p.name AS place_name,
            p.storage_id AS storage_id,
            s.name AS storage_name,
            i.name AS item_name,
            e.name AS entry_name
     FROM reports r
     JOIN places p ON p.id = r.place_id AND p.organization_id = r.organization_id
     JOIN storages s ON s.id = p.storage_id AND s.organization_id = r.organization_id
     LEFT JOIN items i ON i.id = r.item_id AND i.organization_id = r.organization_id
     LEFT JOIN place_entries e ON e.id = r.entry_id AND e.organization_id = r.organization_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY r.created_at DESC`,
    params
  );
  return res.rows.map(mapReport);
}

/**
 * Acknowledge a report.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} reportId
 * @param {string} actorSub
 */
export async function acknowledgeReport(db, ctx, reportId, actorSub) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    `UPDATE reports
     SET status = 'acknowledged',
         acknowledged_at = CURRENT_TIMESTAMP,
         acknowledged_by_sub = $3
     WHERE organization_id = $1 AND id = $2
     RETURNING id`,
    [orgId, reportId, actorSub]
  );
  if (res.rows.length === 0) {
    throw notFound('Report not found', 'REPORT_NOT_FOUND');
  }
  return getReportById(db, ctx, reportId);
}

/**
 * Resolve a report and reset the linked item/entry status to 'ok' (or 'retired').
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} reportId
 * @param {string} actorSub
 * @param {{ itemStatus?: 'ok' | 'retired' }} [options]
 */
export async function resolveReport(db, ctx, reportId, actorSub, options = {}) {
  const orgId = requireOrgId(ctx);
  const itemStatus = options.itemStatus === 'retired' ? 'retired' : 'ok';

  await db.withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE reports
       SET status = 'resolved',
           resolved_at = CURRENT_TIMESTAMP,
           resolved_by_sub = $3
       WHERE organization_id = $1 AND id = $2
       RETURNING item_id, entry_id`,
      [orgId, reportId, actorSub]
    );
    if (res.rows.length === 0) {
      throw notFound('Report not found', 'REPORT_NOT_FOUND');
    }
    const { item_id: itemId, entry_id: entryId } = res.rows[0];
    if (itemId) {
      await client.query(
        `UPDATE items SET status = $3, updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $1 AND id = $2`,
        [orgId, itemId, itemStatus]
      );
    }
    if (entryId) {
      await client.query(
        `UPDATE place_entries SET status = $3, updated_at = CURRENT_TIMESTAMP
         WHERE organization_id = $1 AND id = $2`,
        [orgId, entryId, itemStatus]
      );
    }
  });

  return getReportById(db, ctx, reportId);
}

/**
 * Dismiss a report (e.g. spam or false alarm).
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} reportId
 * @param {string} actorSub
 */
export async function dismissReport(db, ctx, reportId, actorSub) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    `UPDATE reports
     SET status = 'dismissed',
         resolved_at = CURRENT_TIMESTAMP,
         resolved_by_sub = $3
     WHERE organization_id = $1 AND id = $2
     RETURNING id`,
    [orgId, reportId, actorSub]
  );
  if (res.rows.length === 0) {
    throw notFound('Report not found', 'REPORT_NOT_FOUND');
  }
  return getReportById(db, ctx, reportId);
}
