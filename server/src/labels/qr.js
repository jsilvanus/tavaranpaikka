import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOGO_PATH = path.join(__dirname, 'default-logo.png');

/** @type {Buffer | null} */
let cachedDefaultLogo = null;

/**
 * Return the built-in default parish logo PNG buffer.
 * @returns {Buffer}
 */
export function getDefaultLogoBuffer() {
  if (!cachedDefaultLogo) {
    cachedDefaultLogo = fs.readFileSync(DEFAULT_LOGO_PATH);
  }
  return cachedDefaultLogo;
}

/**
 * Generate a QR code as an SVG string for the given URL, optionally embedding
 * a centered logo with high (H) error correction.
 * @param {string} url
 * @param {import('qrcode').QRCodeToStringOptions & {
 *   showLogo?: boolean,
 *   logoBuffer?: Buffer | null
 * }} [options]
 * @returns {Promise<string>}
 */
export async function generateQrSvg(url, options = {}) {
  const { showLogo = false, logoBuffer = null, ...qrOpts } = options;

  const svg = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: showLogo ? 'H' : 'M',
    margin: 1,
    ...qrOpts,
  });

  if (!showLogo) {
    return svg;
  }

  const buf = logoBuffer || getDefaultLogoBuffer();
  const match = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  const size = match ? Number(match[1]) : 33;

  const boxSize = size * 0.24;
  const boxPos = (size - boxSize) / 2;
  const imgSize = size * 0.19;
  const imgPos = (size - imgSize) / 2;
  const rx = boxSize * 0.16;
  const dataUri = `data:image/png;base64,${buf.toString('base64')}`;

  const overlay =
    `<rect x="${boxPos.toFixed(2)}" y="${boxPos.toFixed(2)}" ` +
    `width="${boxSize.toFixed(2)}" height="${boxSize.toFixed(2)}" ` +
    `rx="${rx.toFixed(2)}" fill="#ffffff"/>` +
    `<image x="${imgPos.toFixed(2)}" y="${imgPos.toFixed(2)}" ` +
    `width="${imgSize.toFixed(2)}" height="${imgSize.toFixed(2)}" ` +
    `href="${dataUri}" preserveAspectRatio="xMidYMid meet"/>`;

  return svg.replace('</svg>', `${overlay}</svg>`);
}
