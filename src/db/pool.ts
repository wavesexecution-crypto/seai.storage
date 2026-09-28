import { Pool } from 'pg';
import { getConfig } from '../config/env.js';

export interface DbClient {
  query<T = any>(text: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }>;
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const cfg = getConfig();
  pool = new Pool({ connectionString: cfg.DATABASE_URL, max: 10 });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
