import QRCode from 'qrcode';

/**
 * Generate a QR code as an SVG string for the given URL.
 * @param {string} url
 * @param {import('qrcode').QRCodeToStringOptions} [options]
 * @returns {Promise<string>}
 */
export async function generateQrSvg(url, options = {}) {
  return QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    ...options,
  });
}
