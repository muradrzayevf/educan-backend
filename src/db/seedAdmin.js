import 'dotenv/config';
import { pool } from '../db.js';
import { hashPassword } from '../utils/password.js';

const [, , email, password, fullName = 'EduCan Admin'] = process.argv;

if (!email || !password) {
  console.error('İstifadə: node src/db/seedAdmin.js <email> <parol> ["Ad Soyad"]');
  process.exit(1);
}

const run = async () => {
  const hash = await hashPassword(password);
  await pool.query(
    `INSERT INTO users (role, full_name, email, password_hash)
     VALUES ('admin', $1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [fullName, email.toLowerCase(), hash]
  );
  console.log(`Admin hazırdır: ${email}`);
  await pool.end();
};

run().catch((err) => {
  console.error('Seed xətası:', err);
  process.exit(1);
});
