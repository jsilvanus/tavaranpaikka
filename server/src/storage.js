import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { badRequest } from './errors.js';

/**
 * Sanitize and normalize a storage key.
 * @param {string} key
 * @returns {string}
 */
function sanitizeKey(key) {
  if (!key || typeof key !== 'string' || key.includes('..') || path.isAbsolute(key)) {
    throw badRequest('Invalid file key', 'INVALID_FILE_KEY');
  }
  const normalized = key.replace(/^\/+/, '');
  if (!normalized) {
    throw badRequest('Invalid file key', 'INVALID_FILE_KEY');
  }
  return normalized;
}

/**
 * Sanitize and resolve a storage key safely under baseDir.
 * @param {string} baseDir
 * @param {string} key
 * @returns {string}
 */
function resolveSafePath(baseDir, key) {
  const normalized = sanitizeKey(key);
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, normalized);
  if (!resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw badRequest('Invalid file key', 'INVALID_FILE_KEY');
  }
  return resolvedTarget;
}

/**
 * Infer content type from key extension.
 * @param {string} key
 * @returns {string}
 */
function inferContentType(key) {
  const ext = path.extname(key).toLowerCase();
  if (ext === '.webp') return 'image/webp';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

/**
 * @typedef {Object} ObjectStorage
 * @property {(key: string, buffer: Buffer, contentType?: string) => Promise<void>} putObject
 * @property {(key: string) => Promise<{ buffer: Buffer, contentType: string } | null>} getObject
 * @property {(key: string) => Promise<void>} deleteObject
 */

/**
 * Create an object storage driver (local disk or S3/MinIO).
 * @param {{
 *   driver?: 'local' | 's3',
 *   localDir?: string,
 *   s3Endpoint?: string,
 *   s3Region?: string,
 *   s3Bucket?: string,
 *   s3AccessKey?: string,
 *   s3SecretKey?: string,
 *   s3Client?: { send: (cmd: any) => Promise<any> }
 * }} [options]
 * @returns {ObjectStorage}
 */
export function createStorage(options = {}) {
  const driver = options.driver || 'local';

  if (driver === 's3') {
    const bucket = options.s3Bucket || '';
    if (!bucket) {
      throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');
    }

    const client =
      options.s3Client ||
      new S3Client({
        endpoint: options.s3Endpoint || undefined,
        region: options.s3Region || 'us-east-1',
        forcePathStyle: true,
        credentials:
          options.s3AccessKey && options.s3SecretKey
            ? {
                accessKeyId: options.s3AccessKey,
                secretAccessKey: options.s3SecretKey,
              }
            : undefined,
      });

    return {
      async putObject(key, buffer, contentType) {
        const normalized = sanitizeKey(key);
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: normalized,
            Body: buffer,
            ContentType: contentType || inferContentType(normalized),
          })
        );
      },

      async getObject(key) {
        const normalized = sanitizeKey(key);
        try {
          const res = await client.send(
            new GetObjectCommand({
              Bucket: bucket,
              Key: normalized,
            })
          );
          if (!res.Body) return null;
          const bytes = await res.Body.transformToByteArray();
          return {
            buffer: Buffer.from(bytes),
            contentType: res.ContentType || inferContentType(normalized),
          };
        } catch (err) {
          if (
            err &&
            typeof err === 'object' &&
            (('name' in err && err.name === 'NoSuchKey') ||
              ('$metadata' in err &&
                err.$metadata &&
                typeof err.$metadata === 'object' &&
                'httpStatusCode' in err.$metadata &&
                err.$metadata.httpStatusCode === 404))
          ) {
            return null;
          }
          throw err;
        }
      },

      async deleteObject(key) {
        const normalized = sanitizeKey(key);
        await client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: normalized,
          })
        );
      },
    };
  }

  if (driver !== 'local') {
    throw new Error(`Unsupported STORAGE_DRIVER: ${driver}`);
  }

  const localDir = options.localDir || './data/uploads';

  return {
    async putObject(key, buffer) {
      const target = resolveSafePath(localDir, key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, buffer);
    },

    async getObject(key) {
      const target = resolveSafePath(localDir, key);
      try {
        const buffer = await fs.readFile(target);
        return { buffer, contentType: inferContentType(key) };
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
          return null;
        }
        throw err;
      }
    },

    async deleteObject(key) {
      const target = resolveSafePath(localDir, key);
      try {
        await fs.unlink(target);
      } catch (err) {
        if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
          return;
        }
        throw err;
      }
    },
  };
}
