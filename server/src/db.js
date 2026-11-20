import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);

/**
 * @typedef {Object} DbClient
 * @property {pg.Pool} pool
 * @property {boolean} isMem
 * @property {(text: string, params?: unknown[]) => Promise<pg.QueryResult>} query
 * @property {<T>(fn: (client: pg.PoolClient) => Promise<T>) => Promise<T>} withTransaction
 * @property {() => Promise<void>} close
 */

/**
 * Create a database wrapper using pg.Pool when DATABASE_URL is set (and not 'pg-mem'),
 * or an isolated pg-mem in-memory instance otherwise.
 * @param {string} [databaseUrl]
 * @returns {DbClient}
 */
export function createDb(databaseUrl = '') {
  const usePostgres = Boolean(databaseUrl && databaseUrl !== 'pg-mem');

  /** @type {pg.Pool} */
  let pool;
  if (usePostgres) {
    pool = new pg.Pool({ connectionString: databaseUrl });
  } else {
    const { newDb } = require('pg-mem');
    const mem = newDb({ autoCreateForeignKeyIndices: true });
    const { Pool } = mem.adapters.createPg();
    pool = new Pool();
  }

  return {
    pool,
    isMem: !usePostgres,
    query(text, params) {
      return pool.query(text, params);
    },
    async withTransaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
