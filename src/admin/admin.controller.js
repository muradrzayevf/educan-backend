import { pool, query } from '../db.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isNonEmpty, isUuid } from '../utils/validate.js';
import { TEACHER_STATUSES } from '../constants/subjects.js';
import { sendTeacherStatusEmail } from '../utils/email.js';
import { applyWalletTx } from '../utils/wallet.js';

const listItem = (row) => ({
  id: row.id,
  fullName: row.full_name,
  email: row.email,
  region: row.region,
  status: row.status,
  subjects: row.subjects || [],
  tagline: row.tagline,
  registeredAt: row.created_at,
  reviewedAt: row.reviewed_at,
});

const detail = (row) => ({
  id: row.id,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone,
  region: row.region,
  registeredAt: row.created_at,
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
  reviewedAt: row.reviewed_at,
  reviewedBy: row.reviewed_by,
});

const setStatus = async (teacherId, newStatus, adminId, reason = null) => {
  const result = await query(
    `UPDATE teacher_profiles
     SET status = $1, rejection_reason = $2, reviewed_at = now(), reviewed_by = $3, updated_at = now()
     WHERE user_id = $4
     RETURNING *`,
    [newStatus, reason, adminId, teacherId]
  );
  return result.rows[0] || null;
};

const notify = async (userId, status, reason) => {
  const u = await query('SELECT email FROM users WHERE id = $1', [userId]);
  if (u.rows[0]) await sendTeacherStatusEmail(u.rows[0].email, status, reason);
};

const requireTeacherId = (id) => {

  if (!isUuid(id)) throw new AppError('Müəllim tapılmadı.', 404);
  return id;
};

export const listTeachers = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;

  const params = [];
  let whereSql = '';
  if (status) {
    if (!TEACHER_STATUSES.includes(status)) throw new AppError('Yanlış status filtri.', 422);
    params.push(status);
    whereSql = `WHERE tp.status = $${params.length}`;
  }

  const totalRes = await query(
    `SELECT count(*)::int AS total FROM teacher_profiles tp ${whereSql}`,
    params
  );
  const total = totalRes.rows[0].total;

  params.push(limit, offset);
  const result = await query(
    `SELECT u.id, u.full_name, u.email, u.region, u.created_at,
            tp.status, tp.subjects, tp.tagline, tp.reviewed_at
     FROM teacher_profiles tp
     JOIN users u ON u.id = tp.user_id
     ${whereSql}
     ORDER BY u.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({
    teachers: result.rows.map(listItem),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const getTeacher = asyncHandler(async (req, res) => {
  const id = requireTeacherId(req.params.id);
  const result = await query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.region, u.created_at, tp.*
     FROM teacher_profiles tp
     JOIN users u ON u.id = tp.user_id
     WHERE u.id = $1`,
    [id]
  );
  if (!result.rows[0]) throw new AppError('Müəllim tapılmadı.', 404);
  res.json({ teacher: detail(result.rows[0]) });
});

export const approveTeacher = asyncHandler(async (req, res) => {
  const id = requireTeacherId(req.params.id);
  const row = await setStatus(id, 'approved', req.user.id, null);
  if (!row) throw new AppError('Müəllim tapılmadı.', 404);
  await notify(id, 'approved');
  res.json({ message: 'Müəllim təsdiqləndi.', status: row.status });
});

export const rejectTeacher = asyncHandler(async (req, res) => {
  const id = requireTeacherId(req.params.id);
  const { reason } = req.body;
  if (!isNonEmpty(reason)) throw new AppError('Rədd səbəbi tələb olunur.', 422);
  const row = await setStatus(id, 'rejected', req.user.id, reason.trim());
  if (!row) throw new AppError('Müəllim tapılmadı.', 404);
  await notify(id, 'rejected', reason.trim());
  res.json({ message: 'Müəllim rədd edildi.', status: row.status });
});

export const suspendTeacher = asyncHandler(async (req, res) => {
  const id = requireTeacherId(req.params.id);
  const reason = isNonEmpty(req.body?.reason) ? req.body.reason.trim() : null;
  const row = await setStatus(id, 'suspended', req.user.id, reason);
  if (!row) throw new AppError('Müəllim tapılmadı.', 404);
  await notify(id, 'suspended', reason);
  res.json({ message: 'Müəllim dayandırıldı.', status: row.status });
});

export const reinstateTeacher = asyncHandler(async (req, res) => {
  const id = requireTeacherId(req.params.id);
  const row = await setStatus(id, 'approved', req.user.id, null);
  if (!row) throw new AppError('Müəllim tapılmadı.', 404);
  await notify(id, 'approved');
  res.json({ message: 'Müəllim yenidən aktivləşdirildi.', status: row.status });
});

import { COMMISSION_RATE } from '../constants/config.js';

export const dashboard = asyncHandler(async (req, res) => {
  const q = async (sql, p = []) => (await query(sql, p)).rows[0];
  const students = await q(`SELECT count(*)::int c FROM users WHERE role='student'`);
  const teachersApproved = await q(`SELECT count(*)::int c FROM teacher_profiles WHERE status='approved'`);
  const teachersPending = await q(`SELECT count(*)::int c FROM teacher_profiles WHERE status='pending'`);
  const lessonsMonth = await q(
    `SELECT count(*)::int c FROM bookings
     WHERE status='completed' AND completed_at >= date_trunc('month', now())`
  );
  const revenueMonth = await q(
    `SELECT COALESCE(SUM(price),0) g FROM bookings
     WHERE status='completed' AND completed_at >= date_trunc('month', now())`
  );
  const revenueAll = await q(`SELECT COALESCE(SUM(price),0) g FROM bookings WHERE status='completed'`);
  res.json({
    students: students.c,
    teachersApproved: teachersApproved.c,
    teachersPending: teachersPending.c,
    lessonsCompletedThisMonth: lessonsMonth.c,
    commissionRate: COMMISSION_RATE,
    platformRevenueThisMonth: Math.round(Number(revenueMonth.g) * COMMISSION_RATE * 100) / 100,
    platformRevenueAllTime: Math.round(Number(revenueAll.g) * COMMISSION_RATE * 100) / 100,
  });
});

export const listAllLessons = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const params = [];
  let whereSql = '';
  if (status) {
    if (!['booked', 'completed', 'cancelled'].includes(status)) throw new AppError('Yanlış status.', 422);
    params.push(status);
    whereSql = 'WHERE b.status = $1';
  }
  const result = await query(
    `SELECT b.id, b.session_type, b.price, b.starts_at, b.status, b.subject,
            st.full_name AS student_name, te.full_name AS teacher_name
     FROM bookings b
     JOIN users st ON st.id = b.student_id
     JOIN users te ON te.id = b.teacher_id
     ${whereSql}
     ORDER BY b.starts_at DESC LIMIT 200`,
    params
  );
  res.json({
    lessons: result.rows.map((r) => ({
      id: r.id,
      studentName: r.student_name,
      teacherName: r.teacher_name,
      subject: r.subject || null,
      sessionType: r.session_type,
      price: Number(r.price),
      startsAt: r.starts_at,
      status: r.status,
    })),
  });
});

export const listPayments = asyncHandler(async (req, res) => {
  const k = COMMISSION_RATE;
  const round = (n) => Math.round(n * 100) / 100;

  const topups = await query(
    `SELECT w.amount, w.created_at, u.full_name AS user_name
     FROM wallet_transactions w JOIN users u ON u.id = w.user_id
     WHERE w.type = 'topup' ORDER BY w.created_at DESC LIMIT 100`
  );

  const lessonPays = await query(
    `SELECT b.completed_at, b.price, st.full_name AS student_name, te.full_name AS teacher_name
     FROM bookings b JOIN users st ON st.id=b.student_id JOIN users te ON te.id=b.teacher_id
     WHERE b.status='completed' ORDER BY b.completed_at DESC LIMIT 100`
  );
  const payouts = await query(
    `SELECT p.id, p.amount, p.status, p.requested_at, p.paid_at, u.full_name AS teacher_name
     FROM payouts p JOIN users u ON u.id = p.teacher_id
     ORDER BY p.requested_at DESC LIMIT 100`
  );

  const sum = (await query(
    `SELECT COALESCE(SUM(amount),0) AS topups FROM wallet_transactions WHERE type='topup'`
  )).rows[0];
  const grossAll = (await query(
    `SELECT COALESCE(SUM(price),0) AS g FROM bookings WHERE status='completed'`
  )).rows[0].g;

  res.json({
    commissionRate: k,
    summary: {
      totalTopups: round(Number(sum.topups)),
      lessonGrossRevenue: round(Number(grossAll)),
      platformCommission: round(Number(grossAll) * k),
      teacherShare: round(Number(grossAll) * (1 - k)),
    },
    topups: topups.rows.map((t) => ({ createdAt: t.created_at, studentName: t.user_name, amount: Number(t.amount) })),
    lessonPayments: lessonPays.rows.map((p) => ({
      date: p.completed_at,
      studentName: p.student_name,
      teacherName: p.teacher_name,
      amount: Number(p.price),
      commission: round(Number(p.price) * k),
      teacherShare: round(Number(p.price) * (1 - k)),
    })),
    payouts: payouts.rows.map((p) => ({
      id: p.id, teacherName: p.teacher_name, amount: Number(p.amount),
      status: p.status, requestedAt: p.requested_at, paidAt: p.paid_at,
    })),
  });
});

export const payPayout = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) throw new AppError('Payout tapılmadı.', 404);
  const upd = await query(
    `UPDATE payouts SET status='paid', paid_at=now(), processed_by=$2
     WHERE id=$1 AND status='requested' RETURNING id`,
    [req.params.id, req.user.id]
  );
  if (!upd.rows[0]) throw new AppError('Ödənilə bilən payout tapılmadı.', 404);
  res.json({ message: 'Payout ödənildi kimi işarələndi.' });
});

export const recentActivity = asyncHandler(async (req, res) => {
  const teachers = await query(
    `SELECT u.id, u.full_name, u.email, u.created_at, tp.status
     FROM users u JOIN teacher_profiles tp ON tp.user_id = u.id
     WHERE u.role='teacher' ORDER BY u.created_at DESC LIMIT 8`
  );
  const bookings = await query(
    `SELECT b.id, b.created_at, b.price, st.full_name AS student_name, te.full_name AS teacher_name
     FROM bookings b JOIN users st ON st.id=b.student_id JOIN users te ON te.id=b.teacher_id
     ORDER BY b.created_at DESC LIMIT 8`
  );
  const reviews = await query(
    `SELECT r.id, r.rating, r.comment, r.created_at, s.full_name AS student_name, t.full_name AS teacher_name
     FROM reviews r JOIN users s ON s.id=r.student_id JOIN users t ON t.id=r.teacher_id
     ORDER BY r.created_at DESC LIMIT 8`
  );
  res.json({
    teachers: teachers.rows.map((t) => ({ id: t.id, fullName: t.full_name, email: t.email, status: t.status, createdAt: t.created_at })),
    bookings: bookings.rows.map((b) => ({ id: b.id, studentName: b.student_name, teacherName: b.teacher_name, price: Number(b.price), createdAt: b.created_at })),
    reviews: reviews.rows.map((r) => ({ id: r.id, rating: r.rating, comment: r.comment, studentName: r.student_name, teacherName: r.teacher_name, createdAt: r.created_at })),
  });
});

export const listStudents = asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT u.id, u.full_name, u.email, u.region, u.balance, u.is_active, u.created_at,
            count(b.id) FILTER (WHERE b.status='completed')::int AS total_lessons,
            COALESCE(SUM(b.price) FILTER (WHERE b.status='completed'),0) AS total_spent
     FROM users u LEFT JOIN bookings b ON b.student_id = u.id
     WHERE u.role='student'
     GROUP BY u.id
     ORDER BY u.created_at DESC LIMIT 200`
  );
  res.json({
    students: r.rows.map((s) => ({
      id: s.id, fullName: s.full_name, email: s.email, region: s.region,
      balance: Number(s.balance), totalLessons: s.total_lessons, totalSpent: Number(s.total_spent),
      isActive: s.is_active, createdAt: s.created_at,
    })),
  });
});

export const setStudentActive = (active) =>
  asyncHandler(async (req, res) => {
    if (!isUuid(req.params.id)) throw new AppError('Tələbə tapılmadı.', 404);
    const upd = await query(
      `UPDATE users SET is_active=$1, updated_at=now() WHERE id=$2 AND role='student' RETURNING id`,
      [active, req.params.id]
    );
    if (!upd.rows[0]) throw new AppError('Tələbə tapılmadı.', 404);
    res.json({ message: active ? 'Tələbə hesabı aktivləşdirildi.' : 'Tələbə hesabı dayandırıldı.' });
  });

export const adminCancelLesson = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) throw new AppError('Dərs tapılmadı.', 404);
  const reason = isNonEmpty(req.body?.reason) ? req.body.reason.trim() : null;
  if (!reason) throw new AppError('Ləğv səbəbi tələb olunur.', 422);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`SELECT * FROM bookings WHERE id=$1 FOR UPDATE`, [req.params.id]);
    const b = r.rows[0];
    if (!b) throw new AppError('Dərs tapılmadı.', 404);
    if (b.status !== 'booked') throw new AppError('Yalnız aktiv dərs ləğv oluna bilər.', 409);
    await client.query(`UPDATE bookings SET status='cancelled', cancelled_at=now(), cancel_reason=$2 WHERE id=$1`, [b.id, reason]);
    await applyWalletTx(client, {
      userId: b.student_id, amount: Number(b.price), type: 'refund',
      description: 'Admin dərsi ləğv etdi — geri ödəmə', bookingId: b.id,
    });
    await client.query('COMMIT');
    res.json({ message: 'Dərs ləğv edildi, tələbəyə geri ödəmə edildi.' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
