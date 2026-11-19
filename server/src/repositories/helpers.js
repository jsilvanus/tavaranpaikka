/**
 * Ensure RequestContext has organizationId.
 * @param {import('../types.js').RequestContext} ctx
 * @returns {string}
 */
export function requireOrgId(ctx) {
  if (!ctx || typeof ctx.organizationId !== 'string' || !ctx.organizationId) {
    throw new Error('RequestContext with organizationId is required');
  }
  return ctx.organizationId;
}

/**
 * Format a Date or date string as YYYY-MM-DD, or null.
 * @param {Date | string | null | undefined} val
 * @returns {string | null}
 */
export function formatDateOnly(val) {
  if (val == null) return null;
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return null;
    return val.toISOString().slice(0, 10);
  }
  const str = String(val);
  if (!str) return null;
  return str.slice(0, 10);
}

/**
 * Format a Date or timestamp string as ISO-8601, or null.
 * @param {Date | string | null | undefined} val
 * @returns {string | null}
 */
export function formatIso(val) {
  if (val == null) return null;
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? null : val.toISOString();
  }
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? String(val) : d.toISOString();
}

/**
 * @returns {import('../types.js').Counts}
 */
export function emptyCounts() {
  return {
    places: 0,
    items: 0,
    entries: 0,
    openReports: 0,
    depleted: 0,
    broken: 0,
    expiringSoon: 0,
    expired: 0,
  };
}

/**
 * Compute today's date and +60 days date in YYYY-MM-DD (UTC).
 * @param {Date} [now]
 * @returns {{ todayStr: string, soonStr: string }}
 */
export function getExpiryBounds(now = new Date()) {
  const todayStr = now.toISOString().slice(0, 10);
  const soonDate = new Date(now.getTime() + 60 * 86400_000);
  const soonStr = soonDate.toISOString().slice(0, 10);
  return { todayStr, soonStr };
}

/**
 * Classify an expiry date as expired or expiringSoon (within 60 days).
 * @param {string | null} expiresOn
 * @param {string} todayStr
 * @param {string} soonStr
 * @returns {{ isExpired: boolean, isExpiringSoon: boolean }}
 */
export function classifyExpiry(expiresOn, todayStr, soonStr) {
  if (!expiresOn) {
    return { isExpired: false, isExpiringSoon: false };
  }
  if (expiresOn < todayStr) {
    return { isExpired: true, isExpiringSoon: false };
  }
  if (expiresOn <= soonStr) {
    return { isExpired: false, isExpiringSoon: true };
  }
  return { isExpired: false, isExpiringSoon: false };
}

/**
 * Build path arrays for a list of places in the same storage.
 * @param {Array<{ id: string, parent_place_id?: string | null, parentPlaceId?: string | null, name: string }>} places
 * @returns {Map<string, string[]>}
 */
export function buildPlacePaths(places) {
  const byId = new Map();
  for (const p of places) {
    byId.set(p.id, p);
  }

  /** @type {Map<string, string[]>} */
  const cache = new Map();

  /**
   * @param {string} id
   * @param {Set<string>} visited
   * @returns {string[]}
   */
  function getPath(id, visited) {
    if (cache.has(id)) return /** @type {string[]} */ (cache.get(id));
    const p = byId.get(id);
    if (!p) return [];
    const parentId = p.parent_place_id ?? p.parentPlaceId ?? null;
    if (!parentId || visited.has(id) || !byId.has(parentId)) {
      const path = [p.name];
      cache.set(id, path);
      return path;
    }
    visited.add(id);
    const parentPath = getPath(parentId, visited);
    const path = [...parentPath, p.name];
    cache.set(id, path);
    return path;
  }

  for (const p of places) {
    getPath(p.id, new Set());
  }
  return cache;
}
