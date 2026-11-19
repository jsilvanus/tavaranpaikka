import { describe, expect, it } from 'vitest';
import { createDb } from '../src/db.js';
import { runMigrations, seedDemoData } from '../src/migrate.js';

describe('migrations and seeding', () => {
  it('runs migrations idempotently and seeds default organization', async () => {
    const db = createDb('pg-mem');
    try {
      const first = await runMigrations(db);
      expect(first.applied).toEqual(['001_init.sql']);
      expect(first.organizationId).toBeTruthy();

      const second = await runMigrations(db);
      expect(second.applied).toEqual([]);
      expect(second.organizationId).toBe(first.organizationId);

      const orgRes = await db.query('SELECT slug, name FROM organizations');
      expect(orgRes.rows).toEqual([
        { slug: 'riihimaki', name: 'Riihimäen seurakunta' },
      ]);
    } finally {
      await db.close();
    }
  });

  it('seeds demo data only once when storages are empty', async () => {
    const db = createDb('pg-mem');
    try {
      const { organizationId } = await runMigrations(db);
      const seeded1 = await seedDemoData(db, organizationId);
      expect(seeded1).toBe(true);

      const seeded2 = await seedDemoData(db, organizationId);
      expect(seeded2).toBe(false);

      const storages = await db.query('SELECT id FROM storages WHERE organization_id = $1', [
        organizationId,
      ]);
      expect(storages.rows.length).toBe(2);
    } finally {
      await db.close();
    }
  });
});
