import { describe, expect, it } from 'vitest';
import { createDb } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createItem } from '../src/repositories/itemsRepo.js';
import { createPlace, createPlaceEntry, updatePlace } from '../src/repositories/placesRepo.js';
import {
  createStorage,
  getStorageDetail,
  listStorageSummaries,
  recordInspection,
} from '../src/repositories/storagesRepo.js';

function addDaysIso(days) {
  return new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);
}

describe('storages, first-aid expiry, inspections, and place hierarchy', () => {
  it('computes storage counts, first-aid expiry counts, and inspection due state', async () => {
    const db = createDb('pg-mem');
    try {
      const { organizationId } = await runMigrations(db);
      const ctx = { organizationId, locale: 'fi' };

      const fa = await createStorage(db, ctx, {
        name: 'Ensiapukaappi',
        kind: 'first_aid',
        inspectionIntervalDays: 30,
      });
      expect(fa.inspectionDue).toBe(true);

      const compartment = await createPlace(db, ctx, {
        storageId: fa.id,
        name: 'Lokero 1',
      });

      // Expired item
      await createItem(db, ctx, {
        placeId: compartment.id,
        name: 'Sideharso',
        expiresOn: addDaysIso(-5),
      });
      // Expiring soon entry (15 days)
      await createPlaceEntry(db, ctx, compartment.id, {
        name: 'Laastarit',
        expiresOn: addDaysIso(15),
        status: 'depleted',
      });
      // Ok entry (120 days)
      await createPlaceEntry(db, ctx, compartment.id, {
        name: 'Desinfiointiaine',
        expiresOn: addDaysIso(120),
        status: 'ok',
      });

      const summaries = await listStorageSummaries(db, ctx, { kind: 'first_aid' });
      expect(summaries).toHaveLength(1);
      expect(summaries[0].counts).toEqual({
        places: 1,
        items: 1,
        entries: 2,
        openReports: 0,
        depleted: 1,
        broken: 0,
        expiringSoon: 1,
        expired: 1,
      });
      expect(summaries[0].inspectionDue).toBe(true);

      const inspected = await recordInspection(db, ctx, fa.id, 'keeper-1');
      expect(inspected.inspectionDue).toBe(false);
      expect(inspected.lastInspectedAt).toBeTruthy();

      const historyRes = await db.query(
        `SELECT event_type, actor_sub FROM item_history WHERE organization_id = $1 AND storage_id = $2`,
        [organizationId, fa.id]
      );
      expect(historyRes.rows).toEqual([{ event_type: 'inspection', actor_sub: 'keeper-1' }]);
    } finally {
      await db.close();
    }
  });

  it('supports 2+ level place paths up to 4 levels and prevents cycles', async () => {
    const db = createDb('pg-mem');
    try {
      const { organizationId } = await runMigrations(db);
      const ctx = { organizationId, locale: 'fi' };

      const storage = await createStorage(db, ctx, { name: 'Päävarasto' });
      const l1 = await createPlace(db, ctx, { storageId: storage.id, name: 'Hylly 1' });
      const l2 = await createPlace(db, ctx, {
        storageId: storage.id,
        parentPlaceId: l1.id,
        name: 'Taso 2',
      });
      const l3 = await createPlace(db, ctx, {
        storageId: storage.id,
        parentPlaceId: l2.id,
        name: 'Laatikko A',
      });
      const l4 = await createPlace(db, ctx, {
        storageId: storage.id,
        parentPlaceId: l3.id,
        name: 'Lokero X',
      });

      expect(l4.path).toEqual(['Hylly 1', 'Taso 2', 'Laatikko A', 'Lokero X']);

      // 5th level rejected
      await expect(
        createPlace(db, ctx, {
          storageId: storage.id,
          parentPlaceId: l4.id,
          name: 'Liian syvä',
        })
      ).rejects.toThrow(/exceed 4 levels/i);

      // Cycle rejected (l1 -> l3)
      await expect(updatePlace(db, ctx, l1.id, { parentPlaceId: l3.id })).rejects.toThrow(
        /circular/i
      );

      const detail = await getStorageDetail(db, ctx, storage.id);
      const foundL3 = detail.places.find((p) => p.id === l3.id);
      expect(foundL3?.path).toEqual(['Hylly 1', 'Taso 2', 'Laatikko A']);
    } finally {
      await db.close();
    }
  });
});
