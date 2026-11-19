import sharp from 'sharp';
import { badRequest } from './errors.js';

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * Validate an uploaded image, strip EXIF, auto-rotate, and generate
 * an original-bounded (max 2400px) and display (max 1000px) WebP copy.
 * @param {Buffer} buffer
 * @returns {Promise<{
 *   originalBuffer: Buffer,
 *   displayBuffer: Buffer,
 *   width: number,
 *   height: number,
 *   contentType: string,
 *   ext: string
 * }>}
 */
export async function processImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw badRequest('Image file is required', 'INVALID_IMAGE');
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw badRequest('Image exceeds 15 MB limit', 'IMAGE_TOO_LARGE');
  }

  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    throw badRequest('Invalid image data', 'INVALID_IMAGE');
  }

  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
    throw badRequest('Only JPEG, PNG, and WebP images are supported', 'UNSUPPORTED_IMAGE_FORMAT');
  }

  // sharp strips EXIF/metadata by default unless withMetadata() is called,
  // and .rotate() auto-orients according to EXIF orientation before stripping.
  const originalPipeline = sharp(buffer)
    .rotate()
    .resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 });

  const { data: originalBuffer, info: origInfo } = await originalPipeline.toBuffer({
    resolveWithObject: true,
  });

  const displayBuffer = await sharp(buffer)
    .rotate()
    .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  return {
    originalBuffer,
    displayBuffer,
    width: origInfo.width,
    height: origInfo.height,
    contentType: 'image/webp',
    ext: 'webp',
  };
}
