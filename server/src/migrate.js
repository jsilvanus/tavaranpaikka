import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Run all pending SQL migrations and seed the default organization.
 * @param {import('./db.js').DbClient} db
 * @param {{ defaultOrgSlug?: string, defaultOrgName?: string, defaultLocale?: string }} [options]
 * @returns {Promise<{ applied: string[], organizationId: string }>}
 */
export async function runMigrations(db, options = {}) {
  const defaultOrgSlug = options.defaultOrgSlug || 'riihimaki';
  const defaultOrgName = options.defaultOrgName || 'Riihimäen seurakunta';
  const defaultLocale = options.defaultLocale || 'fi';

  const tableCheck = await db.query(
    `SELECT table_name FROM information_schema.tables WHERE table_name = 'schema_migrations'`
  );
  if (tableCheck.rows.length === 0) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const appliedRes = await db.query('SELECT name FROM schema_migrations');
  const appliedSet = new Set(appliedRes.rows.map((r) => r.name));
  const newlyApplied = [];

  for (const file of files) {
    if (appliedSet.has(file)) continue;
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    await db.withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    newlyApplied.push(file);
  }

  const orgId = crypto.randomUUID();
  await db.query(
    `INSERT INTO organizations (id, slug, name, default_locale, locales, report_config)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     ON CONFLICT (slug) DO NOTHING`,
    [
      orgId,
      defaultOrgSlug,
      defaultOrgName,
      defaultLocale,
      JSON.stringify([defaultLocale]),
      JSON.stringify({
        kinds: ['depleted', 'broken', 'other'],
        allowNote: true,
        allowPhoto: false,
        askName: true,
        requireSignin: false,
      }),
    ]
  );

  const existingOrg = await db.query('SELECT id FROM organizations WHERE slug = $1', [defaultOrgSlug]);
  return {
    applied: newlyApplied,
    organizationId: existingOrg.rows[0].id,
  };
}

/**
 * Seed realistic demo data for local development if the organization has no storages yet.
 * @param {import('./db.js').DbClient} db
 * @param {string} organizationId
 * @returns {Promise<boolean>} true if demo data was inserted
 */
export async function seedDemoData(db, organizationId) {
  const countRes = await db.query(
    'SELECT COUNT(*)::int AS cnt FROM storages WHERE organization_id = $1',
    [organizationId]
  );
  if (Number(countRes.rows[0].cnt) > 0) {
    return false;
  }

  const mainStorageId = crypto.randomUUID();
  const firstAidStorageId = crypto.randomUUID();

  const shelfPlaceId = crypto.randomUUID();
  const boxPlaceId = crypto.randomUUID();
  const faCompId = crypto.randomUUID();

  const projectorId = crypto.randomUUID();
  const entryPencilsId = crypto.randomUUID();
  const entryBandagesId = crypto.randomUUID();

  const futureDate = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

  await db.withTransaction(async (client) => {
    await client.query(
      `INSERT INTO storages (id, organization_id, name, kind, description, public_listed)
       VALUES ($1, $2, $3, 'room', $4, TRUE)`,
      [mainStorageId, organizationId, 'Päävarasto', 'Seurakuntatalon päävarasto']
    );

    await client.query(
      `INSERT INTO storages (id, organization_id, name, kind, description, public_listed, inspection_interval_days)
       VALUES ($1, $2, $3, 'first_aid', $4, TRUE, 90)`,
      [firstAidStorageId, organizationId, 'Ensiapupakkaus (Sali)', 'Ison salin seinäkaappi']
    );

    await client.query(
      `INSERT INTO places (id, organization_id, storage_id, parent_place_id, name, description, pin_x, pin_y, pin_label)
       VALUES ($1, $2, $3, NULL, $4, $5, 0.35, 0.45, 'Hylly 2')`,
      [shelfPlaceId, organizationId, mainStorageId, 'Hylly 2', 'Keskimmäinen hyllykkö']
    );

    await client.query(
      `INSERT INTO places (id, organization_id, storage_id, parent_place_id, name, description, pin_label)
       VALUES ($1, $2, $3, $4, $5, $6, 'Laatikko A')`,
      [boxPlaceId, organizationId, mainStorageId, shelfPlaceId, 'Laatikko A', 'Ylätason muovilaatikko']
    );

    await client.query(
      `INSERT INTO places (id, organization_id, storage_id, parent_place_id, name, description, pin_label)
       VALUES ($1, $2, $3, NULL, $4, $5, 'Ylälokero')`,
      [faCompId, organizationId, firstAidStorageId, 'Ylälokero', 'Sidetarvikkeet']
    );

    await client.query(
      `INSERT INTO items (id, organization_id, place_id, name, description, category, status)
       VALUES ($1, $2, $3, 'Videotykki Epson', 'Kannettava projektori laukussa', 'AV', 'ok')`,
      [projectorId, organizationId, shelfPlaceId]
    );

    await client.query(
      `INSERT INTO place_entries (id, organization_id, place_id, name, quantity_note, quantity, min_quantity, status, sort_order)
       VALUES ($1, $2, $3, 'Lyijykynät', 'noin 40 kpl', 40, 10, 'ok', 1)`,
      [entryPencilsId, organizationId, boxPlaceId]
    );

    await client.query(
      `INSERT INTO place_entries (id, organization_id, place_id, name, quantity_note, quantity, min_quantity, expires_on, status, sort_order)
       VALUES ($1, $2, $3, 'Laastarit', '2 pakettia', 2, 1, $4, 'ok', 1)`,
      [entryBandagesId, organizationId, faCompId, futureDate]
    );
  });

  return true;
}
