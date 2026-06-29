import { query } from '../db.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isUuid } from '../utils/validate.js';

const card = (r) => ({
  id: r.id,
  fullName: r.full_name,
  region: r.region,
  profilePhotoUrl: r.profile_photo_url,
  tagline: r.tagline,
  subjects: r.subjects || [],
  experienceYears: r.experience_years,
  session1on1: r.session_1on1,
  sessionGroup: r.session_group,
  price1on1: r.price_1on1 != null ? Number(r.price_1on1) : null,
  priceGroup: r.price_group != null ? Number(r.price_group) : null,
  avgRating: r.avg_rating != null ? Number(r.avg_rating) : null,
  reviewCount: r.review_count != null ? Number(r.review_count) : 0,
});

const publicProfile = (r) => ({
  ...card(r),
  bio: r.bio,
  education: r.education,
  introVideoUrl: r.intro_video_url,
  groupCapacity: r.group_capacity,
  avgRating: r.avg_rating != null ? Number(r.avg_rating) : null,
  reviewCount: r.review_count != null ? Number(r.review_count) : 0,

});

const SORTS = {
  newest: 'u.created_at DESC',
  cheapest: 'tp.price_1on1 ASC',
  priciest: 'tp.price_1on1 DESC',
  rating: 'avg_rating DESC NULLS LAST',
};

const parsePrice = (v, label) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new AppError(`${label} düzgün ədəd olmalıdır.`, 422);
  return n;
};

export const listTeachers = asyncHandler(async (req, res) => {
  const { subject, sessionType, sort } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const offset = (page - 1) * limit;

  const where = [`tp.status = 'approved'`];
  const params = [];

  if (subject) {
    params.push(subject);
    where.push(`$${params.length} = ANY(tp.subjects)`);
  }

  if (sessionType === '1on1') where.push('tp.session_1on1 = TRUE');
  else if (sessionType === 'group') where.push('tp.session_group = TRUE');
  else if (sessionType) throw new AppError('sessionType yalnız "1on1" və ya "group" ola bilər.', 422);

  const minPrice = parsePrice(req.query.minPrice, 'minPrice');
  if (minPrice != null) {
    params.push(minPrice);
    where.push(`tp.price_1on1 >= $${params.length}`);
  }
  const maxPrice = parsePrice(req.query.maxPrice, 'maxPrice');
  if (maxPrice != null) {
    params.push(maxPrice);
    where.push(`tp.price_1on1 <= $${params.length}`);
  }

  if (req.query.hasSlots === 'true') {
    where.push(`EXISTS (
      SELECT 1 FROM slots s
      WHERE s.teacher_id = u.id AND s.starts_at > now()
        AND s.capacity > (SELECT count(*) FROM bookings b WHERE b.slot_id = s.id AND b.status = 'booked')
    )`);
  }

  const orderBy = SORTS[sort] || SORTS.newest;
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const totalRes = await query(
    `SELECT count(*)::int AS total
     FROM teacher_profiles tp JOIN users u ON u.id = tp.user_id ${whereSql}`,
    params
  );
  const total = totalRes.rows[0].total;

  params.push(limit, offset);
  const result = await query(
    `SELECT u.id, u.full_name, u.region,
            tp.profile_photo_url, tp.tagline, tp.subjects, tp.experience_years,
            tp.session_1on1, tp.session_group, tp.price_1on1, tp.price_group,
            (SELECT ROUND(AVG(rating)::numeric, 1) FROM reviews r WHERE r.teacher_id = u.id) AS avg_rating,
            (SELECT count(*)::int FROM reviews r WHERE r.teacher_id = u.id) AS review_count
     FROM teacher_profiles tp
     JOIN users u ON u.id = tp.user_id
     ${whereSql}
     ORDER BY ${orderBy}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({
    teachers: result.rows.map(card),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const getTeacher = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) throw new AppError('Müəllim tapılmadı.', 404);
  const result = await query(
    `SELECT u.id, u.full_name, u.region,
            tp.profile_photo_url, tp.tagline, tp.subjects, tp.bio, tp.education,
            tp.experience_years, tp.intro_video_url,
            tp.session_1on1, tp.session_group, tp.group_capacity,
            tp.price_1on1, tp.price_group,
            (SELECT ROUND(AVG(rating)::numeric, 1) FROM reviews r WHERE r.teacher_id = u.id) AS avg_rating,
            (SELECT count(*)::int FROM reviews r WHERE r.teacher_id = u.id) AS review_count
     FROM teacher_profiles tp
     JOIN users u ON u.id = tp.user_id
     WHERE u.id = $1 AND tp.status = 'approved'`,
    [req.params.id]
  );
  if (!result.rows[0]) throw new AppError('Müəllim tapılmadı.', 404);
  res.json({ teacher: publicProfile(result.rows[0]) });
});

export const listTeacherSlots = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) throw new AppError('Müəllim tapılmadı.', 404);

  const ok = await query(
    `SELECT 1 FROM teacher_profiles WHERE user_id = $1 AND status = 'approved'`,
    [req.params.id]
  );
  if (!ok.rows[0]) throw new AppError('Müəllim tapılmadı.', 404);

  const result = await query(
    `SELECT s.id, s.starts_at, s.duration_min, s.session_type, s.capacity, s.price,
            (SELECT count(*)::int FROM bookings b WHERE b.slot_id = s.id AND b.status = 'booked') AS booked
     FROM slots s
     WHERE s.teacher_id = $1 AND s.starts_at > now()
     ORDER BY s.starts_at ASC`,
    [req.params.id]
  );
  const slots = result.rows
    .map((s) => ({
      id: s.id,
      startsAt: s.starts_at,
      durationMin: s.duration_min,
      sessionType: s.session_type,
      price: Number(s.price),
      available: s.capacity - s.booked,
    }))
    .filter((s) => s.available > 0);
  res.json({ slots });
});

export const listTeacherReviews = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) throw new AppError('Müəllim tapılmadı.', 404);
  const result = await query(
    `SELECT r.rating, r.comment, r.created_at, u.full_name AS student_name
     FROM reviews r JOIN users u ON u.id = r.student_id
     WHERE r.teacher_id = $1 ORDER BY r.created_at DESC LIMIT 50`,
    [req.params.id]
  );
  res.json({
    reviews: result.rows.map((r) => ({
      rating: r.rating,
      comment: r.comment,
      studentName: r.student_name,
      createdAt: r.created_at,
    })),
  });
});
