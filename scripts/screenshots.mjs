import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createApp } from '../server/src/app.js';
import { loadConfig } from '../server/src/config.js';
import { createDb } from '../server/src/db.js';
import { runMigrations, seedDemoData } from '../server/src/migrate.js';
import { issueCode } from '../server/src/repositories/codesRepo.js';
import { createInboxNotification } from '../server/src/repositories/notificationsRepo.js';
import { createPublicReport } from '../server/src/repositories/reportsRepo.js';
import { createStorage } from '../server/src/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const CLIENT_DIST = path.join(ROOT_DIR, 'client', 'dist');
const OUT_DIR = path.resolve(process.env.SCREENSHOT_DIR || path.join(ROOT_DIR, 'screenshots'));

async function ensureClientBuilt() {
  try {
    await fs.access(path.join(CLIENT_DIST, 'index.html'));
  } catch {
    console.log('Building client...');
    execSync('npm --prefix client run build', { cwd: ROOT_DIR, stdio: 'inherit' });
  }
}

async function main() {
  await ensureClientBuilt();
  await fs.mkdir(OUT_DIR, { recursive: true });

  const tmpUploads = await fs.mkdtemp(path.join(os.tmpdir(), 'tp-screenshots-'));
  const db = createDb('pg-mem');
  const config = loadConfig({
    NODE_ENV: 'development',
    AUTH_MODE: 'dev',
    DEV_DEFAULT_ROLE: 'admin',
    LOCAL_STORAGE_DIR: tmpUploads,
    CLEANUP_DISABLED: 'true',
  });

  const { organizationId } = await runMigrations(db, {
    defaultOrgSlug: config.defaultOrganizationSlug,
    defaultLocale: config.defaultLocale,
  });
  await seedDemoData(db, organizationId);

  // Seed a sample notification and public report so Inbox & Reports tabs are populated
  const storagesRes = await db.query(
    'SELECT id, name, kind FROM storages WHERE organization_id = $1 ORDER BY name',
    [organizationId]
  );
  const placesRes = await db.query(
    'SELECT id, name FROM places WHERE organization_id = $1 ORDER BY name',
    [organizationId]
  );
  const itemsRes = await db.query(
    'SELECT id, name, place_id FROM items WHERE organization_id = $1 ORDER BY name',
    [organizationId]
  );
  const codesRes = await db.query(
    'SELECT code, kind, target_id FROM codes WHERE organization_id = $1',
    [organizationId]
  );

  const roomStorage = storagesRes.rows.find((s) => s.kind !== 'kit') || storagesRes.rows[0];
  const kitStorage = storagesRes.rows.find((s) => s.kind === 'kit') || storagesRes.rows[0];
  const ctx = { organizationId, locale: 'fi' };
  const placeCode =
    codesRes.rows.find((c) => c.kind === 'place')?.code ||
    (placesRes.rows[0] ? (await issueCode(db, ctx, 'place', placesRes.rows[0].id)).code : null);
  const itemCode =
    codesRes.rows.find((c) => c.kind === 'item')?.code ||
    (itemsRes.rows[0] ? (await issueCode(db, ctx, 'item', itemsRes.rows[0].id)).code : null);
  const storageCode =
    codesRes.rows.find((c) => c.kind === 'storage')?.code ||
    (roomStorage ? (await issueCode(db, ctx, 'storage', roomStorage.id)).code : null);

  if (placesRes.rows[0] && itemsRes.rows[0]) {
    await createPublicReport(
      db,
      { organizationId, locale: 'fi' },
      placesRes.rows[0].id,
      {
        itemId: itemsRes.rows[0].id,
        kind: 'depleted',
        note: 'Viimeinen paketti käytetty, tarvitaan täydennystä.',
        reporterName: 'Matti Meikäläinen',
      },
      'screenshot-hash'
    );
    await createInboxNotification(
      db,
      { organizationId, locale: 'fi' },
      {
        kind: 'report',
        title: `Uusi ilmoitus (depleted): ${itemsRes.rows[0].name}`,
        body: 'Viimeinen paketti käytetty, tarvitaan täydennystä.',
        linkUrl: '/manage',
      }
    );
  }

  const storage = createStorage({ driver: 'local', localDir: tmpUploads });
  const app = createApp({ db, config, storage });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const executablePath =
    process.env.CHROME_BIN || '/usr/bin/chromium';
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const saved = [];
  async function snap(page, filename, urlPath, waitMs = 350) {
    await page.goto(`${baseUrl}${urlPath}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(waitMs);
    const outPath = path.join(OUT_DIR, filename);
    await page.screenshot({ path: outPath, fullPage: true });
    saved.push(filename);
    console.log(`Captured ${filename}`);
  }

  try {
    // 1. Desktop Keeper / Admin views
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    await snap(page, '01-storages-list.png', '/storages');
    if (roomStorage) {
      await snap(page, '02-storage-detail-room.png', `/storages/${roomStorage.id}`);
    }
    if (kitStorage) {
      await snap(page, '03-storage-detail-kit.png', `/storages/${kitStorage.id}`);
    }

    // Public scan views (simulate public role via dev_role cookie)
    await context.addCookies([{ name: 'dev_role', value: 'none', url: baseUrl }]);
    if (placeCode) {
      await snap(page, '04-scan-place.png', `/c/${placeCode}`);
    }
    if (itemCode) {
      await snap(page, '05-scan-item.png', `/c/${itemCode}`);
      // Open report form if button exists
      const reportBtn = page.locator('button', { hasText: /ilmoita|report/i }).first();
      if ((await reportBtn.count()) > 0) {
        await reportBtn.click();
        await page.waitForTimeout(250);
        await page.screenshot({
          path: path.join(OUT_DIR, '06-scan-item-report-open.png'),
          fullPage: true,
        });
        saved.push('06-scan-item-report-open.png');
        console.log('Captured 06-scan-item-report-open.png');
      }
    }
    if (storageCode) {
      await snap(page, '07-scan-storage.png', `/c/${storageCode}`);
    }

    // Restore admin role for /manage tabs, /print, /privacy
    await context.addCookies([{ name: 'dev_role', value: 'admin', url: baseUrl }]);

    await page.goto(`${baseUrl}/manage`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT_DIR, '08-manage-inbox.png'), fullPage: true });
    saved.push('08-manage-inbox.png');
    console.log('Captured 08-manage-inbox.png');

    const tabs = [
      { idx: 1, file: '09-manage-storages.png' },
      { idx: 2, file: '10-manage-places.png' },
      { idx: 3, file: '11-manage-items.png' },
      { idx: 4, file: '12-manage-reports.png' },
      { idx: 5, file: '13-manage-leases.png' },
      { idx: 6, file: '14-manage-privacy.png' },
    ];
    for (const t of tabs) {
      const tabBtn = page.locator('[role="tab"]').nth(t.idx);
      if ((await tabBtn.count()) > 0) {
        await tabBtn.click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(OUT_DIR, t.file), fullPage: true });
        saved.push(t.file);
        console.log(`Captured ${t.file}`);
      }
    }

    await snap(page, '15-print-labels.png', '/print', 500);
    await snap(page, '16-privacy-notice.png', '/privacy');

    // Multi-tenant switcher view: insert a second organization and reload /storages
    await db.query(
      `INSERT INTO organizations (id, slug, name, default_locale, locales)
       VALUES ('org-hyvinkaa', 'hyvinkaa', 'Hyvinkään seurakunta', 'fi', '["fi"]'::jsonb)
       ON CONFLICT (slug) DO NOTHING`
    );
    await snap(page, '17-multitenant-switcher.png', '/storages');

    await context.close();

    // 2. Mobile views (390x844)
    const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await mobileCtx.newPage();
    await snap(mobilePage, '18-mobile-storages.png', '/storages');
    if (itemCode) {
      await mobileCtx.addCookies([{ name: 'dev_role', value: 'none', url: baseUrl }]);
      await snap(mobilePage, '19-mobile-scan.png', `/c/${itemCode}`);
    }
    await mobileCtx.addCookies([{ name: 'dev_role', value: 'admin', url: baseUrl }]);
    await snap(mobilePage, '20-mobile-manage.png', '/manage');
    await mobileCtx.close();

    console.log(`\nSaved ${saved.length} screenshots to ${OUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
    await db.close();
    await fs.rm(tmpUploads, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
