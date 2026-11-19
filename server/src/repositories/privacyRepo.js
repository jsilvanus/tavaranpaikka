import { requireOrgId } from './helpers.js';
import { cleanupExpiredLeases, runLeaseRetentionCleanup } from './itemsRepo.js';

/**
 * Get per-tenant privacy, retention, and processor information.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @returns {Promise<import('../types.js').TenantPrivacyInfo>}
 */
export async function getTenantPrivacy(db, ctx) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    `SELECT name, controller_name, controller_contact, processors, privacy_extra, lease_retention_days
     FROM organizations
     WHERE id = $1`,
    [orgId]
  );
  const row = res.rows[0] || {};
  const rawProcessors = Array.isArray(row.processors) ? row.processors : [];
  return {
    organizationName: row.name || '',
    controllerName: row.controller_name || row.name || '',
    controllerContact: row.controller_contact || '',
    processors: rawProcessors.map((p) => ({
      name: String(p?.name || ''),
      purpose: String(p?.purpose || ''),
      location: String(p?.location || ''),
    })),
    privacyExtra: row.privacy_extra || '',
    leaseRetentionDays:
      row.lease_retention_days != null ? Number(row.lease_retention_days) : 365,
  };
}

/**
 * Update per-tenant privacy, retention, and processor information (admin only).
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {{
 *   controllerName?: string,
 *   controllerContact?: string,
 *   processors?: import('../types.js').PrivacyProcessor[],
 *   privacyExtra?: string,
 *   leaseRetentionDays?: number
 * }} data
 * @returns {Promise<import('../types.js').TenantPrivacyInfo>}
 */
export async function updateTenantPrivacy(db, ctx, data) {
  const orgId = requireOrgId(ctx);
  const current = await getTenantPrivacy(db, ctx);

  const controllerName =
    data.controllerName !== undefined ? data.controllerName : current.controllerName;
  const controllerContact =
    data.controllerContact !== undefined ? data.controllerContact : current.controllerContact;
  const processors = data.processors !== undefined ? data.processors : current.processors;
  const privacyExtra = data.privacyExtra !== undefined ? data.privacyExtra : current.privacyExtra;
  const leaseRetentionDays =
    data.leaseRetentionDays !== undefined
      ? data.leaseRetentionDays
      : current.leaseRetentionDays;

  await db.query(
    `UPDATE organizations
     SET controller_name = $2,
         controller_contact = $3,
         processors = $4::jsonb,
         privacy_extra = $5,
         lease_retention_days = $6
     WHERE id = $1`,
    [
      orgId,
      controllerName,
      controllerContact,
      JSON.stringify(processors),
      privacyExtra,
      leaseRetentionDays,
    ]
  );

  return getTenantPrivacy(db, ctx);
}

/**
 * Run privacy retention cleanups across reports, votes, audit events, and expired leases.
 * @param {import('../db.js').DbClient} db
 * @param {{ leaseRetentionDays?: number }} [config]
 * @param {{ organizationId?: string, now?: Date }} [options]
 * @returns {Promise<{
 *   clearedReportHashes: number,
 *   clearedReportNames: number,
 *   deletedReportVotes: number,
 *   deletedReports: number,
 *   deletedAuditEvents: number,
 *   deletedLeases: number
 * }>}
 */
export async function runPrivacyRetentionCleanup(db, config = {}, options = {}) {
  const now = options.now || new Date();
  const nowMs = now.getTime();
  const hashCutoff = new Date(nowMs - 7 * 86400_000).toISOString();
  const nameCutoff = new Date(nowMs - 365 * 86400_000).toISOString();
  const reportCutoff = new Date(nowMs - 730 * 86400_000).toISOString();
  const auditCutoff = new Date(nowMs - 365 * 86400_000).toISOString();

  const orgId = options.organizationId || null;

  const hashRes = orgId
    ? await db.query(
        `UPDATE reports SET reporter_hash = NULL
         WHERE organization_id = $1 AND reporter_hash IS NOT NULL AND created_at < $2`,
        [orgId, hashCutoff]
      )
    : await db.query(
        `UPDATE reports SET reporter_hash = NULL
         WHERE reporter_hash IS NOT NULL AND created_at < $1`,
        [hashCutoff]
      );

  const nameRes = orgId
    ? await db.query(
        `UPDATE reports SET reporter_name = NULL
         WHERE organization_id = $1 AND reporter_name IS NOT NULL AND resolved_at IS NOT NULL AND resolved_at < $2`,
        [orgId, nameCutoff]
      )
    : await db.query(
        `UPDATE reports SET reporter_name = NULL
         WHERE reporter_name IS NOT NULL AND resolved_at IS NOT NULL AND resolved_at < $1`,
        [nameCutoff]
      );

  const oldReportsRes = orgId
    ? await db.query(
        `SELECT id FROM reports WHERE organization_id = $1 AND created_at < $2`,
        [orgId, reportCutoff]
      )
    : await db.query(`SELECT id FROM reports WHERE created_at < $1`, [reportCutoff]);

  const oldReportIds = oldReportsRes.rows.map((r) => r.id);
  let deletedReportVotes = 0;
  let deletedReports = 0;

  if (oldReportIds.length > 0) {
    const placeholders = oldReportIds.map((_, idx) => `$${idx + 1}`).join(', ');
    const voteByReportRes = await db.query(
      `DELETE FROM report_votes WHERE report_id IN (${placeholders})`,
      oldReportIds
    );
    deletedReportVotes += voteByReportRes.rowCount || 0;

    await db.query(
      `DELETE FROM notifications WHERE report_id IN (${placeholders})`,
      oldReportIds
    );

    const repDelRes = await db.query(
      `DELETE FROM reports WHERE id IN (${placeholders})`,
      oldReportIds
    );
    deletedReports = repDelRes.rowCount || 0;
  }

  // Also delete any remaining report_votes older than 730 days (when not scoped to org)
  if (!orgId) {
    const oldVotesRes = await db.query(
      `DELETE FROM report_votes WHERE created_at < $1`,
      [reportCutoff]
    );
    deletedReportVotes += oldVotesRes.rowCount || 0;
  }

  const auditRes = orgId
    ? await db.query(
        `DELETE FROM audit_events WHERE organization_id = $1 AND created_at < $2`,
        [orgId, auditCutoff]
      )
    : await db.query(`DELETE FROM audit_events WHERE created_at < $1`, [auditCutoff]);

  const deletedLeases = orgId
    ? await cleanupExpiredLeases(db, { organizationId: orgId, locale: 'fi' }, undefined, now)
    : await runLeaseRetentionCleanup(db, config?.leaseRetentionDays ?? 365);

  return {
    clearedReportHashes: hashRes.rowCount || 0,
    clearedReportNames: nameRes.rowCount || 0,
    deletedReportVotes,
    deletedReports,
    deletedAuditEvents: auditRes.rowCount || 0,
    deletedLeases,
  };
}
