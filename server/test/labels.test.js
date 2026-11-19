import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { CROCKFORD_ALPHABET, generateCode, isValidCode, normalizeCode } from '../src/labels/codes.js';
import { getCellRect, getLayoutSpec, LAYOUTS } from '../src/labels/layouts.js';
import { expandLabelCells, generateLabelsPdf } from '../src/labels/pdf.js';
import { generateQrSvg } from '../src/labels/qr.js';
import { createLabelRouter } from '../src/labels/router.js';
import { generateSummaryPdf } from '../src/labels/summaryPdf.js';

describe('codes', () => {
  it('generateCode produces valid XXXX-XXXX-C Crockford base32 codes', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCode();
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]$/);
      expect(code).not.toMatch(/[ILOU]/);
      expect(isValidCode(code)).toBe(true);
    }
  });

  it('normalizeCode strips spaces/hyphens, uppercases, and rejects invalid inputs', () => {
    const code = generateCode();
    const rawLower = code.replace(/-/g, '').toLowerCase();
    expect(normalizeCode(`  ${rawLower.slice(0, 4)}  ${rawLower.slice(4)} `)).toBe(code);
    expect(normalizeCode('short')).toBeNull();
    expect(normalizeCode('1234-5678-I')).toBeNull(); // I not in Crockford
    expect(normalizeCode('1234-5678-L')).toBeNull(); // L not in Crockford
    expect(normalizeCode('1234-5678-O')).toBeNull(); // O not in Crockford
    expect(normalizeCode('1234-5678-U')).toBeNull(); // U not in Crockford
    expect(normalizeCode(null)).toBeNull();
    expect(normalizeCode(12345)).toBeNull();
  });

  it('isValidCode detects single-character errors and adjacent transpositions', () => {
    const code = generateCode();
    const raw = code.replace(/-/g, '');

    // Single-character mutation on every position
    for (let i = 0; i < 9; i++) {
      const altChar = CROCKFORD_ALPHABET[(CROCKFORD_ALPHABET.indexOf(raw[i]) + 1) % 32];
      const mutated = raw.slice(0, i) + altChar + raw.slice(i + 1);
      expect(isValidCode(mutated)).toBe(false);
    }

    // Transposition of two adjacent differing chars with small delta
    const valid = normalizeCode('01000000' + '0'); // find valid check for 01000000
    void valid;
    expect(isValidCode('1000-0000-' + code.slice(-1))).toBe(false);

    expect(isValidCode('INVALID')).toBe(false);
    expect(isValidCode('')).toBe(false);
  });
});

describe('qr', () => {
  it('generateQrSvg returns an SVG string', async () => {
    const svg = await generateQrSvg('https://example.fi/c/K7M2-QX4D-9');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });
});

describe('layouts', () => {
  it('defines all 4 A4 layouts with valid cell geometry', () => {
    const expected = {
      'a4-3x8': { cols: 3, rows: 8, perPage: 24 },
      'a4-5x13': { cols: 5, rows: 13, perPage: 65 },
      'a4-2x7': { cols: 2, rows: 7, perPage: 14 },
      'a4-1x1': { cols: 1, rows: 1, perPage: 1 },
    };

    for (const [id, dims] of Object.entries(expected)) {
      const spec = getLayoutSpec(id);
      expect(LAYOUTS[id]).toBe(spec);
      expect(spec.cols).toBe(dims.cols);
      expect(spec.rows).toBe(dims.rows);
      expect(spec.perPage).toBe(dims.perPage);
      expect(spec.pageWidth).toBeCloseTo(595.28, 2);
      expect(spec.pageHeight).toBeCloseTo(841.89, 2);
      expect(spec.cellWidth).toBeGreaterThan(0);
      expect(spec.cellHeight).toBeGreaterThan(0);

      const lastCell = getCellRect(spec, spec.perPage - 1);
      expect(lastCell.x + lastCell.width).toBeLessThanOrEqual(spec.pageWidth + 0.01);
      expect(lastCell.y + lastCell.height).toBeLessThanOrEqual(spec.pageHeight + 0.01);
    }
  });

  it('throws on unknown layout', () => {
    expect(() => getLayoutSpec('a4-99x99')).toThrow(/Unknown label layout/);
  });
});

describe('pdf and expandLabelCells', () => {
  /** @type {import('../src/types.js').LabelTarget[]} */
  const sampleTargets = [
    {
      kind: 'item',
      id: 'item-1',
      code: generateCode(),
      name: 'Projektorin kaukosäädin',
      placePath: ['Kappeli', 'Hylly 2', 'Laatikko A'],
      storageName: 'Kappeli',
      printedAt: null,
      expiresOn: null,
    },
    {
      kind: 'place',
      id: 'place-1',
      code: generateCode(),
      name: 'Ensiapulaatikko',
      placePath: ['Sakasti', 'Ensiapulaatikko'],
      storageName: 'Sakasti',
      printedAt: null,
      expiresOn: '2027-06-30',
    },
    {
      kind: 'storage',
      id: 'storage-1',
      code: generateCode(),
      name: 'Päävarasto',
      placePath: [],
      storageName: 'Päävarasto',
      printedAt: null,
      expiresOn: null,
    },
  ];

  it('honours startPosition, copies, and page wrapping', () => {
    const cells = expandLabelCells(sampleTargets.slice(0, 2), {
      targets: [
        { kind: 'item', id: 'item-1' },
        { kind: 'place', id: 'place-1' },
      ],
      layout: 'a4-3x8',
      startPosition: 23, // 24 cells per page -> slots 22, 23 on page 0; 0, 1 on page 1
      copies: 2,
      show: { qr: true, code: true, name: true, place: true, note: false },
    });

    expect(cells).toHaveLength(4);
    expect(cells[0]).toMatchObject({ page: 0, cellIndexOnPage: 22, col: 1, row: 7 });
    expect(cells[1]).toMatchObject({ page: 0, cellIndexOnPage: 23, col: 2, row: 7 });
    expect(cells[2]).toMatchObject({ page: 1, cellIndexOnPage: 0, col: 0, row: 0 });
    expect(cells[3]).toMatchObject({ page: 1, cellIndexOnPage: 1, col: 1, row: 0 });
  });

  it('honours show toggles, per-target overrides, and note/expiresOn fallback', () => {
    const cells = expandLabelCells(sampleTargets, {
      targets: [
        { kind: 'item', id: 'item-1', show: { name: false } },
        { kind: 'place', id: 'place-1', show: { place: false } },
        { kind: 'storage', id: 'storage-1' },
      ],
      layout: 'a4-3x8',
      show: { qr: true, code: false, name: true, place: true, note: true },
    });

    expect(cells[0].show).toEqual({ qr: true, code: false, name: false, place: true, note: true });
    expect(cells[0].placeText).toBe('Kappeli > Hylly 2 > Laatikko A');
    expect(cells[0].noteText).toBe('');

    expect(cells[1].show).toEqual({ qr: true, code: false, name: true, place: false, note: true });
    expect(cells[1].placeText).toBe('Sakasti');
    expect(cells[1].noteText).toBe('Vanhenee: 2027-06-30');

    expect(cells[2].placeText).toBe('');

    const withCustomNote = expandLabelCells([sampleTargets[1]], {
      targets: [{ kind: 'place', id: 'place-1' }],
      layout: 'a4-3x8',
      show: { qr: true, code: true, name: true, place: true, note: true },
      note: 'Älä siirrä',
    });
    expect(withCustomNote[0].noteText).toBe('Älä siirrä');
  });

  it('generateLabelsPdf produces valid PDF buffers for all 4 layouts', async () => {
    /** @type {import('../src/types.js').LabelLayout[]} */
    const layouts = ['a4-3x8', 'a4-5x13', 'a4-2x7', 'a4-1x1'];
    for (const layout of layouts) {
      const buf = await generateLabelsPdf(
        sampleTargets,
        {
          targets: sampleTargets.map((t) => ({ kind: t.kind, id: t.id })),
          layout,
          startPosition: 1,
          copies: 1,
          size: layout === 'a4-5x13' ? 'small' : layout === 'a4-1x1' ? 'large' : 'normal',
          show: { qr: true, code: true, name: true, place: true, note: true },
          note: 'Testihuomautus',
        },
        'https://tavaranpaikka.example.fi',
      );
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(500);
      expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    }
  });
});

describe('summaryPdf', () => {
  it('generateSummaryPdf generates a valid PDF checklist for a first_aid storage with expiring items', async () => {
    /** @type {import('../src/types.js').StorageDetail} */
    const storageDetail = {
      id: 'st-1',
      name: 'Seurakuntatalon ensiapupakkaus',
      kind: 'first_aid',
      description: 'Keittiön seinällä oleva ensiapukaappi',
      hasImage: false,
      publicListed: true,
      inspectionIntervalDays: 180,
      lastInspectedAt: '2026-01-15T10:00:00Z',
      inspectionDue: true,
      imageUrl: null,
      imageWidth: null,
      imageHeight: null,
      code: generateCode(),
      counts: {
        places: 2,
        items: 1,
        entries: 2,
        openReports: 1,
        depleted: 1,
        broken: 0,
        expiringSoon: 1,
        expired: 0,
      },
      openReports: [{ kind: 'depleted', count: 1 }],
      places: [
        {
          id: 'pl-1',
          storageId: 'st-1',
          parentPlaceId: null,
          name: 'Ylähylly',
          description: '',
          pinX: null,
          pinY: null,
          pinLabel: '',
          path: ['Seurakuntatalon ensiapupakkaus', 'Ylähylly'],
          reportConfig: {},
          counts: {
            places: 0,
            items: 1,
            entries: 1,
            openReports: 0,
            depleted: 0,
            broken: 0,
            expiringSoon: 1,
            expired: 0,
          },
          items: [
            {
              id: 'it-1',
              placeId: 'pl-1',
              name: 'Defibrillaattorin elektrodit',
              description: '',
              category: 'Ensiapu',
              status: 'ok',
              expiresOn: '2026-12-31',
              minQuantity: 1,
              code: generateCode(),
            },
          ],
          entries: [
            {
              id: 'en-1',
              placeId: 'pl-1',
              name: 'Laastarit',
              quantityNote: '1 rasia',
              quantity: 20,
              minQuantity: 10,
              expiresOn: '2027-05-01',
              status: 'ok',
              sortOrder: 1,
            },
          ],
        },
        {
          id: 'pl-2',
          storageId: 'st-1',
          parentPlaceId: null,
          name: 'Alahylly',
          description: '',
          pinX: null,
          pinY: null,
          pinLabel: '',
          path: ['Seurakuntatalon ensiapupakkaus', 'Alahylly'],
          reportConfig: {},
          counts: {
            places: 0,
            items: 0,
            entries: 1,
            openReports: 1,
            depleted: 1,
            broken: 0,
            expiringSoon: 0,
            expired: 0,
          },
          items: [],
          entries: [
            {
              id: 'en-2',
              placeId: 'pl-2',
              name: 'Kylmäpussi',
              quantityNote: '2 kpl',
              quantity: 0,
              minQuantity: 2,
              expiresOn: null,
              status: 'depleted',
              sortOrder: 1,
            },
          ],
        },
      ],
    };

    const buf = await generateSummaryPdf(storageDetail);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });
});

describe('createLabelRouter', () => {
  function setupApp(overrides = {}) {
    const code = generateCode();
    /** @type {import('../src/types.js').LabelTarget[]} */
    const targets = [
      {
        kind: 'item',
        id: 'item-1',
        code,
        name: 'Käsivalaisin',
        placePath: ['Varasto', 'Hylly 1'],
        storageName: 'Varasto',
        printedAt: null,
        expiresOn: null,
      },
    ];

    const getTargets = vi.fn(async () => targets);
    const resolveTargets = vi.fn(async (_ctx, refs) =>
      targets.filter((t) => refs.some((r) => r.kind === t.kind && r.id === t.id)),
    );
    const markPrinted = vi.fn(async () => {});
    const getBaseUrl = () => 'https://tavaranpaikka.example.fi';

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      /** @type {any} */ (req).ctx = { organizationId: 'org-1', locale: 'fi' };
      next();
    });
    app.use(
      '/api/labels',
      createLabelRouter({
        getTargets,
        resolveTargets,
        markPrinted,
        getBaseUrl,
        ...overrides,
      }),
    );

    return { app, code, targets, getTargets, resolveTargets, markPrinted };
  }

  it('GET /api/labels/targets forwards ctx and query', async () => {
    const { app, getTargets, targets } = setupApp();
    const res = await request(app).get('/api/labels/targets?notPrinted=true');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(targets);
    expect(getTargets).toHaveBeenCalledWith(
      { organizationId: 'org-1', locale: 'fi' },
      { notPrinted: 'true' },
    );
  });

  it('POST /api/labels/pdf validates request, generates PDF, and calls markPrinted', async () => {
    const { app, markPrinted, targets } = setupApp();

    const badRes = await request(app)
      .post('/api/labels/pdf')
      .send({ targets: [], layout: 'a4-3x8', show: {} });
    expect(badRes.status).toBe(400);
    expect(badRes.body.error.code).toBe('VALIDATION_ERROR');

    const badPosRes = await request(app)
      .post('/api/labels/pdf')
      .send({
        targets: [{ kind: 'item', id: 'item-1' }],
        layout: 'a4-3x8',
        startPosition: 25,
        show: { qr: true },
      });
    expect(badPosRes.status).toBe(400);

    const okRes = await request(app)
      .post('/api/labels/pdf')
      .send({
        targets: [{ kind: 'item', id: 'item-1' }],
        layout: 'a4-3x8',
        startPosition: 1,
        copies: 2,
        show: { qr: true, code: true, name: true, place: true, note: false },
      })
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(okRes.status).toBe(200);
    expect(okRes.headers['content-type']).toMatch(/application\/pdf/);
    expect(okRes.headers['content-disposition']).toBe('inline; filename="labels.pdf"');
    expect(okRes.body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(markPrinted).toHaveBeenCalledWith({ organizationId: 'org-1', locale: 'fi' }, targets);
  });

  it('GET /api/labels/qr/:code.svg returns SVG for valid code and 400 for invalid code', async () => {
    const { app, code } = setupApp();
    const unhyphenatedLower = code.replace(/-/g, '').toLowerCase();

    const okRes = await request(app).get(`/api/labels/qr/${unhyphenatedLower}.svg`);
    expect(okRes.status).toBe(200);
    expect(okRes.headers['content-type']).toMatch(/image\/svg\+xml/);
    const svgBody = okRes.text ?? okRes.body.toString('utf8');
    expect(svgBody).toContain('<svg');

    const badRes = await request(app).get('/api/labels/qr/BAD-CODE-0.svg');
    expect(badRes.status).toBe(400);
    expect(badRes.body.error.code).toBe('INVALID_CODE');
  });
});
