import { query } from '../db.js';
import { AppError } from '../utils/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isUuid } from '../utils/validate.js';
import { DEFAULT_DURATION_MIN } from '../constants/config.js';

const slotResponse = (r) => ({
  id: r.id,
  startsAt: r.starts_at,
  durationMin: r.duration_min,
  sessionType: r.session_type,
  capacity: r.capacity,
  price: Number(r.price),
  subject: r.subject || null,
  booked: r.booked != null ? Number(r.booked) : 0,
  available: r.capacity - (r.booked != null ? Number(r.booked) : 0),

  joinUrl: r.zoom_join_url || null,
  hostUrl: r.zoom_host_url || null,
  hasMeeting: Boolean(r.zoom_join_url),
});

const normalizeMeeting = ({ joinUrl, hostUrl }) => {
  if (!joinUrl) return { zoom_join_url: null, zoom_host_url: null };
  if (!/^https?:\/\//i.test(joinUrl)) throw new AppError('joinUrl düzgün URL olmalıdır.', 422);
  if (hostUrl && !/^https?:\/\//i.test(hostUrl)) throw new AppError('hostUrl düzgün URL olmalıdır.', 422);
  return { zoom_join_url: joinUrl.trim(), zoom_host_url: hostUrl ? hostUrl.trim() : null };
};

export const listMySlots = asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT s.*,
            (SELECT count(*) FROM bookings b WHERE b.slot_id = s.id AND b.status = 'booked') AS booked
     FROM slots s
     WHERE s.teacher_id = $1
     ORDER BY s.starts_at ASC`,
    [req.user.id]
  );
  res.json({ slots: result.rows.map(slotResponse) });
});

export const createSlot = asyncHandler(async (req, res) => {
  const { startsAt, durationMin, sessionType = '1on1', capacity, subject, joinUrl, hostUrl } = req.body;

  const when = new Date(startsAt);
  if (isNaN(when.getTime())) throw new AppError('startsAt düzgün tarix/saat (ISO) olmalıdır.', 422);
  if (when.getTime() <= Date.now()) throw new AppError('Slot gələcəkdə olmalıdır.', 422);
  if (!['1on1', 'group'].includes(sessionType)) throw new AppError('sessionType "1on1" və ya "group" olmalıdır.', 422);

  const duration = durationMin != null ? Number(durationMin) : DEFAULT_DURATION_MIN;
  if (!Number.isInteger(duration) || duration < 15 || duration > 240) {
    throw new AppError('durationMin 15–240 dəqiqə aralığında olmalıdır.', 422);
  }

  const prof = await query(
    `SELECT session_1on1, session_group, group_capacity, price_1on1, price_group, subjects
     FROM teacher_profiles WHERE user_id = $1`,
    [req.user.id]
  );
  const p = prof.rows[0];
  if (!p) throw new AppError('Müəllim profili tapılmadı.', 404);
  if (sessionType === '1on1' && !p.session_1on1) throw new AppError('Profilinizdə 1-ə-1 sessiya aktiv deyil.', 422);
  if (sessionType === 'group' && !p.session_group) throw new AppError('Profilinizdə qrup sessiyası aktiv deyil.', 422);

  let subj = null;
  if (subject) {
    if (!(p.subjects || []).includes(subject)) throw new AppError('Fənn sizin profil fənləriniz arasında deyil.', 422);
    subj = subject;
  }

  const price = sessionType === '1on1' ? p.price_1on1 : p.price_group;
  let cap = 1;
  if (sessionType === 'group') {
    cap = capacity != null ? Number(capacity) : p.group_capacity || 6;
    if (!Number.isInteger(cap) || cap < 2 || cap > 50) throw new AppError('Qrup tutumu 2–50 olmalıdır.', 422);
  }

  try {
    const meeting = normalizeMeeting({ joinUrl, hostUrl });
    const result = await query(
      `INSERT INTO slots (teacher_id, starts_at, duration_min, session_type, capacity, price, subject,
                          zoom_join_url, zoom_host_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [req.user.id, when.toISOString(), duration, sessionType, cap, price, subj,
       meeting.zoom_join_url, meeting.zoom_host_url]
    );
    res.status(201).json({ slot: slotResponse({ ...result.rows[0], booked: 0 }) });
  } catch (err) {
    if (err.code === '23505') throw new AppError('Bu vaxtda artıq slotunuz var.', 409);
    throw err;
  }
});

export const setSlotMeeting = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) throw new AppError('Slot tapılmadı.', 404);
  const { joinUrl, hostUrl } = req.body || {};
  if (!joinUrl) throw new AppError('joinUrl tələb olunur.', 422);

  const slot = (await query('SELECT * FROM slots WHERE id = $1 AND teacher_id = $2', [req.params.id, req.user.id])).rows[0];
  if (!slot) throw new AppError('Slot tapılmadı.', 404);

  const meeting = normalizeMeeting({ joinUrl, hostUrl });
  const upd = await query(
    `UPDATE slots SET zoom_join_url=$2, zoom_host_url=$3 WHERE id=$1 RETURNING *`,
    [slot.id, meeting.zoom_join_url, meeting.zoom_host_url]
  );
  const booked = await query(
    `SELECT count(*)::int AS c FROM bookings WHERE slot_id=$1 AND status='booked'`, [slot.id]
  );
  res.json({ slot: slotResponse({ ...upd.rows[0], booked: booked.rows[0].c }) });
});

export const deleteSlot = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) throw new AppError('Slot tapılmadı.', 404);
  const booked = await query(
    `SELECT count(*)::int AS c FROM bookings WHERE slot_id = $1 AND status = 'booked'`,
    [req.params.id]
  );
  if (booked.rows[0].c > 0) throw new AppError('Rezerv edilmiş slotu silmək olmaz.', 409);

  const del = await query('DELETE FROM slots WHERE id = $1 AND teacher_id = $2 RETURNING id', [
    req.params.id,
    req.user.id,
  ]);
  if (!del.rows[0]) throw new AppError('Slot tapılmadı.', 404);
  res.json({ message: 'Slot silindi.' });
});

export const createSlotsBulk = asyncHandler(async (req, res) => {
  const { weekdays, time, sessionType = '1on1', durationMin, weeks = 4, subject } = req.body;

  if (!Array.isArray(weekdays) || weekdays.length === 0 || !weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
    throw new AppError('weekdays 0–6 arası tam ədədlər massivi olmalıdır (0=Bazar, 6=Şənbə).', 422);
  }
  if (!/^\d{2}:\d{2}$/.test(time || '')) throw new AppError('time "HH:MM" formatında olmalıdır.', 422);
  const [hh, mm] = time.split(':').map(Number);
  if (hh > 23 || mm > 59) throw new AppError('time yanlışdır.', 422);
  if (!['1on1', 'group'].includes(sessionType)) throw new AppError('sessionType "1on1" və ya "group" olmalıdır.', 422);
  const wk = Number(weeks);
  if (!Number.isInteger(wk) || wk < 1 || wk > 12) throw new AppError('weeks 1–12 aralığında olmalıdır.', 422);
  const duration = durationMin != null ? Number(durationMin) : DEFAULT_DURATION_MIN;
  if (!Number.isInteger(duration) || duration < 15 || duration > 240) throw new AppError('durationMin 15–240 olmalıdır.', 422);

  const prof = (
    await query(
      `SELECT session_1on1, session_group, group_capacity, price_1on1, price_group, subjects
       FROM teacher_profiles WHERE user_id = $1`,
      [req.user.id]
    )
  ).rows[0];
  if (!prof) throw new AppError('Müəllim profili tapılmadı.', 404);
  if (sessionType === '1on1' && !prof.session_1on1) throw new AppError('Profilinizdə 1-ə-1 sessiya aktiv deyil.', 422);
  if (sessionType === 'group' && !prof.session_group) throw new AppError('Profilinizdə qrup sessiyası aktiv deyil.', 422);
  let subj = null;
  if (subject) {
    if (!(prof.subjects || []).includes(subject)) throw new AppError('Fənn sizin profil fənləriniz arasında deyil.', 422);
    subj = subject;
  }
  const price = sessionType === '1on1' ? prof.price_1on1 : prof.price_group;
  const cap = sessionType === 'group' ? prof.group_capacity || 6 : 1;

  const now = new Date();
  const set = new Set();
  for (let w = 0; w < wk; w++) {
    for (const wd of weekdays) {
      const d = new Date(now);
      d.setDate(now.getDate() + w * 7);
      const diff = (wd - d.getDay() + 7) % 7;
      d.setDate(d.getDate() + diff);
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const da = String(d.getDate()).padStart(2, '0');
      const iso = `${y}-${mo}-${da}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+04:00`;
      const when = new Date(iso);
      if (when.getTime() > Date.now()) set.add(when.toISOString());
    }
  }

  let created = 0;
  for (const iso of set) {
    const r = await query(
      `INSERT INTO slots (teacher_id, starts_at, duration_min, session_type, capacity, price, subject)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (teacher_id, starts_at) DO NOTHING RETURNING id`,
      [req.user.id, iso, duration, sessionType, cap, price, subj]
    );
    if (r.rows[0]) created++;
  }
  res.status(201).json({ message: `${created} slot yaradıldı.`, created, attempted: set.size });
});
