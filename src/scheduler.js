import { query } from './db.js';

const autoCompletePastLessons = async () => {
  const res = await query(
    `UPDATE bookings
     SET status = 'completed',
         completed_at = now()
     WHERE status = 'booked'
       AND starts_at + (duration_min || ' minutes')::interval < now()
     RETURNING id`
  );
  if (res.rowCount > 0) console.log(`[scheduler] ${res.rowCount} dərs avtomatik tamamlandı.`);
};

export const startScheduler = () => {

  setInterval(() => {
    autoCompletePastLessons().catch((e) => console.error('[scheduler] xəta:', e.message));
  }, 60 * 1000);
  console.log('[scheduler] işə düşdü (60s interval).');
};
