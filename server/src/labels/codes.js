import { randomInt } from 'node:crypto';

/**
 * Crockford Base32 alphabet (32 characters, excludes I, L, O, U).
 */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Coprime odd weights mod 32 for the 8 payload characters so single-char
 * substitutions and adjacent transpositions are always detected.
 */
const WEIGHTS = [1, 3, 5, 7, 11, 13, 17, 19];

/**
 * Compute the Crockford Base32 check character for an 8-character payload.
 * @param {string} payload8
 * @returns {string}
 */
function computeCheckChar(payload8) {
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    const idx = CROCKFORD_ALPHABET.indexOf(payload8[i]);
    if (idx === -1) {
      throw new Error(`Invalid Crockford base32 character: ${payload8[i]}`);
    }
    sum += idx * WEIGHTS[i];
  }
  return CROCKFORD_ALPHABET[sum % 32];
}

/**
 * Format 9 raw Crockford Base32 characters as `XXXX-XXXX-C`.
 * @param {string} raw9
 * @returns {string}
 */
function formatCode(raw9) {
  return `${raw9.slice(0, 4)}-${raw9.slice(4, 8)}-${raw9.slice(8, 9)}`;
}

/**
 * Generate a random 8-char Crockford Base32 code + 1 check character,
 * formatted as `XXXX-XXXX-C` (e.g. `K7M2-QX4D-9`).
 * @returns {string}
 */
export function generateCode() {
  let payload = '';
  for (let i = 0; i < 8; i++) {
    payload += CROCKFORD_ALPHABET[randomInt(32)];
  }
  const check = computeCheckChar(payload);
  return formatCode(payload + check);
}

/**
 * Strip whitespace and hyphens, uppercase, and return `XXXX-XXXX-C`,
 * or `null` if the length is not 9 or any character is outside Crockford Base32.
 * @param {unknown} code
 * @returns {string | null}
 */
export function normalizeCode(code) {
  if (typeof code !== 'string') {
    return null;
  }
  const cleaned = code.replace(/[\s-]+/g, '').toUpperCase();
  if (cleaned.length !== 9) {
    return null;
  }
  for (let i = 0; i < 9; i++) {
    if (!CROCKFORD_ALPHABET.includes(cleaned[i])) {
      return null;
    }
  }
  return formatCode(cleaned);
}

/**
 * Validate a code's alphabet, length, and weighted mod-32 check character.
 * @param {unknown} code
 * @returns {boolean}
 */
export function isValidCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized) {
    return false;
  }
  const raw = normalized.replace(/-/g, '');
  const expected = computeCheckChar(raw.slice(0, 8));
  return raw[8] === expected;
}
