import { pool, query } from '../db.js';
import { applyWalletTx } from '../utils/wallet.js';
import { sendTopupSuccessEmail } from '../utils/email.js';

export const notifyTopupPaid = async (userId, amount, balance) => {
  try {
    const u = (await query('SELECT email, full_name FROM users WHERE id = $1', [userId])).rows[0];
    if (u?.email) await sendTopupSuccessEmail(u.email, { amount, balance, name: u.full_name });
  } catch (e) {
    console.error('[topup mail] göndərilmədi:', e.message);
  }
};

export const isWebhookProcessed = async (id) => {
  if (!id) return false;
  const r = await query('SELECT 1 FROM processed_webhooks WHERE id = $1', [id]);
  return Boolean(r.rows[0]);
};

export const markWebhookProcessed = async (id, source, eventType) => {
  if (!id) return;
  await query(
    `INSERT INTO processed_webhooks (id, source, event_type) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [id, source, eventType || null]
  );
};

export const creditTopupPaid = async (topupId, { description = 'Dodo ödənişi' } = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query('SELECT * FROM wallet_topups WHERE id = $1 FOR UPDATE', [topupId])).rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { credited: false, status: 'notfound', balance: null };
    }
    if (row.status !== 'pending') {
      await client.query('COMMIT');
      const bal = (await query('SELECT balance FROM users WHERE id = $1', [row.user_id])).rows[0]?.balance;
      return { credited: false, status: row.status, balance: bal != null ? Number(bal) : null };
    }
    await client.query(`UPDATE wallet_topups SET status='paid', paid_at=now() WHERE id=$1`, [topupId]);
    const balance = await applyWalletTx(client, {
      userId: row.user_id,
      amount: Number(row.amount),
      type: 'topup',
      description,
    });
    await client.query('COMMIT');
    notifyTopupPaid(row.user_id, Number(row.amount), balance);
    return { credited: true, status: 'paid', balance };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

export const markTopupFailed = async (topupId) => {
  await query(`UPDATE wallet_topups SET status='failed' WHERE id=$1 AND status='pending'`, [topupId]);
};
