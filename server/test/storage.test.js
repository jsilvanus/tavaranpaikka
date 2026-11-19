import { describe, expect, it } from 'vitest';
import { createStorage } from '../src/storage.js';

describe('ObjectStorage (S3 driver)', () => {
  it('requires s3Bucket when driver is s3', () => {
    expect(() => createStorage({ driver: 's3' })).toThrow('S3_BUCKET is required');
  });

  it('supports putObject, getObject, NoSuchKey -> null, and deleteObject', async () => {
    /** @type {Map<string, { body: Buffer, contentType: string }>} */
    const store = new Map();

    const fakeClient = {
      async send(cmd) {
        const name = cmd.constructor.name;
        const input = cmd.input;
        if (name === 'PutObjectCommand') {
          store.set(`${input.Bucket}/${input.Key}`, {
            body: Buffer.from(input.Body),
            contentType: input.ContentType,
          });
          return {};
        }
        if (name === 'GetObjectCommand') {
          const item = store.get(`${input.Bucket}/${input.Key}`);
          if (!item) {
            const err = new Error('NoSuchKey');
            err.name = 'NoSuchKey';
            throw err;
          }
          return {
            ContentType: item.contentType,
            Body: {
              async transformToByteArray() {
                return new Uint8Array(item.body);
              },
            },
          };
        }
        if (name === 'DeleteObjectCommand') {
          store.delete(`${input.Bucket}/${input.Key}`);
          return {};
        }
        throw new Error(`Unexpected command ${name}`);
      },
    };

    const storage = createStorage({
      driver: 's3',
      s3Bucket: 'tavaranpaikka-storage',
      s3Client: fakeClient,
    });

    await storage.putObject('storages/s1/pic.webp', Buffer.from('hello-webp'), 'image/webp');
    const fetched = await storage.getObject('storages/s1/pic.webp');
    expect(fetched).not.toBeNull();
    expect(fetched?.buffer.toString('utf8')).toBe('hello-webp');
    expect(fetched?.contentType).toBe('image/webp');

    await storage.deleteObject('storages/s1/pic.webp');
    expect(await storage.getObject('storages/s1/pic.webp')).toBeNull();

    // Rejects traversal keys
    await expect(storage.getObject('../secret')).rejects.toThrow('Invalid file key');
  });

  it('ensureBucket creates the bucket when HeadBucket fails (VersityGW/MinIO)', async () => {
    let created = false;
    const fakeClient = {
      async send(cmd) {
        if (cmd.constructor.name === 'HeadBucketCommand') {
          throw new Error('NotFound');
        }
        if (cmd.constructor.name === 'CreateBucketCommand') {
          created = true;
          return {};
        }
        return {};
      },
    };
    const storage = createStorage({
      driver: 's3',
      s3Bucket: 'tavaranpaikka-dev',
      s3Client: fakeClient,
    });
    await storage.ensureBucket?.();
    expect(created).toBe(true);
  });
});
