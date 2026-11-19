import fs from 'node:fs/promises';
import path from 'node:path';
import { badRequest } from './errors.js';

/**
 * Sanitize and resolve a storage key safely under baseDir.
 * @param {string} baseDir
 * @param {string} key
 * @returns {string}
 */
function resolveSafePath(baseDir, key) {
  if (!key || typeof key !== 'string' || key.includes('..') || path.isAbsolute(key)) {
    throw badRequest('Invalid file key', 'INVALID_FILE_KEY');
  }
  const normalized = key.replace(/^\/+/, '');
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
 * Create an object storage driver (local disk for MVP/tests).
 * @param {{ driver?: 'local' | 's3', localDir?: string }} [options]
 * @returns {ObjectStorage}
 */
export function createStorage(options = {}) {
  const driver = options.driver || 'local';
  const localDir = options.localDir || './data/uploads';

  if (driver !== 'local') {
    throw new Error(`Unsupported STORAGE_DRIVER in this build: ${driver}`);
  }

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
