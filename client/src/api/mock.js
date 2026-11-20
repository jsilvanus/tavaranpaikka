// Realistic Finnish parish mock data and in-memory API implementation for VITE_MOCK=1

const STOREROOM_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 700" width="1000" height="700">
    <rect width="1000" height="700" fill="#f1f5f9"/>
    <rect x="40" y="60" width="380" height="580" fill="#e2e8f0" stroke="#64748b" stroke-width="4" rx="6"/>
    <line x1="40" y1="220" x2="420" y2="220" stroke="#64748b" stroke-width="4"/>
    <line x1="40" y1="380" x2="420" y2="380" stroke="#64748b" stroke-width="4"/>
    <line x1="40" y1="520" x2="420" y2="520" stroke="#64748b" stroke-width="4"/>
    <rect x="70" y="100" width="140" height="100" fill="#cbd5e1" stroke="#475569" stroke-width="2" rx="4"/>
    <rect x="240" y="110" width="150" height="90" fill="#cbd5e1" stroke="#475569" stroke-width="2" rx="4"/>
    <rect x="80" y="260" width="120" height="100" fill="#cbd5e1" stroke="#475569" stroke-width="2" rx="4"/>
    <rect x="520" y="100" width="420" height="540" fill="#e2e8f0" stroke="#64748b" stroke-width="4" rx="6"/>
    <line x1="730" y1="100" x2="730" y2="640" stroke="#64748b" stroke-width="3"/>
    <circle cx="705" cy="360" r="8" fill="#475569"/>
    <circle cx="755" cy="360" r="8" fill="#475569"/>
    <text x="60" y="42" font-family="sans-serif" font-size="22" fill="#334155">Hyllykkö A</text>
    <text x="540" y="82" font-family="sans-serif" font-size="22" fill="#334155">Siivouskaappi</text>
  </svg>`
)}`;

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function createInitialState() {
  const storages = [
    {
      id: 'st-kitchen',
      name: 'Keittiön varasto',
      kind: 'room',
      description: 'Seurakuntakeskuksen keittiön vieressä oleva päävarasto.',
      hasImage: true,
      imageUrl: STOREROOM_SVG,
      imageWidth: 1000,
      imageHeight: 700,
      publicListed: true,
      responsiblePersonName: 'Seurakunnan toimisto',
      responsiblePerson: { type: 'external', sub: null, name: 'Seurakunnan toimisto', email: null, phone: null },
      inspectionIntervalDays: null,
      lastInspectedAt: null,
      code: 'VAR1-K7M2-4',
      printedAt: '2026-10-01T10:00:00Z',
    },
    {
      id: 'st-first-aid',
      name: 'Salin tarvikepakkaus',
      kind: 'kit',
      description: 'Seinään kiinnitetty tarvikekaappi aulan naulakon vieressä.',
      hasImage: false,
      imageUrl: null,
      imageWidth: null,
      imageHeight: null,
      publicListed: true,
      inspectionIntervalDays: 90,
      lastInspectedAt: daysFromNow(-110),
      code: 'EA01-992A-3',
      printedAt: null,
    },
    {
      id: 'st-cabinet',
      name: 'Kappelin sakastikaappi',
      kind: 'cabinet',
      description: 'Alttariliinat, kynttilät ja ehtoollistarvikkeet.',
      hasImage: false,
      imageUrl: null,
      imageWidth: null,
      imageHeight: null,
      publicListed: true,
      inspectionIntervalDays: null,
      lastInspectedAt: null,
      code: null,
      printedAt: null,
    },
  ];

  const places = [
    {
      id: 'pl-shelf-a',
      storageId: 'st-kitchen',
      parentPlaceId: null,
      name: 'Hyllykkö A',
      description: 'Vasen metallihyllykkö oven vieressä',
      pinX: 0.23,
      pinY: 0.35,
      pinLabel: 'Vasen hyllykkö',
      reportConfig: { kinds: ['depleted', 'broken', 'other'], allowNote: true, askName: true },
      code: 'PL01-A4B2-7',
      printedAt: '2026-10-01T10:00:00Z',
    },
    {
      id: 'pl-shelf-a-top',
      storageId: 'st-kitchen',
      parentPlaceId: 'pl-shelf-a',
      name: 'Ylähylly',
      description: 'Ylin hyllytaso, kevyet tarvikkeet',
      pinX: 0.23,
      pinY: 0.16,
      pinLabel: 'Hyllykkö A, ylin taso',
      reportConfig: { kinds: ['depleted', 'broken', 'other'], allowNote: true, askName: true },
      code: 'PL02-C8D1-5',
      printedAt: null,
    },
    {
      id: 'pl-shelf-a-box1',
      storageId: 'st-kitchen',
      parentPlaceId: 'pl-shelf-a-top',
      name: 'Laatikko 1',
      description: 'Kirkas muovilaatikko vasemmalla',
      pinX: 0.14,
      pinY: 0.15,
      pinLabel: 'Ylähylly, vasen laatikko',
      reportConfig: { kinds: ['depleted', 'broken', 'other'], allowNote: true, askName: true },
      code: 'PL03-E2F9-1',
      printedAt: null,
    },
    {
      id: 'pl-cleaning',
      storageId: 'st-kitchen',
      parentPlaceId: null,
      name: 'Siivouskaappi',
      description: 'Oikeanpuoleinen lukittava kaappi',
      pinX: 0.73,
      pinY: 0.4,
      pinLabel: 'Siivouskaappi oikealla',
      reportConfig: { kinds: ['depleted', 'broken', 'other'], allowNote: true, askName: true },
      code: 'PL04-G6H3-8',
      printedAt: null,
    },
    {
      id: 'pl-fa-meds',
      storageId: 'st-first-aid',
      parentPlaceId: null,
      name: 'Lääke- ja puhdistusosasto',
      description: 'Ylempi lokero',
      pinX: null,
      pinY: null,
      pinLabel: 'Ylempi lokero',
      reportConfig: { kinds: ['depleted', 'broken', 'expired', 'other'], allowNote: true, askName: true },
      code: 'PL05-J1K4-2',
      printedAt: null,
    },
    {
      id: 'pl-fa-bandages',
      storageId: 'st-first-aid',
      parentPlaceId: null,
      name: 'Sidetarvikkeet',
      description: 'Alempi lokero',
      pinX: null,
      pinY: null,
      pinLabel: 'Alempi lokero',
      reportConfig: { kinds: ['depleted', 'broken', 'expired', 'other'], allowNote: true, askName: true },
      code: 'PL06-M5N8-6',
      printedAt: null,
    },
    {
      id: 'pl-sacristy-top',
      storageId: 'st-cabinet',
      parentPlaceId: null,
      name: 'Ylähylly',
      description: 'Kynttilät ja sytyttimet',
      pinX: null,
      pinY: null,
      pinLabel: 'Ylähylly',
      reportConfig: { kinds: ['depleted', 'broken', 'other'], allowNote: true, askName: true },
      code: null,
      printedAt: null,
    },
  ];

  const items = [
    {
      id: 'it-projector',
      placeId: 'pl-shelf-a-top',
      name: 'Projektori Epson EB-W49',
      description: 'Kannettava dataprojektori laukussa, HDMI-johto mukana.',
      category: 'AV-laitteet',
      status: 'ok',
      expiresOn: null,
      minQuantity: null,
      code: 'K7M2-QX4D-9',
      printedAt: '2026-10-01T10:00:00Z',
    },
    {
      id: 'it-coffee',
      placeId: 'pl-shelf-a',
      name: 'Kahvinkeitin Moccamaster',
      description: 'Iso termokeitin juhlakäyttöön.',
      category: 'Keittiö',
      status: 'broken',
      expiresOn: null,
      minQuantity: null,
      code: 'M4N8-PR2K-3',
      printedAt: null,
    },
    {
      id: 'it-vacuum',
      placeId: 'pl-cleaning',
      name: 'Pölynimuri Nilfisk',
      description: 'Rikkaimuri ja lattiasuulake.',
      category: 'Siivous',
      status: 'ok',
      expiresOn: null,
      minQuantity: null,
      code: 'V9T1-WZ6B-5',
      printedAt: null,
    },
    {
      id: 'it-eyewash',
      placeId: 'pl-fa-meds',
      name: 'Silmähuuhde 500 ml',
      description: 'Steriili huuhtelupullo.',
      category: 'Tarvikkeet',
      status: 'ok',
      expiresOn: daysFromNow(25),
      minQuantity: 1,
      code: 'EA11-442C-7',
      printedAt: null,
    },
  ];

  const entries = [
    {
      id: 'en-cups',
      placeId: 'pl-shelf-a-box1',
      name: 'Kertakäyttökupit (pahvi)',
      quantityNote: 'n. 2 pakettia',
      quantity: 2,
      minQuantity: 3,
      expiresOn: null,
      status: 'depleted',
      sortOrder: 1,
    },
    {
      id: 'en-pencils',
      placeId: 'pl-shelf-a-box1',
      name: 'Lyijykynät ja tussit',
      quantityNote: 'n. 40 kpl',
      quantity: 40,
      minQuantity: 10,
      expiresOn: null,
      status: 'ok',
      sortOrder: 2,
    },
    {
      id: 'en-antiseptic',
      placeId: 'pl-fa-meds',
      name: 'Haavanpuhdistuspyyhkeet',
      quantityNote: '1 rasia',
      quantity: 1,
      minQuantity: 1,
      expiresOn: daysFromNow(-12),
      status: 'ok',
      sortOrder: 1,
    },
    {
      id: 'en-plasters',
      placeId: 'pl-fa-bandages',
      name: 'Laastarit (lajitelma)',
      quantityNote: '2 pakettia',
      quantity: 2,
      minQuantity: 2,
      expiresOn: daysFromNow(365),
      status: 'ok',
      sortOrder: 2,
    },
    {
      id: 'en-candles',
      placeId: 'pl-sacristy-top',
      name: 'Alttarikynttilät',
      quantityNote: '12 kpl',
      quantity: 12,
      minQuantity: 6,
      expiresOn: null,
      status: 'ok',
      sortOrder: 1,
    },
  ];

  const reports = [
    {
      id: 'rep-1',
      storageId: 'st-kitchen',
      placeId: 'pl-shelf-a',
      itemId: 'it-coffee',
      entryId: null,
      targetName: 'Kahvinkeitin Moccamaster',
      kind: 'broken',
      note: 'Virtakytkin ei pysy päällä.',
      reporterName: 'Maija M.',
      status: 'open',
      votes: 2,
      createdAt: daysFromNow(-2) + 'T09:30:00Z',
    },
    {
      id: 'rep-2',
      storageId: 'st-kitchen',
      placeId: 'pl-shelf-a-box1',
      itemId: null,
      entryId: 'en-cups',
      targetName: 'Kertakäyttökupit (pahvi)',
      kind: 'depleted',
      note: 'Viimeinen paketti avattu kirkkokahveilla.',
      reporterName: null,
      status: 'open',
      votes: 1,
      createdAt: daysFromNow(-1) + 'T13:15:00Z',
    },
  ];

  return { storages, places, items, entries, reports };
}

let state = createInitialState();

export function resetMockState() {
  state = createInitialState();
}

function isExpired(expiresOn) {
  if (!expiresOn) return false;
  return expiresOn < new Date().toISOString().slice(0, 10);
}

function isExpiringSoon(expiresOn) {
  if (!expiresOn) return false;
  const today = new Date().toISOString().slice(0, 10);
  const soon = daysFromNow(60);
  return expiresOn >= today && expiresOn <= soon;
}

function computePlacePath(place) {
  const path = [place.name];
  let current = place;
  while (current.parentPlaceId) {
    const parent = state.places.find((p) => p.id === current.parentPlaceId);
    if (!parent) break;
    path.unshift(parent.name);
    current = parent;
  }
  return path;
}

function computeCountsForPlace(placeId) {
  const placeItems = state.items.filter((i) => i.placeId === placeId);
  const placeEntries = state.entries.filter((e) => e.placeId === placeId);
  const openReps = state.reports.filter((r) => r.placeId === placeId && r.status === 'open');
  let depleted = 0;
  let broken = 0;
  let expiringSoon = 0;
  let expired = 0;

  for (const it of placeItems) {
    if (it.status === 'depleted') depleted++;
    if (it.status === 'broken') broken++;
    if (isExpired(it.expiresOn)) expired++;
    else if (isExpiringSoon(it.expiresOn)) expiringSoon++;
  }
  for (const en of placeEntries) {
    if (en.status === 'depleted') depleted++;
    if (isExpired(en.expiresOn)) expired++;
    else if (isExpiringSoon(en.expiresOn)) expiringSoon++;
  }

  return {
    places: 1,
    items: placeItems.length,
    entries: placeEntries.length,
    openReports: openReps.length,
    depleted,
    broken,
    expiringSoon,
    expired,
  };
}

function computeStorageSummary(st) {
  const stPlaces = state.places.filter((p) => p.storageId === st.id);
  const counts = {
    places: stPlaces.length,
    items: 0,
    entries: 0,
    openReports: 0,
    depleted: 0,
    broken: 0,
    expiringSoon: 0,
    expired: 0,
  };
  for (const pl of stPlaces) {
    const pc = computeCountsForPlace(pl.id);
    counts.items += pc.items;
    counts.entries += pc.entries;
    counts.openReports += pc.openReports;
    counts.depleted += pc.depleted;
    counts.broken += pc.broken;
    counts.expiringSoon += pc.expiringSoon;
    counts.expired += pc.expired;
  }

  let inspectionDue = false;
  if (st.inspectionIntervalDays) {
    if (!st.lastInspectedAt) {
      inspectionDue = true;
    } else {
      const last = new Date(st.lastInspectedAt).getTime();
      const dueAt = last + st.inspectionIntervalDays * 86400000;
      inspectionDue = Date.now() >= dueAt;
    }
  }

  return {
    id: st.id,
    name: st.name,
    kind: st.kind,
    description: st.description,
    hasImage: st.hasImage,
    publicListed: st.publicListed,
    inspectionIntervalDays: st.inspectionIntervalDays,
    lastInspectedAt: st.lastInspectedAt,
    inspectionDue,
    counts,
  };
}

function buildPlaceDetail(pl) {
  const items = state.items.filter((i) => i.placeId === pl.id);
  const entries = state.entries
    .filter((e) => e.placeId === pl.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    ...pl,
    path: computePlacePath(pl),
    items,
    entries,
    counts: computeCountsForPlace(pl.id),
  };
}

function buildStorageDetail(st) {
  const summary = computeStorageSummary(st);
  const stPlaces = state.places.filter((p) => p.storageId === st.id).map(buildPlaceDetail);
  const openMap = new Map();
  for (const r of state.reports) {
    if (r.storageId === st.id && r.status === 'open') {
      openMap.set(r.kind, (openMap.get(r.kind) || 0) + 1);
    }
  }
  const openReports = Array.from(openMap.entries()).map(([kind, count]) => ({ kind, count }));
  return {
    ...summary,
    imageUrl: st.imageUrl,
    imageWidth: st.imageWidth,
    imageHeight: st.imageHeight,
    code: st.code,
    places: stPlaces,
    openReports,
  };
}

function generateMockCode() {
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const pick = () => chars[Math.floor(Math.random() * chars.length)];
  const g1 = pick() + pick() + pick() + pick();
  const g2 = pick() + pick() + pick() + pick();
  const chk = pick();
  return `${g1}-${g2}-${chk}`;
}

export function generateMockQrSvgDataUrl(code) {
  const text = String(code || 'QR');
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  const cells = [];
  const size = 7;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const isCorner =
        (x < 2 && y < 2) || (x >= size - 2 && y < 2) || (x < 2 && y >= size - 2);
      const bit = ((hash >> ((x + y * size) % 24)) & 1) === 1;
      if (isCorner || bit) {
        cells.push(`<rect x="${x * 10 + 5}" y="${y * 10 + 5}" width="9" height="9" fill="#0f172a"/>`);
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80"><rect width="80" height="80" fill="#ffffff"/>${cells.join('')}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const mockApi = {
  async getPublicStorages({ kind = '', q = '' } = {}) {
    let list = state.storages.filter((s) => s.publicListed).map(computeStorageSummary);
    if (kind) list = list.filter((s) => s.kind === kind);
    if (q) {
      const needle = q.toLowerCase();
      list = list.filter(
        (s) => s.name.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle)
      );
    }
    return list;
  },

  async getPublicStorage(id) {
    const st = state.storages.find((s) => s.id === id);
    if (!st) throw new Error('Säilytyspaikkaa ei löytynyt');
    return buildStorageDetail(st);
  },

  async resolveCode(code) {
    const normalized = String(code || '').trim().toUpperCase();
    const item = state.items.find((i) => i.code === normalized);
    if (item) {
      const place = state.places.find((p) => p.id === item.placeId) || null;
      const st = place
        ? state.storages.find((s) => s.id === place.storageId)
        : state.storages[0];
      const placeDetail = place ? buildPlaceDetail(place) : null;
      const openReports = state.reports.filter(
        (r) => r.status === 'open' && (r.itemId === item.id || (place && r.placeId === place.id))
      );
      return {
        kind: 'item',
        storage: buildStorageDetail(st),
        place: place ? { ...place, path: computePlacePath(place) } : null,
        item,
        placeDetail,
        openReports,
      };
    }

    const place = state.places.find((p) => p.code === normalized);
    if (place) {
      const st = state.storages.find((s) => s.id === place.storageId);
      const placeDetail = buildPlaceDetail(place);
      const openReports = state.reports.filter(
        (r) => r.status === 'open' && r.placeId === place.id
      );
      return {
        kind: 'place',
        storage: buildStorageDetail(st),
        place: { ...place, path: computePlacePath(place) },
        item: null,
        placeDetail,
        openReports,
      };
    }

    const st = state.storages.find((s) => s.code === normalized);
    if (st) {
      const openReports = state.reports.filter(
        (r) => r.status === 'open' && r.storageId === st.id
      );
      return {
        kind: 'storage',
        storage: buildStorageDetail(st),
        place: null,
        item: null,
        placeDetail: null,
        openReports,
      };
    }

    const err = new Error('Tuntematon koodi');
    err.status = 404;
    throw err;
  },

  async createPublicReport(placeId, body) {
    const place = state.places.find((p) => p.id === placeId);
    if (!place) throw new Error('Paikkaa ei löytynyt');
    const existing = state.reports.find(
      (r) =>
        r.status === 'open' &&
        r.placeId === placeId &&
        r.kind === body.kind &&
        (r.itemId || null) === (body.itemId || null) &&
        (r.entryId || null) === (body.entryId || null)
    );
    if (existing) {
      existing.votes += 1;
      return { ...existing };
    }
    const item = body.itemId ? state.items.find((i) => i.id === body.itemId) : null;
    const entry = body.entryId ? state.entries.find((e) => e.id === body.entryId) : null;
    if (item && (body.kind === 'depleted' || body.kind === 'broken')) {
      item.status = body.kind;
    }
    if (entry && body.kind === 'depleted') {
      entry.status = 'depleted';
    }
    const report = {
      id: `rep-${Date.now()}`,
      storageId: place.storageId,
      placeId,
      itemId: body.itemId || null,
      entryId: body.entryId || null,
      targetName: item?.name || entry?.name || place.name,
      kind: body.kind,
      note: body.note || '',
      reporterName: body.name || null,
      status: 'open',
      votes: 1,
      createdAt: new Date().toISOString(),
    };
    state.reports.unshift(report);
    return { ...report };
  },

  async votePublicReport(reportId) {
    const rep = state.reports.find((r) => r.id === reportId);
    if (!rep) throw new Error('Ilmoitusta ei löytynyt');
    rep.votes += 1;
    return { votes: rep.votes };
  },

  async getMe() {
    return {
        user: { sub: 'dev-keeper', name: 'Kehittäjä', role: 'keeper' },
        authMode: 'dev',
        organizationId: 'mock-org',
        organizations: [],
      };
  },

  async getStorages() {
    return state.storages.map(computeStorageSummary);
  },

  async getStorage(id) {
    return this.getPublicStorage(id);
  },

  async createStorage(data) {
    const st = {
      id: `st-${Date.now()}`,
      name: data.name,
      kind: data.kind || 'room',
      description: data.description || '',
      hasImage: false,
      imageUrl: null,
      imageWidth: null,
      imageHeight: null,
      publicListed: data.publicListed !== false,
      responsiblePerson: data.responsiblePersonType ? {
        type: data.responsiblePersonType,
        sub: data.responsiblePersonSub || null,
        name: data.responsiblePersonName || '',
        email: data.responsiblePersonEmail || null,
        phone: data.responsiblePersonPhone || null,
      } : null,
      responsiblePersonName: data.responsiblePersonName || null,
      inspectionIntervalDays: data.inspectionIntervalDays ? Number(data.inspectionIntervalDays) : null,
      lastInspectedAt: null,
      code: null,
      printedAt: null,
    };
    state.storages.push(st);
    return computeStorageSummary(st);
  },

  async updateStorage(id, data) {
    const st = state.storages.find((s) => s.id === id);
    if (!st) throw new Error('Ei löytynyt');
    Object.assign(st, {
      name: data.name ?? st.name,
      kind: data.kind ?? st.kind,
      description: data.description ?? st.description,
      publicListed: data.publicListed ?? st.publicListed,
      responsiblePerson: data.responsiblePersonType === null ? null : (data.responsiblePersonType ? {
        type: data.responsiblePersonType, sub: data.responsiblePersonSub || null,
        name: data.responsiblePersonName || '', email: data.responsiblePersonEmail || null,
        phone: data.responsiblePersonPhone || null,
      } : st.responsiblePerson),
      responsiblePersonName: data.responsiblePersonName ?? st.responsiblePersonName,
      inspectionIntervalDays:
        data.inspectionIntervalDays !== undefined
          ? data.inspectionIntervalDays
            ? Number(data.inspectionIntervalDays)
            : null
          : st.inspectionIntervalDays,
    });
    return computeStorageSummary(st);
  },

  async deleteStorage(id) {
    state.storages = state.storages.filter((s) => s.id !== id);
    return { ok: true };
  },

  async uploadStorageImage(id) {
    const st = state.storages.find((s) => s.id === id);
    if (!st) throw new Error('Ei löytynyt');
    st.hasImage = true;
    st.imageUrl = STOREROOM_SVG;
    st.imageWidth = 1000;
    st.imageHeight = 700;
    return computeStorageSummary(st);
  },

  async inspectStorage(id) {
    const st = state.storages.find((s) => s.id === id);
    if (!st) throw new Error('Ei löytynyt');
    st.lastInspectedAt = new Date().toISOString();
    return computeStorageSummary(st);
  },

  async getPlaces(params = {}) {
    let list = state.places;
    if (params.storageId) list = list.filter((p) => p.storageId === params.storageId);
    return list.map((p) => ({ ...p, path: computePlacePath(p) }));
  },

  async createPlace(data) {
    const pl = {
      id: `pl-${Date.now()}`,
      storageId: data.storageId,
      parentPlaceId: data.parentPlaceId || null,
      name: data.name,
      description: data.description || '',
      pinX: data.pinX ?? null,
      pinY: data.pinY ?? null,
      pinLabel: data.pinLabel || '',
      reportConfig: data.reportConfig || { kinds: ['depleted', 'broken', 'other'] },
      code: null,
      printedAt: null,
    };
    state.places.push(pl);
    return { ...pl, path: computePlacePath(pl) };
  },

  async updatePlace(id, data) {
    const pl = state.places.find((p) => p.id === id);
    if (!pl) throw new Error('Ei löytynyt');
    Object.assign(pl, data);
    return { ...pl, path: computePlacePath(pl) };
  },

  async deletePlace(id) {
    state.places = state.places.filter((p) => p.id !== id);
    return { ok: true };
  },

  async createEntry(placeId, data) {
    const en = {
      id: `en-${Date.now()}`,
      placeId,
      name: data.name,
      quantityNote: data.quantityNote || '',
      quantity: data.quantity !== '' && data.quantity !== null && data.quantity !== undefined ? Number(data.quantity) : null,
      minQuantity: data.minQuantity !== '' && data.minQuantity !== null && data.minQuantity !== undefined ? Number(data.minQuantity) : null,
      expiresOn: data.expiresOn || null,
      status: data.status || 'ok',
      sortOrder: state.entries.length + 1,
    };
    state.entries.push(en);
    return en;
  },

  async updateEntry(placeId, entryId, data) {
    const en = state.entries.find((e) => e.id === entryId && e.placeId === placeId);
    if (!en) throw new Error('Ei löytynyt');
    Object.assign(en, data);
    return en;
  },

  async deleteEntry(placeId, entryId) {
    state.entries = state.entries.filter((e) => !(e.id === entryId && e.placeId === placeId));
    return { ok: true };
  },

  async getItems(params = {}) {
    let list = state.items;
    if (params.place) list = list.filter((i) => i.placeId === params.place);
    if (params.status) list = list.filter((i) => i.status === params.status);
    if (params.q) {
      const needle = params.q.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(needle));
    }
    return list;
  },

  async createItem(data) {
    const it = {
      id: `it-${Date.now()}`,
      placeId: data.placeId || null,
      name: data.name,
      description: data.description || '',
      category: data.category || '',
      status: data.status || 'ok',
      expiresOn: data.expiresOn || null,
      minQuantity: data.minQuantity ? Number(data.minQuantity) : null,
      code: null,
      printedAt: null,
    };
    state.items.push(it);
    return it;
  },

  async updateItem(id, data) {
    const it = state.items.find((i) => i.id === id);
    if (!it) throw new Error('Ei löytynyt');
    Object.assign(it, data);
    return it;
  },

  async deleteItem(id) {
    state.items = state.items.filter((i) => i.id !== id);
    return { ok: true };
  },

  async moveItem(id, placeId) {
    const it = state.items.find((i) => i.id === id);
    if (!it) throw new Error('Ei löytynyt');
    it.placeId = placeId;
    return it;
  },

  async getReports(params = {}) {
    let list = state.reports;
    if (params.status) list = list.filter((r) => r.status === params.status);
    if (params.storageId) list = list.filter((r) => r.storageId === params.storageId);
    if (params.kind) list = list.filter((r) => r.kind === params.kind);
    return list;
  },

  async ackReport(id) {
    const rep = state.reports.find((r) => r.id === id);
    if (rep) rep.status = 'acknowledged';
    return rep;
  },

  async resolveReport(id) {
    const rep = state.reports.find((r) => r.id === id);
    if (rep) {
      rep.status = 'resolved';
      if (rep.itemId) {
        const it = state.items.find((i) => i.id === rep.itemId);
        if (it) it.status = 'ok';
      }
      if (rep.entryId) {
        const en = state.entries.find((e) => e.id === rep.entryId);
        if (en) en.status = 'ok';
      }
    }
    return rep;
  },

  async dismissReport(id) {
    const rep = state.reports.find((r) => r.id === id);
    if (rep) rep.status = 'dismissed';
    return rep;
  },

  async issueCode(kind, targetId) {
    const code = generateMockCode();
    if (kind === 'storage') {
      const st = state.storages.find((s) => s.id === targetId);
      if (st) st.code = code;
    } else if (kind === 'place') {
      const pl = state.places.find((p) => p.id === targetId);
      if (pl) pl.code = code;
    } else if (kind === 'item') {
      const it = state.items.find((i) => i.id === targetId);
      if (it) it.code = code;
    }
    return { code, kind, targetId };
  },

  async voidCode(code) {
    for (const s of state.storages) if (s.code === code) s.code = null;
    for (const p of state.places) if (p.code === code) p.code = null;
    for (const i of state.items) if (i.code === code) i.code = null;
    return { ok: true };
  },

  async getLabelTargets({ storageId = '', kind = '', notPrinted = false, q = '' } = {}) {
    const targets = [];

    for (const st of state.storages) {
      targets.push({
        kind: 'storage',
        id: st.id,
        storageId: st.id,
        code: st.code,
        name: st.name,
        placePath: [],
        storageName: st.name,
        printedAt: st.printedAt || null,
      });
    }

    for (const pl of state.places) {
      const st = state.storages.find((s) => s.id === pl.storageId);
      targets.push({
        kind: 'place',
        id: pl.id,
        storageId: pl.storageId,
        code: pl.code,
        name: pl.name,
        placePath: computePlacePath(pl),
        storageName: st ? st.name : '',
        printedAt: pl.printedAt || null,
      });
    }

    for (const it of state.items) {
      const pl = state.places.find((p) => p.id === it.placeId);
      const st = pl ? state.storages.find((s) => s.id === pl.storageId) : null;
      targets.push({
        kind: 'item',
        id: it.id,
        storageId: st ? st.id : '',
        code: it.code,
        name: it.name,
        placePath: pl ? computePlacePath(pl) : [],
        storageName: st ? st.name : '',
        printedAt: it.printedAt || null,
        expiresOn: it.expiresOn || null,
      });
    }

    return targets.filter((tgt) => {
      if (storageId && tgt.storageId !== storageId) return false;
      if (kind && tgt.kind !== kind) return false;
      if (notPrinted && tgt.printedAt) return false;
      if (q) {
        const needle = q.toLowerCase();
        const hay = `${tgt.name} ${tgt.code || ''} ${tgt.storageName}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  },

  async generateLabelsPdf(labelRequest) {
    const now = new Date().toISOString();
    for (const ref of labelRequest.targets || []) {
      if (ref.kind === 'storage') {
        const st = state.storages.find((s) => s.id === ref.id);
        if (st) st.printedAt = now;
      } else if (ref.kind === 'place') {
        const pl = state.places.find((p) => p.id === ref.id);
        if (pl) pl.printedAt = now;
      } else if (ref.kind === 'item') {
        const it = state.items.find((i) => i.id === ref.id);
        if (it) it.printedAt = now;
      }
    }
    return new Blob(['%PDF-1.4\n% Mock Tavaranpaikka Label PDF\n'], { type: 'application/pdf' });
  },
};
