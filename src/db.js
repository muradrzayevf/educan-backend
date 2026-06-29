import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Gözlənilməz PostgreSQL pool xətası:', err);
  process.exit(1);
});

export const query = (text, params) => pool.query(text, params);
