import pg from 'pg';
import { config } from './config.js';

export type Db = pg.Pool | pg.PoolClient;

export function createPool(connectionString: string = config.databaseUrl): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

/** Run `fn` inside one transaction; rolls back on any throw. */
export async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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
}
