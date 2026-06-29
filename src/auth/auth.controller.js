import crypto from 'node:crypto';
import { pool, query } from '../db.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { signToken } from '../utils/jwt.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isEmail, isNonEmpty, isStrongPassword } from '../utils/validate.js';
import { sendPasswordResetEmail, sendOtpEmail, sendWelcomeEmail } from '../utils/email.js';
import { verifyGoogleIdToken, googleConfigured } from '../utils/google.js';

const RESET_TOKEN_TTL_MIN = 60;
const OTP_TTL_MIN = Number(process.env.OTP_TTL_MIN || 10);
const OTP_MAX_ATTEMPTS = 5;
const PG_UNIQUE_VIOLATION = '23505';

const publicUser = (u) => ({
  id: u.id,
  role: u.role,
  fullName: u.full_name,
  email: u.email,
  phone: u.phone,
  region: u.region,
});

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const issueOtp = async (userId, email) => {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);
  await query(
    `INSERT INTO email_otps (user_id, code_hash, expires_at, attempts)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (user_id) DO UPDATE SET code_hash = $2, expires_at = $3, attempts = 0, created_at = now()`,
    [userId, sha256(code), expiresAt]
  );
  await sendOtpEmail(email, code, OTP_TTL_MIN);
};

export const registerStudent = asyncHandler(async (req, res) => {
  const { fullName, email, phone, region, password, confirmPassword, acceptTerms } = req.body;

  const errors = [];
  if (!isNonEmpty(fullName)) errors.push('Ad və soyad tələb olunur.');
  if (!isEmail(email)) errors.push('Düzgün email ünvanı daxil edin.');
  if (!isNonEmpty(region)) errors.push('Region seçilməlidir.');
  if (!isStrongPassword(password)) errors.push('Parol ən azı 8 simvol olmalıdır.');
  if (password !== confirmPassword) errors.push('Parollar uyğun gəlmir.');
  if (acceptTerms !== true) errors.push('İstifadəçi şərtləri qəbul edilməlidir.');
  if (errors.length) throw new AppError(errors.join(' '), 422);

  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await hashPassword(password);

  const existing = (await query('SELECT id, email_verified FROM users WHERE email = $1', [normalizedEmail])).rows[0];
  if (existing && existing.email_verified) throw new AppError('Bu email artıq qeydiyyatdan keçib.', 409);

  let userId;
  if (existing) {
    await query(
      `UPDATE users SET full_name=$2, phone=$3, region=$4, password_hash=$5, role='student', updated_at=now()
       WHERE id=$1`,
      [existing.id, fullName.trim(), phone?.trim() || null, region.trim(), passwordHash]
    );
    userId = existing.id;
  } else {
    try {
      const result = await query(
        `INSERT INTO users (role, full_name, email, phone, region, password_hash, email_verified)
         VALUES ('student', $1, $2, $3, $4, $5, FALSE) RETURNING id`,
        [fullName.trim(), normalizedEmail, phone?.trim() || null, region.trim(), passwordHash]
      );
      userId = result.rows[0].id;
    } catch (err) {
      if (err.code === PG_UNIQUE_VIOLATION) throw new AppError('Bu email artıq qeydiyyatdan keçib.', 409);
      throw err;
    }
  }

  await issueOtp(userId, normalizedEmail);
  res.status(201).json({
    requiresVerification: true,
    email: normalizedEmail,
    message: `Təsdiq kodu ${normalizedEmail} ünvanına göndərildi. Kodu daxil edin.`,
  });
});

export const registerTeacher = asyncHandler(async (req, res) => {
  const { fullName, email, phone, region, password, confirmPassword, acceptTerms } = req.body;

  const errors = [];
  if (!isNonEmpty(fullName)) errors.push('Ad və soyad tələb olunur.');
  if (!isEmail(email)) errors.push('Düzgün email ünvanı daxil edin.');
  if (!isNonEmpty(phone)) errors.push('Telefon nömrəsi tələb olunur.');
  if (!isNonEmpty(region)) errors.push('Region seçilməlidir.');
  if (!isStrongPassword(password)) errors.push('Parol ən azı 8 simvol olmalıdır.');
  if (password !== confirmPassword) errors.push('Parollar uyğun gəlmir.');
  if (acceptTerms !== true) errors.push('İstifadəçi şərtləri qəbul edilməlidir.');
  if (errors.length) throw new AppError(errors.join(' '), 422);

  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await hashPassword(password);

  const existing = (await query('SELECT id, email_verified FROM users WHERE email = $1', [normalizedEmail])).rows[0];
  if (existing && existing.email_verified) throw new AppError('Bu email artıq qeydiyyatdan keçib.', 409);

  const client = await pool.connect();
  let userId;
  try {
    await client.query('BEGIN');
    if (existing) {
      await client.query(
        `UPDATE users SET full_name=$2, phone=$3, region=$4, password_hash=$5, role='teacher', updated_at=now()
         WHERE id=$1`,
        [existing.id, fullName.trim(), phone.trim(), region.trim(), passwordHash]
      );
      userId = existing.id;
      await client.query(
        `INSERT INTO teacher_profiles (user_id, status) VALUES ($1, 'pending')
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );
    } else {
      const result = await client.query(
        `INSERT INTO users (role, full_name, email, phone, region, password_hash, email_verified)
         VALUES ('teacher', $1, $2, $3, $4, $5, FALSE) RETURNING id`,
        [fullName.trim(), normalizedEmail, phone.trim(), region.trim(), passwordHash]
      );
      userId = result.rows[0].id;
      await client.query(`INSERT INTO teacher_profiles (user_id, status) VALUES ($1, 'pending')`, [userId]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === PG_UNIQUE_VIOLATION) throw new AppError('Bu email artıq qeydiyyatdan keçib.', 409);
    throw err;
  } finally {
    client.release();
  }

  await issueOtp(userId, normalizedEmail);
  res.status(201).json({
    requiresVerification: true,
    email: normalizedEmail,
    message: `Təsdiq kodu ${normalizedEmail} ünvanına göndərildi. Kodu daxil edin.`,
  });
});

export const verifyOtp = asyncHandler(async (req, res) => {
  const { email, code } = req.body || {};
  if (!isEmail(email) || !/^\d{6}$/.test(String(code || ''))) {
    throw new AppError('Email və 6 rəqəmli kod tələb olunur.', 422);
  }
  const normalizedEmail = email.trim().toLowerCase();

  const u = (await query(
    `SELECT u.*, t.status AS teacher_status, o.code_hash, o.expires_at, o.attempts
     FROM users u
     LEFT JOIN teacher_profiles t ON t.user_id = u.id
     LEFT JOIN email_otps o ON o.user_id = u.id
     WHERE u.email = $1`,
    [normalizedEmail]
  )).rows[0];

  if (!u || !u.code_hash) throw new AppError('Kod tapılmadı. Yenidən kod istəyin.', 400);
  if (new Date(u.expires_at) < new Date()) throw new AppError('Kodun vaxtı bitib. Yenidən kod istəyin.', 400);
  if (u.attempts >= OTP_MAX_ATTEMPTS) throw new AppError('Çox sayda səhv cəhd. Yenidən kod istəyin.', 429);

  if (sha256(String(code)) !== u.code_hash) {
    await query('UPDATE email_otps SET attempts = attempts + 1 WHERE user_id = $1', [u.id]);
    throw new AppError('Kod yanlışdır.', 400);
  }

  await query('UPDATE users SET email_verified = TRUE, updated_at = now() WHERE id = $1', [u.id]);
  await query('DELETE FROM email_otps WHERE user_id = $1', [u.id]);
  sendWelcomeEmail(u.email, { name: u.full_name, role: u.role }).catch(() => {});

  const token = signToken({ id: u.id, role: u.role });
  res.json({
    user: publicUser(u),
    token,
    profileStatus: u.role === 'teacher' ? u.teacher_status : null,
    message: 'Email təsdiqləndi.',
  });
});

export const resendOtp = asyncHandler(async (req, res) => {
  const { email } = req.body || {};
  if (!isEmail(email)) throw new AppError('Düzgün email daxil edin.', 422);
  const normalizedEmail = email.trim().toLowerCase();
  const u = (await query('SELECT id, email_verified FROM users WHERE email = $1', [normalizedEmail])).rows[0];
  if (u && !u.email_verified) await issueOtp(u.id, normalizedEmail);
  res.json({ message: 'Əgər hesab təsdiq gözləyirsə, yeni kod göndərildi.' });
});

export const googleAuth = asyncHandler(async (req, res) => {
  if (!googleConfigured()) throw new AppError('Google girişi aktiv deyil.', 400);
  const { credential, role } = req.body || {};
  if (!isNonEmpty(credential)) throw new AppError('Google token tələb olunur.', 422);

  let g;
  try {
    g = await verifyGoogleIdToken(credential);
  } catch (err) {
    throw new AppError(err.message || 'Google doğrulaması uğursuz.', 401);
  }

  const wantRole = role === 'teacher' ? 'teacher' : 'student';
  let user = (await query(
    `SELECT u.*, t.status AS teacher_status FROM users u
     LEFT JOIN teacher_profiles t ON t.user_id = u.id WHERE u.email = $1`,
    [g.email]
  )).rows[0];

  if (!user) {

    const randomHash = await hashPassword(crypto.randomBytes(24).toString('hex'));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO users (role, full_name, email, region, password_hash, email_verified, auth_provider)
         VALUES ($1, $2, $3, $4, $5, TRUE, 'google')
         RETURNING *`,
        [wantRole, g.name, g.email, 'Bakı', randomHash]
      );
      user = ins.rows[0];
      if (wantRole === 'teacher') {
        await client.query(`INSERT INTO teacher_profiles (user_id, status) VALUES ($1, 'pending')`, [user.id]);
        user.teacher_status = 'pending';
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    sendWelcomeEmail(g.email, { name: g.name, role: wantRole }).catch(() => {});
  } else if (!user.email_verified) {

    await query('UPDATE users SET email_verified = TRUE WHERE id = $1', [user.id]);
  }

  if (!user.is_active) throw new AppError('Hesabınız deaktiv edilib.', 403);

  const token = signToken({ id: user.id, role: user.role });
  res.json({
    user: publicUser(user),
    token,
    profileStatus: user.role === 'teacher' ? user.teacher_status : null,
  });
});

export const authConfig = asyncHandler(async (req, res) => {
  res.json({ googleEnabled: googleConfigured(), googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!isEmail(email) || !isNonEmpty(password)) {
    throw new AppError('Email və parol tələb olunur.', 422);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const result = await query(
    `SELECT u.*, t.status AS teacher_status
     FROM users u
     LEFT JOIN teacher_profiles t ON t.user_id = u.id
     WHERE u.email = $1`,
    [normalizedEmail]
  );
  const user = result.rows[0];

  if (!user) throw new AppError('Email və ya parol yanlışdır.', 401);

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) throw new AppError('Email və ya parol yanlışdır.', 401);

  if (!user.is_active) throw new AppError('Hesabınız deaktiv edilib.', 403);

  if (!user.email_verified) {
    await issueOtp(user.id, user.email);
    return res.status(403).json({
      error: 'Email təsdiqlənməyib. Sizə yeni təsdiq kodu göndərdik.',
      requiresVerification: true,
      email: user.email,
    });
  }

  const token = signToken({ id: user.id, role: user.role });
  res.json({
    user: publicUser(user),
    token,
    profileStatus: user.role === 'teacher' ? user.teacher_status : null,
  });
});

export const me = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT u.id, u.role, u.full_name, u.email, u.phone, u.region, t.status AS teacher_status
     FROM users u
     LEFT JOIN teacher_profiles t ON t.user_id = u.id
     WHERE u.id = $1`,
    [req.user.id]
  );
  const user = result.rows[0];
  if (!user) throw new AppError('İstifadəçi tapılmadı.', 404);
  res.json({
    user: publicUser(user),
    profileStatus: user.role === 'teacher' ? user.teacher_status : null,
  });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!isEmail(email)) throw new AppError('Düzgün email ünvanı daxil edin.', 422);

  const normalizedEmail = email.trim().toLowerCase();
  const result = await query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
  const user = result.rows[0];

  if (user) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60 * 1000);
    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, sha256(rawToken), expiresAt]
    );
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${rawToken}`;
    await sendPasswordResetEmail(normalizedEmail, resetUrl);
  }

  res.json({
    message: 'Əgər bu email qeydiyyatdadırsa, parol sıfırlama linki göndərildi.',
  });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password, confirmPassword } = req.body;
  if (!isNonEmpty(token)) throw new AppError('Token tələb olunur.', 422);
  if (!isStrongPassword(password)) throw new AppError('Parol ən azı 8 simvol olmalıdır.', 422);
  if (password !== confirmPassword) throw new AppError('Parollar uyğun gəlmir.', 422);

  const result = await query(
    `SELECT id, user_id FROM password_reset_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [sha256(token)]
  );
  const row = result.rows[0];
  if (!row) throw new AppError('Token etibarsızdır və ya vaxtı bitib.', 400);

  const passwordHash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`,
      [passwordHash, row.user_id]
    );

    await client.query(
      `UPDATE password_reset_tokens SET used_at = now()
       WHERE user_id = $1 AND used_at IS NULL`,
      [row.user_id]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json({ message: 'Şifrəniz uğurla dəyişdirildi. İndi daxil ola bilərsiniz.' });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  if (!isNonEmpty(currentPassword) || !isNonEmpty(newPassword)) {
    throw new AppError('Cari və yeni parol tələb olunur.', 422);
  }
  if (newPassword !== confirmPassword) throw new AppError('Yeni parollar uyğun gəlmir.', 422);
  if (!isStrongPassword(newPassword)) throw new AppError('Yeni parol ən azı 8 simvol olmalıdır.', 422);

  const r = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const user = r.rows[0];
  if (!user) throw new AppError('İstifadəçi tapılmadı.', 404);

  const okPass = await verifyPassword(currentPassword, user.password_hash);
  if (!okPass) throw new AppError('Cari parol yanlışdır.', 401);

  const hash = await hashPassword(newPassword);
  await query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, req.user.id]);
  res.json({ message: 'Parol uğurla dəyişdirildi.' });
});

export const logout = asyncHandler(async (req, res) => {
  res.json({ message: 'Çıxış edildi. Token-i client tərəfdə silin.' });
});
