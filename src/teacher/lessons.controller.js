import { pool, query } from '../db.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isUuid } from '../utils/validate.js';
import { applyWalletTx } from '../utils/wallet.js';
import { saveUpload } from '../utils/storage.js';
import { COMMISSION_RATE, MIN_PAYOUT, TEACHER_JOIN_WINDOW_MIN, CANCEL_MIN_HOURS } from '../constants/config.js';

const lessonResponse = (r) => ({
  id: r.id,
  studentName: r.student_name,
  subject: r.subject || null,
  sessionType: r.session_type,
  price: Number(r.price),
  yourShare: Math.round(Number(r.price) * (1 - COMMISSION_RATE) * 100) / 100,
  startsAt: r.starts_at,
  durationMin: r.duration_min,
  status: r.status,
  recordingUrl: r.recording_url,
});

export const listTeacherLessons = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const params = [req.user.id];
  let statusSql = '';
  if (status) {
    if (!['booked', 'completed', 'cancelled'].includes(status)) throw new AppError('Yanlış status.', 422);
    params.push(status);
    statusSql = 'AND b.status = $2';
  }
  const result = await query(
    `SELECT b.*, u.full_name AS student_name
     FROM bookings b JOIN users u ON u.id = b.student_id
     WHERE b.teacher_id = $1 ${statusSql}
     ORDER BY b.starts_at DESC`,
    params
  );
  res.json({ lessons: result.rows.map(lessonResponse) });
});

export const getTeacherLessonRoom = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) throw new AppError('Dərs tapılmadı.', 404);
  const r = await query(
    `SELECT b.*, u.full_name AS student_name,
            s.zoom_host_url AS slot_host_url, s.zoom_join_url AS slot_join_url
     FROM bookings b
     JOIN users u ON u.id = b.student_id
     LEFT JOIN slots s ON s.id = b.slot_id
     WHERE b.id = $1 AND b.teacher_id = $2`,
    [req.params.id, req.user.id]
  );
  const b = r.rows[0];
  if (!b) throw new AppError('Dərs tapılmadı.', 404);
  const start = new Date(b.starts_at).getTime();
  const opensAt = start - TEACHER_JOIN_WINDOW_MIN * 60 * 1000;
  const endsAt = start + b.duration_min * 60 * 1000;

  const hostUrl = b.slot_host_url || b.slot_join_url || b.host_url || b.zoom_url || null;
  const inWindow = b.status === 'booked' && Date.now() >= opensAt && Date.now() <= endsAt;
  const canStart = inWindow && Boolean(hostUrl);
  res.json({
    id: b.id,
    studentName: b.student_name,
    subject: b.subject || null,
    startsAt: b.starts_at,
    status: b.status,
    canStart,
    zoomUrl: canStart ? hostUrl : null,
    recordingUrl: b.recording_url,
    message: canStart ? null : inWindow && !hostUrl ? 'Bu slota hələ meeting bağlamamısınız.' : null,
  });
});

export const completeLesson = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) throw new AppError('Dərs tapılmadı.', 404);
  const upd = await query(
    `UPDATE bookings
     SET status = 'completed', completed_at = now()
     WHERE id = $1 AND teacher_id = $2 AND status = 'booked'
     RETURNING id`,
    [req.params.id, req.user.id]
  );
  if (!upd.rows[0]) throw new AppError('Tamamlana bilən dərs tapılmadı.', 404);
  res.json({ message: 'Dərs tamamlandı.' });
});

export const setLessonRecording = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) throw new AppError('Dərs tapılmadı.', 404);

  let url = null;
  if (req.file) {
    url = await saveUpload({ path: req.file.path, filename: req.file.filename, contentType: req.file.mimetype });
  } else if (req.body?.recordingUrl) {
    if (!/^https?:\/\//i.test(req.body.recordingUrl)) {
      throw new AppError('recordingUrl düzgün URL olmalıdır.', 422);
    }
    url = req.body.recordingUrl.trim();
  } else {
    throw new AppError('Video faylı və ya recordingUrl tələb olunur.', 422);
  }

  const b = (await query(
    `SELECT slot_id FROM bookings WHERE id = $1 AND teacher_id = $2`,
    [req.params.id, req.user.id]
  )).rows[0];
  if (!b) throw new AppError('Dərs tapılmadı.', 404);

  await query(
    `UPDATE bookings SET recording_url = $2
     WHERE slot_id = $1 AND status IN ('booked','completed')`,
    [b.slot_id, url]
  );
  res.json({ message: 'Yazılış əlavə edildi.', recordingUrl: url });
});

const earningsSummary = async (teacherId) => {
  const earned = await query(
    `SELECT COALESCE(SUM(price),0) AS gross, count(*)::int AS lessons
     FROM bookings WHERE teacher_id = $1 AND status = 'completed'`,
    [teacherId]
  );
  const monthly = await query(
    `SELECT
       COALESCE(SUM(price) FILTER (WHERE completed_at >= date_trunc('month', now())),0) AS this_month,
       COALESCE(SUM(price) FILTER (WHERE completed_at >= date_trunc('month', now()) - interval '1 month'
                                      AND completed_at <  date_trunc('month', now())),0) AS last_month
     FROM bookings WHERE teacher_id = $1 AND status = 'completed'`,
    [teacherId]
  );
  const reserved = await query(
    `SELECT COALESCE(SUM(amount),0) AS taken
     FROM payouts WHERE teacher_id = $1 AND status IN ('requested','paid')`,
    [teacherId]
  );
  const k = 1 - COMMISSION_RATE;
  const round = (n) => Math.round(n * 100) / 100;
  const gross = Number(earned.rows[0].gross);
  const share = round(gross * k);
  const taken = Number(reserved.rows[0].taken);
  return {
    lessons: earned.rows[0].lessons,
    gross,
    yourShare: share,
    thisMonth: round(Number(monthly.rows[0].this_month) * k),
    lastMonth: round(Number(monthly.rows[0].last_month) * k),
    alreadyTakenOrRequested: taken,
    available: round(share - taken),
  };
};

export const getEarnings = asyncHandler(async (req, res) => {
  const summary = await earningsSummary(req.user.id);
  const payouts = await query(
    `SELECT id, amount, status, requested_at, paid_at FROM payouts
     WHERE teacher_id = $1 ORDER BY requested_at DESC`,
    [req.user.id]
  );

  const lessonsRows = await query(
    `SELECT b.starts_at, b.session_type, b.price, b.subject, u.full_name AS student_name
     FROM bookings b JOIN users u ON u.id = b.student_id
     WHERE b.teacher_id = $1 AND b.status = 'completed'
     ORDER BY b.completed_at ASC`,
    [req.user.id]
  );
  const paidPool = (await query(
    `SELECT COALESCE(SUM(amount),0) AS paid FROM payouts WHERE teacher_id=$1 AND status='paid'`,
    [req.user.id]
  )).rows[0].paid;
  let remaining = Number(paidPool);
  const k = 1 - COMMISSION_RATE;
  const lessonEarnings = lessonsRows.rows.map((r) => {
    const share = Math.round(Number(r.price) * k * 100) / 100;
    let status = 'pending';
    if (remaining >= share) { status = 'paid'; remaining -= share; }
    return {
      startsAt: r.starts_at,
      studentName: r.student_name,
      subject: r.subject || null,
      sessionType: r.session_type,
      gross: Number(r.price),
      yourShare: share,
      status,
    };
  }).reverse();

  res.json({
    commissionRate: COMMISSION_RATE,
    ...summary,
    lessonEarnings,
    payouts: payouts.rows.map((p) => ({
      id: p.id,
      amount: Number(p.amount),
      status: p.status,
      requestedAt: p.requested_at,
      paidAt: p.paid_at,
    })),
  });
});

export const requestPayout = asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);

    const bank = await client.query(`SELECT bank_account FROM teacher_profiles WHERE user_id = $1`, [req.user.id]);
    if (!bank.rows[0] || !bank.rows[0].bank_account) {
      throw new AppError('Payout üçün əvvəlcə Tənzimləmələrdə bank hesabını doldurun.', 422);
    }
    const earned = await client.query(
      `SELECT COALESCE(SUM(price),0) AS gross FROM bookings
       WHERE teacher_id = $1 AND status = 'completed'`,
      [req.user.id]
    );
    const reserved = await client.query(
      `SELECT COALESCE(SUM(amount),0) AS taken FROM payouts
       WHERE teacher_id = $1 AND status IN ('requested','paid')`,
      [req.user.id]
    );
    const share = Number(earned.rows[0].gross) * (1 - COMMISSION_RATE);
    const available = Math.round((share - Number(reserved.rows[0].taken)) * 100) / 100;
    if (available < MIN_PAYOUT) {
      throw new AppError(`Payout üçün minimum ${MIN_PAYOUT} ₼ tələb olunur. Mövcud: ${available} ₼.`, 422);
    }
    const ins = await client.query(
      `INSERT INTO payouts (teacher_id, amount) VALUES ($1, $2) RETURNING id, amount, status`,
      [req.user.id, available]
    );
    await client.query('COMMIT');
    res.status(201).json({
      message: 'Payout sorğusu göndərildi. Admin təsdiqdən sonra ödəniləcək.',
      payout: { id: ins.rows[0].id, amount: Number(ins.rows[0].amount), status: ins.rows[0].status },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const cancelTeacherLesson = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) throw new AppError('Dərs tapılmadı.', 404);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(`SELECT * FROM bookings WHERE id=$1 AND teacher_id=$2 FOR UPDATE`, [req.params.id, req.user.id]);
    const b = r.rows[0];
    if (!b) throw new AppError('Dərs tapılmadı.', 404);
    if (b.status !== 'booked') throw new AppError('Yalnız aktiv dərs ləğv oluna bilər.', 409);
    const hoursLeft = (new Date(b.starts_at).getTime() - Date.now()) / 3_600_000;
    if (hoursLeft < CANCEL_MIN_HOURS) throw new AppError(`Ləğv ən azı ${CANCEL_MIN_HOURS} saat əvvəl edilməlidir.`, 409);

    await client.query(`UPDATE bookings SET status='cancelled', cancelled_at=now() WHERE id=$1`, [b.id]);

    await applyWalletTx(client, {
      userId: b.student_id, amount: Number(b.price), type: 'refund',
      description: 'Müəllim dərsi ləğv etdi — geri ödəmə', bookingId: b.id,
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

export const listTeacherRecordings = asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT b.id, b.subject, b.starts_at, b.duration_min, b.recording_url, u.full_name AS student_name
     FROM bookings b JOIN users u ON u.id=b.student_id
     WHERE b.teacher_id=$1 AND b.status='completed' AND b.recording_url IS NOT NULL
     ORDER BY b.starts_at DESC`,
    [req.user.id]
  );
  res.json({
    recordings: r.rows.map((b) => ({
      id: b.id, studentName: b.student_name, subject: b.subject || null,
      startsAt: b.starts_at, durationMin: b.duration_min, recordingUrl: b.recording_url,
    })),
  });
});

export const listMyStudents = asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT u.id, u.full_name,
            count(*) FILTER (WHERE b.status != 'cancelled')::int AS total_lessons,
            max(b.starts_at) AS last_lesson,
            (SELECT ROUND(AVG(rv.rating)::numeric,1) FROM reviews rv
             WHERE rv.teacher_id = $1 AND rv.student_id = u.id) AS avg_rating
     FROM bookings b JOIN users u ON u.id = b.student_id
     WHERE b.teacher_id = $1
     GROUP BY u.id, u.full_name
     ORDER BY last_lesson DESC`,
    [req.user.id]
  );
  res.json({
    students: r.rows.map((s) => ({
      id: s.id, fullName: s.full_name, totalLessons: s.total_lessons,
      lastLesson: s.last_lesson, avgRating: s.avg_rating != null ? Number(s.avg_rating) : null,
    })),
  });
});

export const studentLessonHistory = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) throw new AppError('Tələbə tapılmadı.', 404);
  const r = await query(
    `SELECT b.*, u.full_name AS student_name FROM bookings b JOIN users u ON u.id=b.student_id
     WHERE b.teacher_id=$1 AND b.student_id=$2 ORDER BY b.starts_at DESC`,
    [req.user.id, req.params.id]
  );
  res.json({ lessons: r.rows.map(lessonResponse) });
});

export const getTeacherDashboard = asyncHandler(async (req, res) => {
  const upcoming = await query(
    `SELECT b.*, u.full_name AS student_name FROM bookings b JOIN users u ON u.id=b.student_id
     WHERE b.teacher_id=$1 AND b.status='booked' AND b.starts_at>now()
     ORDER BY b.starts_at ASC LIMIT 2`,
    [req.user.id]
  );
  const reviews = await query(
    `SELECT r.rating, r.comment, r.created_at, u.full_name AS student_name
     FROM reviews r JOIN users u ON u.id=r.student_id
     WHERE r.teacher_id=$1 ORDER BY r.created_at DESC LIMIT 3`,
    [req.user.id]
  );
  const prof = (await query(
    `SELECT status, profile_photo_url, intro_video_url, bio FROM teacher_profiles WHERE user_id=$1`,
    [req.user.id]
  )).rows[0] || {};
  const missing = [];
  if (!prof.profile_photo_url) missing.push('şəkil');
  if (!prof.intro_video_url) missing.push('video');
  if (!prof.bio) missing.push('bio');
  const summary = await earningsSummary(req.user.id);

  res.json({
    upcoming: upcoming.rows.map(lessonResponse),
    earnings: { thisMonth: summary.thisMonth, lifetime: summary.yourShare, pending: summary.available },
    recentReviews: reviews.rows.map((r) => ({ rating: r.rating, comment: r.comment, studentName: r.student_name, createdAt: r.created_at })),
    profile: { status: prof.status || null, complete: missing.length === 0, missing },
  });
});
