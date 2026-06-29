import { pool, query } from '../db.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isUuid, isEmail, isNonEmpty } from '../utils/validate.js';
import { applyWalletTx } from '../utils/wallet.js';
import { sendBookingConfirmation } from '../utils/email.js';
import {
  paymentMode, paymentProvider, createTopupOrder, fetchTopupStatus, chargeCard,
  createDodoPayment, fetchDodoPaymentStatus,
} from '../utils/payment.js';
import { creditTopupPaid, markTopupFailed, notifyTopupPaid } from '../payment/topup.service.js';
import { MIN_TOPUP, STUDENT_JOIN_WINDOW_MIN, CANCEL_MIN_HOURS } from '../constants/config.js';
import { saveUpload } from '../utils/storage.js';

const bookingResponse = (r) => ({
  id: r.id,
  teacherId: r.teacher_id,
  teacherName: r.teacher_name,
  teacherPhotoUrl: r.teacher_photo_url || null,
  subject: r.subject || null,
  sessionType: r.session_type,
  price: Number(r.price),
  startsAt: r.starts_at,
  durationMin: r.duration_min,
  status: r.status,
  hasReview: r.has_review === true || r.has_review === 't',
  review: r.review_rating != null ? { rating: r.review_rating, comment: r.review_comment } : null,
  recordingUrl: r.recording_url,
});

export const getWallet = asyncHandler(async (req, res) => {
  const u = await query('SELECT balance FROM users WHERE id = $1', [req.user.id]);
  const tx = await query(
    `SELECT amount, type, description, balance_after, created_at
     FROM wallet_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [req.user.id]
  );
  res.json({
    balance: Number(u.rows[0].balance),
    transactions: tx.rows.map((t) => ({
      amount: Number(t.amount),
      type: t.type,
      description: t.description,
      balanceAfter: Number(t.balance_after),
      createdAt: t.created_at,
    })),
  });
});

export const topUp = asyncHandler(async (req, res) => {
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount < MIN_TOPUP) {
    throw new AppError(`Minimum balans artırma ${MIN_TOPUP} ₼-dir.`, 422);
  }
  const rounded = Math.round(amount * 100) / 100;

  const ins = await query(
    `INSERT INTO wallet_topups (user_id, amount, provider) VALUES ($1, $2, $3) RETURNING id`,
    [req.user.id, rounded, paymentProvider()]
  );
  const topupId = ins.rows[0].id;

  if (paymentMode() === 'instant') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE wallet_topups SET status='paid', paid_at=now() WHERE id=$1`, [topupId]);
      const balance = await applyWalletTx(client, {
        userId: req.user.id, amount: rounded, type: 'topup', description: 'Balans artırma (stub)',
      });
      await client.query('COMMIT');
      notifyTopupPaid(req.user.id, rounded, balance);
      return res.json({ mode: 'instant', balance, message: 'Balans artırıldı (stub).' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  if (paymentMode() === 'card') {
    const sourceId = req.body?.sourceId;
    if (!sourceId) throw new AppError('Kart token-i (sourceId) tələb olunur.', 422);
    const result = await chargeCard({
      amountCents: Math.round(rounded * 100),
      currency: process.env.SQUARE_CURRENCY || 'USD',
      sourceId,
      idempotencyKey: topupId,
    });
    if (!result.ok) {
      await query(`UPDATE wallet_topups SET status='failed' WHERE id=$1`, [topupId]);
      throw new AppError('Ödəniş alınmadı: ' + result.error, 402);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query(`SELECT status FROM wallet_topups WHERE id=$1 FOR UPDATE`, [topupId])).rows[0];
      if (row.status === 'pending') {
        await client.query(`UPDATE wallet_topups SET status='paid', paid_at=now(), provider_order_id=$2 WHERE id=$1`, [topupId, result.payment.id]);
        const balance = await applyWalletTx(client, {
          userId: req.user.id, amount: rounded, type: 'topup', description: 'Square ödənişi',
        });
        await client.query('COMMIT');
        notifyTopupPaid(req.user.id, rounded, balance);
        return res.json({ mode: 'charged', balance, message: 'Ödəniş uğurlu, balans artırıldı.' });
      }
      await client.query('COMMIT');
      const bal = (await query('SELECT balance FROM users WHERE id=$1', [req.user.id])).rows[0].balance;
      return res.json({ mode: 'charged', balance: Number(bal) });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  const backend = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 4000}`;
  const front = process.env.FRONTEND_URL && process.env.FRONTEND_URL !== '*' ? process.env.FRONTEND_URL : backend;

  if (paymentProvider() === 'dodo') {

    const returnUrl = `${front}/?topup=pending&id=${topupId}`;
    const me = (await query('SELECT email, full_name FROM users WHERE id=$1', [req.user.id])).rows[0];
    const dodo = await createDodoPayment({
      amountAzn: rounded,
      topupId,
      customer: { email: me?.email, name: me?.full_name },
      returnUrl,
    });
    await query(`UPDATE wallet_topups SET provider_order_id=$2 WHERE id=$1`, [topupId, dodo.providerOrderId]);
    return res.json({ mode: 'redirect', paymentUrl: dodo.paymentUrl, topupId });
  }

  const redirectUrl = `${backend}/api/payments/return/${topupId}`;
  const order = await createTopupOrder({ amount: rounded, description: `EduCan balans ${topupId}`, redirectUrl });
  await query(
    `UPDATE wallet_topups SET provider_order_id=$2, provider_password=$3 WHERE id=$1`,
    [topupId, order.providerOrderId, order.providerPassword]
  );
  res.json({ mode: 'redirect', paymentUrl: order.paymentUrl, topupId });
});

const settleTopup = async (topupId) => {
  if (!isUuid(topupId)) return 'notfound';
  const row0 = (await query('SELECT * FROM wallet_topups WHERE id=$1', [topupId])).rows[0];
  if (!row0) return 'notfound';
  if (row0.status !== 'pending') return row0.status;
  if (!row0.provider_order_id) return 'pending';

  if (row0.provider === 'dodo') {
    let st;
    try {
      st = await fetchDodoPaymentStatus(row0.provider_order_id);
    } catch {
      return 'pending';
    }
    if (st === 'paid') return (await creditTopupPaid(topupId, { description: 'Dodo ödənişi' })).status;
    if (st === 'failed') { await markTopupFailed(topupId); return 'failed'; }
    return 'pending';
  }

  let bankStatus;
  try {
    bankStatus = await fetchTopupStatus({
      providerOrderId: row0.provider_order_id,
      providerPassword: row0.provider_password,
    });
  } catch {
    return 'pending';
  }
  if (bankStatus === 'pending') return 'pending';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query('SELECT * FROM wallet_topups WHERE id=$1 FOR UPDATE', [topupId])).rows[0];
    if (row.status !== 'pending') {
      await client.query('COMMIT');
      return row.status;
    }
    if (bankStatus === 'paid') {
      await client.query(`UPDATE wallet_topups SET status='paid', paid_at=now() WHERE id=$1`, [topupId]);
      const balance = await applyWalletTx(client, {
        userId: row.user_id, amount: Number(row.amount), type: 'topup', description: 'Kapital ödənişi',
      });
      await client.query('COMMIT');
      notifyTopupPaid(row.user_id, Number(row.amount), balance);
      return 'paid';
    }
    await client.query(`UPDATE wallet_topups SET status='failed' WHERE id=$1`, [topupId]);
    await client.query('COMMIT');
    return 'failed';
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const topupReturn = asyncHandler(async (req, res) => {
  const result = await settleTopup(req.params.id);
  const front = process.env.FRONTEND_URL && process.env.FRONTEND_URL !== '*' ? process.env.FRONTEND_URL : '';
  res.redirect(`${front}/?topup=${result}`);
});

export const verifyTopup = asyncHandler(async (req, res) => {
  const own = await query('SELECT id FROM wallet_topups WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!own.rows[0]) throw new AppError('Topup tapılmadı.', 404);
  const status = await settleTopup(req.params.id);
  const bal = await query('SELECT balance FROM users WHERE id=$1', [req.user.id]);
  res.json({ status, balance: Number(bal.rows[0].balance) });
});

export const createBooking = asyncHandler(async (req, res) => {
  const { slotId } = req.body;
  if (!isUuid(slotId)) throw new AppError('Slot tapılmadı.', 404);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const slotRes = await client.query('SELECT * FROM slots WHERE id = $1 FOR UPDATE', [slotId]);
    const slot = slotRes.rows[0];
    if (!slot) throw new AppError('Slot tapılmadı.', 404);
    if (new Date(slot.starts_at).getTime() <= Date.now()) throw new AppError('Bu slotun vaxtı keçib.', 409);

    const cnt = await client.query(
      `SELECT count(*)::int AS c FROM bookings WHERE slot_id = $1 AND status = 'booked'`,
      [slotId]
    );
    if (cnt.rows[0].c >= slot.capacity) throw new AppError('Bu slot artıq doludur.', 409);

    const dup = await client.query(
      `SELECT 1 FROM bookings WHERE slot_id = $1 AND student_id = $2 AND status = 'booked'`,
      [slotId, req.user.id]
    );
    if (dup.rows[0]) throw new AppError('Bu slotu artıq rezerv etmisiniz.', 409);

    const usr = await client.query('SELECT balance FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
    if (Number(usr.rows[0].balance) < Number(slot.price)) {
      throw new AppError('Balansınız kifayət etmir. Əvvəlcə balans artırın.', 402);
    }

    const ins = await client.query(
      `INSERT INTO bookings
         (slot_id, student_id, teacher_id, session_type, price, starts_at, duration_min, subject)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [slotId, req.user.id, slot.teacher_id, slot.session_type, slot.price, slot.starts_at, slot.duration_min, slot.subject]
    );
    const booking = ins.rows[0];

    const balance = await applyWalletTx(client, {
      userId: req.user.id,
      amount: -Number(slot.price),
      type: 'lesson_payment',
      description: 'Dərs rezervi',
      bookingId: booking.id,
    });

    await client.query('COMMIT');

    sendBookingEmails(booking.id).catch((e) => console.error('[email] booking:', e.message));

    res.status(201).json({
      message: 'Dərs uğurla rezerv edildi.',
      bookingId: booking.id,
      balance,
      startsAt: booking.starts_at,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const listLessons = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const params = [req.user.id];
  let statusSql = '';
  if (status) {
    if (!['booked', 'completed', 'cancelled'].includes(status)) throw new AppError('Yanlış status.', 422);
    params.push(status);
    statusSql = `AND b.status = $2`;
  }
  const result = await query(
    `SELECT b.*, u.full_name AS teacher_name, tp.profile_photo_url AS teacher_photo_url,
            EXISTS(SELECT 1 FROM reviews r WHERE r.booking_id = b.id) AS has_review,
            (SELECT rating  FROM reviews r WHERE r.booking_id = b.id) AS review_rating,
            (SELECT comment FROM reviews r WHERE r.booking_id = b.id) AS review_comment
     FROM bookings b
     JOIN users u ON u.id = b.teacher_id
     LEFT JOIN teacher_profiles tp ON tp.user_id = b.teacher_id
     WHERE b.student_id = $1 ${statusSql}
     ORDER BY b.starts_at DESC`,
    params
  );
  res.json({ lessons: result.rows.map(bookingResponse) });
});

export const getLessonRoom = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) throw new AppError('Dərs tapılmadı.', 404);
  const result = await query(
    `SELECT b.*, u.full_name AS teacher_name, tp.profile_photo_url AS teacher_photo_url,
            s.zoom_join_url AS slot_join_url
     FROM bookings b JOIN users u ON u.id = b.teacher_id
     LEFT JOIN teacher_profiles tp ON tp.user_id = b.teacher_id
     LEFT JOIN slots s ON s.id = b.slot_id
     WHERE b.id = $1 AND b.student_id = $2`,
    [req.params.id, req.user.id]
  );
  const b = result.rows[0];
  if (!b) throw new AppError('Dərs tapılmadı.', 404);

  const start = new Date(b.starts_at).getTime();
  const now = Date.now();
  const opensAt = start - STUDENT_JOIN_WINDOW_MIN * 60 * 1000;
  const endsAt = start + b.duration_min * 60 * 1000;

  const meetingUrl = b.slot_join_url || b.zoom_url || null;
  const inWindow = b.status === 'booked' && now >= opensAt && now <= endsAt;
  const canJoin = inWindow && Boolean(meetingUrl);

  res.json({
    id: b.id,
    teacherName: b.teacher_name,
    teacherPhotoUrl: b.teacher_photo_url || null,
    subject: b.subject || null,
    sessionType: b.session_type,
    startsAt: b.starts_at,
    status: b.status,
    canJoin,
    zoomUrl: canJoin ? meetingUrl : null,
    recordingUrl: b.recording_url,
    message: canJoin
      ? null
      : b.status === 'completed'
      ? 'Dərs tamamlandı. Yazılış hazır olduqda görünəcək.'
      : inWindow && !meetingUrl
      ? 'Müəllim hələ meeting linkini əlavə etməyib.'
      : `Qoşulma düyməsi dərsdən ${STUDENT_JOIN_WINDOW_MIN} dəq əvvəl aktivləşir.`,
  });
});

export const cancelLesson = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) throw new AppError('Dərs tapılmadı.', 404);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT * FROM bookings WHERE id = $1 AND student_id = $2 FOR UPDATE`,
      [req.params.id, req.user.id]
    );
    const b = r.rows[0];
    if (!b) throw new AppError('Dərs tapılmadı.', 404);
    if (b.status !== 'booked') throw new AppError('Yalnız aktiv dərs ləğv oluna bilər.', 409);

    const hoursLeft = (new Date(b.starts_at).getTime() - Date.now()) / 3_600_000;
    if (hoursLeft < CANCEL_MIN_HOURS) {
      throw new AppError(`Ləğv ən azı ${CANCEL_MIN_HOURS} saat əvvəl edilməlidir.`, 409);
    }

    await client.query(`UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE id = $1`, [b.id]);
    const balance = await applyWalletTx(client, {
      userId: req.user.id,
      amount: Number(b.price),
      type: 'refund',
      description: 'Dərs ləğvi — geri ödəmə',
      bookingId: b.id,
    });
    await client.query('COMMIT');
    res.json({ message: 'Dərs ləğv edildi, məbləğ balansa qaytarıldı.', balance });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const createReview = asyncHandler(async (req, res) => {
  const { bookingId, rating, comment } = req.body;
  if (!isUuid(bookingId)) throw new AppError('Dərs tapılmadı.', 404);
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) throw new AppError('Reytinq 1–5 arası olmalıdır.', 422);
  if (comment != null && (typeof comment !== 'string' || comment.length > 500)) {
    throw new AppError('Rəy 500 simvoldan çox ola bilməz.', 422);
  }

  const bk = await query(
    `SELECT id, teacher_id, status FROM bookings WHERE id = $1 AND student_id = $2`,
    [bookingId, req.user.id]
  );
  const b = bk.rows[0];
  if (!b) throw new AppError('Dərs tapılmadı.', 404);
  if (b.status !== 'completed') throw new AppError('Yalnız tamamlanmış dərsə rəy yazıla bilər.', 409);

  try {
    await query(
      `INSERT INTO reviews (booking_id, student_id, teacher_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)`,
      [bookingId, req.user.id, b.teacher_id, r, comment?.trim() || null]
    );
  } catch (err) {
    if (err.code === '23505') throw new AppError('Bu dərsə artıq rəy yazmısınız.', 409);
    throw err;
  }
  res.status(201).json({ message: 'Rəyiniz üçün təşəkkür edirik!' });
});

const sendBookingEmails = async (bookingId) => {
  const r = await query(
    `SELECT b.starts_at, b.subject,
            s.full_name AS s_name, s.email AS s_email, s.notify_email AS s_notify,
            t.full_name AS t_name, t.email AS t_email, t.notify_email AS t_notify
     FROM bookings b
     JOIN users s ON s.id = b.student_id
     JOIN users t ON t.id = b.teacher_id
     WHERE b.id = $1`,
    [bookingId]
  );
  const x = r.rows[0];
  if (!x) return;
  await sendBookingConfirmation({
    studentEmail: x.s_notify ? x.s_email : null,
    teacherEmail: x.t_notify ? x.t_email : null,
    studentName: x.s_name,
    teacherName: x.t_name,
    startsAt: x.starts_at,
    subject: x.subject,
  });
};

export const getDashboard = asyncHandler(async (req, res) => {
  const sel = `b.*, u.full_name AS teacher_name, tp.profile_photo_url AS teacher_photo_url,
               EXISTS(SELECT 1 FROM reviews r WHERE r.booking_id=b.id) AS has_review`;
  const upcoming = await query(
    `SELECT ${sel} FROM bookings b JOIN users u ON u.id=b.teacher_id
     LEFT JOIN teacher_profiles tp ON tp.user_id=b.teacher_id
     WHERE b.student_id=$1 AND b.status='booked' AND b.starts_at>now()
     ORDER BY b.starts_at ASC LIMIT 2`,
    [req.user.id]
  );
  const recent = await query(
    `SELECT ${sel} FROM bookings b JOIN users u ON u.id=b.teacher_id
     LEFT JOIN teacher_profiles tp ON tp.user_id=b.teacher_id
     WHERE b.student_id=$1 AND b.status='completed'
     ORDER BY b.starts_at DESC LIMIT 3`,
    [req.user.id]
  );
  const stats = await query(
    `SELECT count(*)::int AS lessons, COALESCE(SUM(duration_min),0) AS minutes
     FROM bookings WHERE student_id=$1 AND status='completed'`,
    [req.user.id]
  );
  res.json({
    upcoming: upcoming.rows.map(bookingResponse),
    recent: recent.rows.map(bookingResponse),
    stats: {
      totalLessons: stats.rows[0].lessons,
      totalHours: Math.round((Number(stats.rows[0].minutes) / 60) * 10) / 10,
    },
  });
});

export const listRecordings = asyncHandler(async (req, res) => {
  const r = await query(
    `SELECT b.id, b.subject, b.starts_at, b.duration_min, b.recording_url,
            u.full_name AS teacher_name, tp.profile_photo_url AS teacher_photo_url
     FROM bookings b JOIN users u ON u.id=b.teacher_id
     LEFT JOIN teacher_profiles tp ON tp.user_id=b.teacher_id
     WHERE b.student_id=$1 AND b.status='completed' AND b.recording_url IS NOT NULL
     ORDER BY b.starts_at DESC`,
    [req.user.id]
  );
  res.json({
    recordings: r.rows.map((b) => ({
      id: b.id,
      teacherName: b.teacher_name,
      teacherPhotoUrl: b.teacher_photo_url || null,
      subject: b.subject || null,
      startsAt: b.starts_at,
      durationMin: b.duration_min,
      recordingUrl: b.recording_url,
    })),
  });
});

export const getAccount = asyncHandler(async (req, res) => {
  const r = await query('SELECT full_name, email, phone, region, photo_url, notify_email FROM users WHERE id=$1', [req.user.id]);
  const u = r.rows[0];
  res.json({ fullName: u.full_name, email: u.email, phone: u.phone, region: u.region, photoUrl: u.photo_url || null, notifyEmail: u.notify_email });
});

export const updateAccount = asyncHandler(async (req, res) => {
  const { fullName, email, phone, region, notifyEmail } = req.body || {};
  const fields = [];
  const vals = [];
  let i = 1;
  if (fullName != null) { if (!isNonEmpty(fullName)) throw new AppError('Ad boş ola bilməz.', 422); fields.push(`full_name=$${i++}`); vals.push(fullName.trim()); }
  if (email != null) { if (!isEmail(email)) throw new AppError('Email düzgün deyil.', 422); fields.push(`email=$${i++}`); vals.push(email.toLowerCase().trim()); }
  if (phone != null) { fields.push(`phone=$${i++}`); vals.push(phone || null); }
  if (region != null) { fields.push(`region=$${i++}`); vals.push(region || null); }
  if (notifyEmail != null) { fields.push(`notify_email=$${i++}`); vals.push(!!notifyEmail); }
  if (!fields.length) throw new AppError('Dəyişiklik yoxdur.', 422);
  vals.push(req.user.id);
  try {
    await query(`UPDATE users SET ${fields.join(', ')}, updated_at=now() WHERE id=$${i}`, vals);
  } catch (err) {
    if (err.code === '23505') throw new AppError('Bu email artıq istifadədədir.', 409);
    throw err;
  }
  res.json({ message: 'Məlumatlar yeniləndi.' });
});

export const deleteAccount = asyncHandler(async (req, res) => {
  await query('DELETE FROM users WHERE id=$1', [req.user.id]);
  res.json({ message: 'Hesab silindi.' });
});

export const uploadStudentPhoto = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('Şəkil faylı tələb olunur (sahə adı: photo).', 422);
  const url = await saveUpload({ buffer: req.file.buffer, filename: req.file.filename, contentType: req.file.mimetype });
  await query('UPDATE users SET photo_url=$1, updated_at=now() WHERE id=$2', [url, req.user.id]);
  res.json({ photoUrl: url, message: 'Şəkil yükləndi.' });
});
