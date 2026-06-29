import { query } from '../db.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ALLOWED_SUBJECTS } from '../constants/subjects.js';
import { isEmail, isNonEmpty } from '../utils/validate.js';
import { saveUpload } from '../utils/storage.js';

const profileResponse = (row) => ({
  userId: row.user_id,
  status: row.status,
  profilePhotoUrl: row.profile_photo_url,
  tagline: row.tagline,
  bio: row.bio,
  education: row.education,
  experienceYears: row.experience_years,
  subjects: row.subjects || [],
  introVideoUrl: row.intro_video_url,
  session1on1: row.session_1on1,
  sessionGroup: row.session_group,
  groupCapacity: row.group_capacity,
  price1on1: row.price_1on1 != null ? Number(row.price_1on1) : null,
  priceGroup: row.price_group != null ? Number(row.price_group) : null,
  rejectionReason: row.rejection_reason,

  isComplete: Boolean(
    row.profile_photo_url &&
      row.bio &&
      Array.isArray(row.subjects) &&
      row.subjects.length > 0 &&
      row.intro_video_url &&
      (row.session_1on1 || row.session_group)
  ),
});

const asString = (v, label, max) => {
  if (typeof v !== 'string') throw new AppError(`${label} mətn olmalıdır.`, 422);
  const t = v.trim();
  if (t.length > max) throw new AppError(`${label} ${max} simvoldan çox ola bilməz.`, 422);
  return t || null;
};

const asUrlOrNull = (v, label) => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') throw new AppError(`${label} mətn olmalıdır.`, 422);
  const t = v.trim();
  if (!/^https?:\/\//i.test(t)) throw new AppError(`${label} http/https ilə başlayan URL olmalıdır.`, 422);
  return t;
};

const asPhotoUrlOrNull = (v, label) => {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') throw new AppError(`${label} mətn olmalıdır.`, 422);
  const t = v.trim();
  if (/^https?:\/\//i.test(t)) return t;
  if (/^\/uploads\/[\w.\-]+\.(jpe?g|png|webp)$/i.test(t)) return t;
  throw new AppError(`${label} düzgün şəkil ünvanı deyil.`, 422);
};

const asExperience = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 60) {
    throw new AppError('Təcrübə 0–60 il aralığında tam ədəd olmalıdır.', 422);
  }
  return n;
};

const asSubjects = (v) => {
  if (!Array.isArray(v) || v.length === 0) throw new AppError('Ən azı bir fənn seçilməlidir.', 422);
  const invalid = v.filter((s) => !ALLOWED_SUBJECTS.includes(s));
  if (invalid.length) throw new AppError(`Naməlum fənn: ${invalid.join(', ')}.`, 422);
  return [...new Set(v)];
};

const asBool = (v, label) => {
  if (typeof v !== 'boolean') throw new AppError(`${label} true və ya false olmalıdır.`, 422);
  return v;
};

const asGroupCapacity = (v) => {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 2 || n > 50) throw new AppError('Qrup tutumu 2–50 aralığında olmalıdır.', 422);
  return n;
};

const asPrice = (v, label) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 100000) throw new AppError(`${label} müsbət ədəd olmalıdır.`, 422);
  return Math.round(n * 100) / 100;
};

const FIELD_MAP = {
  profilePhotoUrl: { col: 'profile_photo_url', parse: (v) => asPhotoUrlOrNull(v, 'Profil şəkli linki') },
  tagline: { col: 'tagline', parse: (v) => asString(v, 'Tagline', 160) },
  bio: { col: 'bio', parse: (v) => asString(v, 'Bio', 500) },
  education: { col: 'education', parse: (v) => asString(v, 'Təhsil', 2000) },
  experienceYears: { col: 'experience_years', parse: asExperience },
  subjects: { col: 'subjects', parse: asSubjects },
  introVideoUrl: { col: 'intro_video_url', parse: (v) => asUrlOrNull(v, 'Video linki') },
  session1on1: { col: 'session_1on1', parse: (v) => asBool(v, '1-ə-1 sessiya') },
  sessionGroup: { col: 'session_group', parse: (v) => asBool(v, 'Qrup sessiyası') },
  groupCapacity: { col: 'group_capacity', parse: asGroupCapacity },
  price1on1: { col: 'price_1on1', parse: (v) => asPrice(v, '1-ə-1 qiymət') },
  priceGroup: { col: 'price_group', parse: (v) => asPrice(v, 'Qrup qiyməti') },
};

const MAJOR_FIELDS = new Set([
  'subjects',
  'price_1on1',
  'price_group',
  'session_1on1',
  'session_group',
  'group_capacity',
]);

export const getMyProfile = asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM teacher_profiles WHERE user_id = $1', [req.user.id]);
  const row = result.rows[0];
  if (!row) throw new AppError('Müəllim profili tapılmadı.', 404);
  res.json({ profile: profileResponse(row) });
});

export const updateMyProfile = asyncHandler(async (req, res) => {
  const current = await query('SELECT status FROM teacher_profiles WHERE user_id = $1', [req.user.id]);
  if (!current.rows[0]) throw new AppError('Müəllim profili tapılmadı.', 404);
  const currentStatus = current.rows[0].status;

  const setClauses = [];
  const values = [];
  let majorChanged = false;
  let i = 1;

  for (const [key, def] of Object.entries(FIELD_MAP)) {
    if (!(key in req.body)) continue;
    const dbValue = def.parse(req.body[key]);
    setClauses.push(`${def.col} = $${i++}`);
    values.push(dbValue);
    if (MAJOR_FIELDS.has(def.col)) majorChanged = true;
  }

  if (setClauses.length === 0) throw new AppError('Yenilənəcək heç bir sahə göndərilmədi.', 422);

  const requeued = majorChanged && currentStatus === 'approved';
  if (requeued) {
    setClauses.push(`status = 'pending'`, `reviewed_at = NULL`, `reviewed_by = NULL`);
  }
  setClauses.push('updated_at = now()');

  values.push(req.user.id);
  const result = await query(
    `UPDATE teacher_profiles SET ${setClauses.join(', ')} WHERE user_id = $${i} RETURNING *`,
    values
  );

  res.json({
    profile: profileResponse(result.rows[0]),
    ...(requeued
      ? { message: 'Əsas məlumat dəyişdiyi üçün profiliniz yenidən admin təsdiqinə göndərildi.' }
      : {}),
  });
});

export const uploadPhoto = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('Şəkil faylı tələb olunur (sahə adı: photo).', 422);
  const url = await saveUpload({ buffer: req.file.buffer, filename: req.file.filename, contentType: req.file.mimetype });
  await query('UPDATE teacher_profiles SET profile_photo_url = $1, updated_at = now() WHERE user_id = $2', [url, req.user.id]);
  res.json({ profilePhotoUrl: url, message: 'Şəkil yükləndi.' });
});

export const getAccount = asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT u.full_name, u.email, u.phone, u.region, u.notify_email, tp.bank_account
     FROM users u LEFT JOIN teacher_profiles tp ON tp.user_id = u.id WHERE u.id = $1`,
    [req.user.id]
  );
  const u = r.rows[0];
  res.json({
    fullName: u.full_name, email: u.email, phone: u.phone, region: u.region,
    notifyEmail: u.notify_email, bankAccount: u.bank_account || null,
  });
});

export const updateAccount = asyncHandler(async (req, res) => {
  const { fullName, email, phone, region, notifyEmail, bankAccount } = req.body || {};
  const fields = [];
  const vals = [];
  let i = 1;
  if (fullName != null) { if (!isNonEmpty(fullName)) throw new AppError('Ad boş ola bilməz.', 422); fields.push(`full_name=$${i++}`); vals.push(fullName.trim()); }
  if (email != null) { if (!isEmail(email)) throw new AppError('Email düzgün deyil.', 422); fields.push(`email=$${i++}`); vals.push(email.toLowerCase().trim()); }
  if (phone != null) { fields.push(`phone=$${i++}`); vals.push(phone || null); }
  if (region != null) { fields.push(`region=$${i++}`); vals.push(region || null); }
  if (notifyEmail != null) { fields.push(`notify_email=$${i++}`); vals.push(!!notifyEmail); }
  if (fields.length) {
    vals.push(req.user.id);
    try {
      await query(`UPDATE users SET ${fields.join(', ')}, updated_at=now() WHERE id=$${i}`, vals);
    } catch (err) {
      if (err.code === '23505') throw new AppError('Bu email artıq istifadədədir.', 409);
      throw err;
    }
  }
  if (bankAccount !== undefined) {
    await query('UPDATE teacher_profiles SET bank_account=$1, updated_at=now() WHERE user_id=$2', [bankAccount || null, req.user.id]);
  }
  res.json({ message: 'Məlumatlar yeniləndi.' });
});

export const deleteAccount = asyncHandler(async (req, res) => {
  await query('DELETE FROM users WHERE id=$1', [req.user.id]);
  res.json({ message: 'Hesab silindi.' });
});
