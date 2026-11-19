import { requireOrgId } from './helpers.js';

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
