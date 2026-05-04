import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT ?? 5432),
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
});

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function ensureSchema() {
  const sqlPath = join(__dirname, '..', 'sql', 'schema.sql');
  const sql = await readFile(sqlPath, 'utf8');
  await pool.query(sql);
}
