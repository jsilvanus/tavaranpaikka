import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDb } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { issueCode, resolvePublicCode, voidCode } from '../src/repositories/codesRepo.js';
import { createItem, listItems } from '../src/repositories/itemsRepo.js';
import { createPlace, listPlaces } from '../src/repositories/placesRepo.js';
import { createPublicReport, listReports } from '../src/repositories/reportsRepo.js';
import {
  archiveStorage,
  createStorage,
  getStorageDetail,
  listStorageSummaries,
} from '../src/repositories/storagesRepo.js';

describe('tenant isolation', () => {
  it('scopes all repository reads and writes by organizationId', async () => {
    const db = createDb('pg-mem');
    try {
      const { organizationId: orgA } = await runMigrations(db);
      const orgB = crypto.randomUUID();
      await db.query(
        `INSERT INTO organizations (id, slug, name, default_locale, locales)
         VALUES ($1, 'other-parish', 'Muu seurakunta', 'fi', '["fi"]'::jsonb)`,
        [orgB]
      );

      const ctxA = { organizationId: orgA, locale: 'fi' };
      const ctxB = { organizationId: orgB, locale: 'fi' };

      const storageA = await createStorage(db, ctxA, { name: 'Varasto A', kind: 'room' });
      const placeA = await createPlace(db, ctxA, { storageId: storageA.id, name: 'Hylly 1' });
      const itemA = await createItem(db, ctxA, { placeId: placeA.id, name: 'Projektori A' });
      const codeA = await issueCode(db, ctxA, 'item', itemA.id);
      await createPublicReport(
        db,
        ctxA,
        placeA.id,
        { itemId: itemA.id, kind: 'broken', note: 'Lamppu rikki' },
        'hash-1'
      );

      // Org B sees nothing from Org A
      expect(await listStorageSummaries(db, ctxB)).toEqual([]);
      expect(await listPlaces(db, ctxB)).toEqual([]);
      expect(await listItems(db, ctxB)).toEqual([]);
      expect(await listReports(db, ctxB)).toEqual([]);
      await expect(getStorageDetail(db, ctxB, storageA.id)).rejects.toThrow(/not found/i);
      await expect(archiveStorage(db, ctxB, storageA.id)).rejects.toThrow(/not found/i);
      await expect(voidCode(db, ctxB, codeA.code)).rejects.toThrow(/not found/i);

      // Scoped code resolution resolves Org A's item for ctxA and returns null for ctxB
      expect(await resolvePublicCode(db, ctxB, codeA.code)).toBeNull();
      const resolved = await resolvePublicCode(db, ctxA, codeA.code);
      expect(resolved).not.toBeNull();
      expect(resolved?.kind).toBe('item');
      expect(resolved?.item?.name).toBe('Projektori A');
      expect(resolved?.storage.name).toBe('Varasto A');
    } finally {
      await db.close();
    }
  });
});
