

export const applyWalletTx = async (client, { userId, amount, type, description = null, bookingId = null }) => {
  const upd = await client.query(
    `UPDATE users SET balance = balance + $1, updated_at = now() WHERE id = $2 RETURNING balance`,
    [amount, userId]
  );
  if (!upd.rows[0]) throw new Error('İstifadəçi tapılmadı (wallet).');
  const balanceAfter = upd.rows[0].balance;
  await client.query(
    `INSERT INTO wallet_transactions (user_id, amount, type, description, balance_after, booking_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, amount, type, description, balanceAfter, bookingId]
  );
  return Number(balanceAfter);
};
