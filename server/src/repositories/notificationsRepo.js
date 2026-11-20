import crypto from 'node:crypto';
import { notFound } from '../errors.js';
import { sendMail } from '../mail.js';
import { formatIso, requireOrgId } from './helpers.js';

/**
 * Create an in-app notification for keepers/admins (deduplicated if dedupKey is provided).
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {{
 *   kind: 'report' | 'expiring' | 'inspection_due',
 *   title: string,
 *   body?: string,
 *   linkUrl?: string,
 *   minRole?: 'keeper' | 'admin',
 *   dedupKey?: string | null
 * }} input
 */
export async function createInboxNotification(db, ctx, input) {
  const orgId = requireOrgId(ctx);
  if (input.dedupKey) {
    const existing = await db.query(
      `SELECT id FROM inbox_notifications
       WHERE organization_id = $1 AND dedup_key = $2 AND read_at IS NULL
       LIMIT 1`,
      [orgId, input.dedupKey]
    );
    if (existing.rows.length > 0) {
      return existing.rows[0].id;
    }
  }

  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO inbox_notifications (
       id, organization_id, kind, title, body, link_url, min_role, dedup_key
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      orgId,
      input.kind,
      input.title,
      input.body || '',
      input.linkUrl || '',
      input.minRole || 'keeper',
      input.dedupKey || null,
    ]
  );
  return id;
}

/**
 * List in-app notifications for keepers/admins.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {'member' | 'keeper' | 'admin'} role
 * @param {{ unreadOnly?: boolean }} [filters]
 */
export async function listInboxNotifications(db, ctx, role, filters = {}) {
  const orgId = requireOrgId(ctx);
  const allowedRoles = role === 'admin' ? ['keeper', 'admin'] : ['keeper'];
  const rolePh = allowedRoles.map((_, i) => `$${i + 2}`).join(', ');
  const conditions = [`organization_id = $1`, `min_role IN (${rolePh})`];
  if (filters.unreadOnly) {
    conditions.push('read_at IS NULL');
  }

  const [listRes, unreadRes] = await Promise.all([
    db.query(
      `SELECT * FROM inbox_notifications
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT 100`,
      [orgId, ...allowedRoles]
    ),
    db.query(
      `SELECT COUNT(*)::int AS cnt FROM inbox_notifications
       WHERE organization_id = $1 AND min_role IN (${rolePh}) AND read_at IS NULL`,
      [orgId, ...allowedRoles]
    ),
  ]);

  return {
    unreadCount: Number(unreadRes.rows[0]?.cnt || 0),
    items: listRes.rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body || '',
      linkUrl: r.link_url || '',
      minRole: r.min_role,
      readAt: formatIso(r.read_at),
      createdAt: formatIso(r.created_at),
    })),
  };
}

/**
 * Mark a single inbox notification as read.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {string} id
 */
export async function markNotificationRead(db, ctx, id) {
  const orgId = requireOrgId(ctx);
  const res = await db.query(
    `UPDATE inbox_notifications
     SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
     WHERE organization_id = $1 AND id = $2
     RETURNING id`,
    [orgId, id]
  );
  if (res.rows.length === 0) {
    throw notFound('Notification not found', 'NOTIFICATION_NOT_FOUND');
  }
}

/**
 * Mark all inbox notifications as read for the organization.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 */
export async function markAllNotificationsRead(db, ctx) {
  const orgId = requireOrgId(ctx);
  await db.query(
    `UPDATE inbox_notifications
     SET read_at = CURRENT_TIMESTAMP
     WHERE organization_id = $1 AND read_at IS NULL`,
    [orgId]
  );
}

/**
 * Notify keepers/admins about a new public report (in-app inbox + email outbox).
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {import('../config.js').AppConfig} config
 * @param {import('pino').Logger | undefined} logger
 * @param {{
 *   reportId: string,
 *   placeId: string,
 *   kind: string,
 *   note?: string,
 *   targetName: string,
 *   storageName: string,
 *   recipients?: string[]
 * }} info
 */
export async function notifyReportCreated(db, ctx, config, logger, info) {
  const orgId = requireOrgId(ctx);
  const title = `Uusi ilmoitus (${info.kind}): ${info.targetName}`;
  const body = `${info.storageName}${info.note ? ` — ${info.note}` : ''}`;

  await createInboxNotification(db, ctx, {
    kind: 'report',
    title,
    body,
    linkUrl: '/manage',
    minRole: 'keeper',
    dedupKey: `report:${info.reportId}`,
  });

  const to =
    info.recipients && info.recipients.length > 0
      ? info.recipients
      : config.mailAdminFallback;

  if (to.length > 0) {
    const outboxId = crypto.randomUUID();
    const text = `${title}\n${body}\n\n${config.baseUrl}/manage`;
    const mailRes = await sendMail(config, logger, {
      to,
      subject: `[Tavaranpaikka] ${title}`,
      text,
      templateId: config.brevoTemplateReportId,
      params: {
        title,
        body,
        kind: info.kind,
        targetName: info.targetName,
        storageName: info.storageName,
        url: `${config.baseUrl}/manage`,
      },
    });
    await db.query(
      `INSERT INTO notifications (
         id, organization_id, report_id, channel, recipient_ref, state, attempts, sent_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7)`,
      [
        outboxId,
        orgId,
        info.reportId,
        config.mailProvider,
        to.join(','),
        mailRes.ok ? 'sent' : 'failed',
        mailRes.ok ? new Date().toISOString() : null,
      ]
    );
  }
}

/**
 * Scan storages for upcoming item/entry expiries (using storage.notify_before_days or config default)
 * and overdue inspections, creating in-app inbox notifications and optional email alerts.
 * @param {import('../db.js').DbClient} db
 * @param {import('../types.js').RequestContext} ctx
 * @param {import('../config.js').AppConfig} config
 * @param {import('pino').Logger} [logger]
 * @returns {Promise<{ created: number }>}
 */
export async function checkAndNotifyUpcomingExpiries(db, ctx, config, logger) {
  const orgId = requireOrgId(ctx);
  const storagesRes = await db.query(
    `SELECT id, name, notify_before_days, inspection_interval_days, last_inspected_at
     FROM storages
     WHERE organization_id = $1 AND archived_at IS NULL`,
    [orgId]
  );

  let created = 0;
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  for (const st of storagesRes.rows) {
    const notifyDays =
      st.notify_before_days != null ? Number(st.notify_before_days) : config.defaultNotifyBeforeDays;
    const cutoffStr = new Date(now.getTime() + notifyDays * 86400_000).toISOString().slice(0, 10);

    // 1. Check overdue inspection
    if (st.inspection_interval_days != null && Number(st.inspection_interval_days) > 0) {
      const lastMs = st.last_inspected_at ? new Date(st.last_inspected_at).getTime() : 0;
      const due = !st.last_inspected_at || now.getTime() - lastMs >= Number(st.inspection_interval_days) * 86400_000;
      if (due) {
        const dedupKey = `inspection:${st.id}:${todayStr.slice(0, 7)}`;
        const existing = await db.query(
          'SELECT id FROM inbox_notifications WHERE organization_id = $1 AND dedup_key = $2 LIMIT 1',
          [orgId, dedupKey]
        );
        if (existing.rows.length === 0) {
          const title = `Tarkastus ajankohtainen: ${st.name}`;
          const body = `Säilytyspaikan määräaikaistarkastus on erääntynyt.`;
          await createInboxNotification(db, ctx, {
            kind: 'inspection_due',
            title,
            body,
            linkUrl: `/storages/${st.id}`,
            minRole: 'keeper',
            dedupKey,
          });
          if (config.mailAdminFallback.length > 0) {
            await sendMail(config, logger, {
              to: config.mailAdminFallback,
              subject: `[Tavaranpaikka] ${title}`,
              text: `${title}\n${body}\n${config.baseUrl}/storages/${st.id}`,
              templateId: config.brevoTemplateInspectionId,
              params: {
                kind: 'inspection_due',
                title,
                body,
                storageName: st.name,
                url: `${config.baseUrl}/storages/${st.id}`,
              },
            });
          }
          created += 1;
        }
      }
    }

    // 2. Check expiring items & entries in this storage
    const placesRes = await db.query(
      'SELECT id, name FROM places WHERE organization_id = $1 AND storage_id = $2 AND archived_at IS NULL',
      [orgId, st.id]
    );
    if (placesRes.rows.length === 0) continue;
    const placeIds = placesRes.rows.map((p) => p.id);
    const ph = placeIds.map((_, i) => `$${i + 2}`).join(', ');

    const [itemsRes, entriesRes] = await Promise.all([
      db.query(
        `SELECT id, name, expires_on FROM items
         WHERE organization_id = $1 AND archived_at IS NULL AND place_id IN (${ph}) AND expires_on IS NOT NULL`,
        [orgId, ...placeIds]
      ),
      db.query(
        `SELECT id, name, expires_on FROM place_entries
         WHERE organization_id = $1 AND archived_at IS NULL AND place_id IN (${ph}) AND expires_on IS NOT NULL`,
        [orgId, ...placeIds]
      ),
    ]);

    for (const row of [...itemsRes.rows, ...entriesRes.rows]) {
      const expStr =
        row.expires_on instanceof Date
          ? row.expires_on.toISOString().slice(0, 10)
          : String(row.expires_on).slice(0, 10);
      if (expStr <= cutoffStr) {
        const dedupKey = `expiring:${row.id}:${expStr}`;
        const existing = await db.query(
          'SELECT id FROM inbox_notifications WHERE organization_id = $1 AND dedup_key = $2 LIMIT 1',
          [orgId, dedupKey]
        );
        if (existing.rows.length === 0) {
          const title = `Vanhenee pian (${expStr}): ${row.name}`;
          const body = `${st.name} (ilmoitusraja ${notifyDays} pv)`;
          await createInboxNotification(db, ctx, {
            kind: 'expiring',
            title,
            body,
            linkUrl: `/storages/${st.id}`,
            minRole: 'keeper',
            dedupKey,
          });
          if (config.mailAdminFallback.length > 0) {
            await sendMail(config, logger, {
              to: config.mailAdminFallback,
              subject: `[Tavaranpaikka] ${title}`,
              text: `${title}\n${body}\n${config.baseUrl}/storages/${st.id}`,
              templateId: config.brevoTemplateExpiringId,
              params: {
                kind: 'expiring',
                title,
                body,
                targetName: row.name,
                storageName: st.name,
                expiresOn: expStr,
                notifyBeforeDays: notifyDays,
                url: `${config.baseUrl}/storages/${st.id}`,
              },
            });
          }
          created += 1;
        }
      }
    }
  }

  return { created };
}
