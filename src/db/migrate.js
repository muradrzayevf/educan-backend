import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from '../db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const run = async () => {
  const sql = await readFile(join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Migration tamamlandı.');
  await pool.end();
};

run().catch((err) => {
  console.error('Migration xətası:', err);
  process.exit(1);
});
