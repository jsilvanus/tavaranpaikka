import crypto from 'node:crypto';
import { badRequest } from '../errors.js';
import { processImage } from '../images.js';
import { addOwnerImage } from '../repositories/imagesRepo.js';

const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;

/**
 * Download an image from an HTTP/HTTPS URL, process it via Sharp,
 * store it into object storage, and record it in the database.
 *
 * Supports presigned URLs issued by ImageHost MCP, S3/MinIO/VersityGW, or any valid HTTP/HTTPS image URL.
 *
 * @param {{
 *   db: import('../db.js').DbClient,
 *   storage: import('../storage.js').ObjectStorage,
 *   ctx: import('../types.js').RequestContext,
 *   ownerKind: 'storage' | 'item',
 *   ownerId: string,
 *   url: string,
 *   caption?: string
 * }} options
 * @returns {Promise<import('../types.js').OwnerImage>}
 */
export async function downloadAndAttachImage({
  db,
  storage,
  ctx,
  ownerKind,
  ownerId,
  url,
  caption = '',
}) {
  if (!url || typeof url !== 'string') {
    throw badRequest('Image URL is required', 'MISSING_IMAGE_URL');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw badRequest('Invalid image URL format', 'INVALID_IMAGE_URL');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw badRequest('Image URL must use http or https protocol', 'UNSUPPORTED_PROTOCOL');
  }

  let response;
  try {
    response = await fetch(parsedUrl.href, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Accept: 'image/webp,image/png,image/jpeg,image/*;q=0.8',
        'User-Agent': 'Tavaranpaikka-MCP/1.0',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw badRequest(`Failed to reach photo URL: ${message}`, 'IMAGE_FETCH_FAILED');
  }

  if (!response.ok) {
    throw badRequest(
      `Photo download failed with HTTP status ${response.status} (${response.statusText})`,
      'IMAGE_FETCH_FAILED'
    );
  }

  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const declaredSize = Number(contentLengthHeader);
    if (declaredSize > MAX_DOWNLOAD_BYTES) {
      throw badRequest('Photo size exceeds 15 MB limit', 'IMAGE_TOO_LARGE');
    }
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw badRequest('Photo size exceeds 15 MB limit', 'IMAGE_TOO_LARGE');
  }
  if (arrayBuffer.byteLength === 0) {
    throw badRequest('Downloaded photo is empty', 'INVALID_IMAGE');
  }

  const inputBuffer = Buffer.from(arrayBuffer);
  const processed = await processImage(inputBuffer);

  const uid = crypto.randomUUID();
  const folder = ownerKind === 'storage' ? 'storages' : 'items';
  const displayKey = `${folder}/${ownerId}/${uid}.${processed.ext}`;
  const originalKey = `${folder}/${ownerId}/${uid}_orig.${processed.ext}`;

  await storage.putObject(displayKey, processed.displayBuffer, processed.contentType);
  await storage.putObject(originalKey, processed.originalBuffer, processed.contentType);

  const imageRecord = await addOwnerImage(db, ctx, {
    ownerKind,
    ownerId,
    imageKey: displayKey,
    width: processed.width,
    height: processed.height,
    caption: (caption || '').slice(0, 200),
  });

  return imageRecord;
}
