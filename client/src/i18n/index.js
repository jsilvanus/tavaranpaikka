import fi from './fi.json';

const messages = fi;

/**
 * Resolve a dot-separated key from the Finnish message catalogue and interpolate {{param}} values.
 * @param {string} key
 * @param {Record<string, string | number>} [params]
 * @returns {string}
 */
export function t(key, params) {
  const parts = key.split('.');
  let value = messages;
  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      return key;
    }
  }
  if (typeof value !== 'string') {
    return key;
  }
  if (!params) {
    return value;
  }
  return value.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    params[k] !== undefined && params[k] !== null ? String(params[k]) : ''
  );
}

/**
 * Format an ISO date or timestamp in Finnish locale.
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('fi-FI').format(date);
}

/**
 * Format an ISO date+time in Finnish locale.
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('fi-FI', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export default { t, formatDate, formatDateTime };
