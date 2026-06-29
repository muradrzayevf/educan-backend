import crypto from 'node:crypto';
import { creditTopupPaid, markTopupFailed, isWebhookProcessed, markWebhookProcessed } from './topup.service.js';

const secretKeyBytes = () => {
  const s = process.env.DODO_WEBHOOK_SECRET || '';
  const b64 = s.startsWith('whsec_') ? s.slice('whsec_'.length) : s;

  try {
    const buf = Buffer.from(b64, 'base64');
    return buf.length ? buf : Buffer.from(s, 'utf8');
  } catch {
    return Buffer.from(s, 'utf8');
  }
};

const verify = ({ id, timestamp, signatureHeader, rawBody }) => {
  if (!id || !timestamp || !signatureHeader) return false;

  const ageSec = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSec) || ageSec > 300) return false;

  const signed = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secretKeyBytes()).update(signed).digest('base64');

  return signatureHeader.split(' ').some((part) => {
    const sig = part.includes(',') ? part.split(',')[1] : part;
    try {
      return sig && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    } catch {
      return false;
    }
  });
};

export const dodoWebhook = async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
  const id = req.get('webhook-id');
  const timestamp = req.get('webhook-timestamp');
  const signatureHeader = req.get('webhook-signature');

  if (!verify({ id, timestamp, signatureHeader, rawBody })) {
    return res.status(401).json({ error: 'İmza doğrulanmadı.' });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Gövdə JSON deyil.' });
  }

  if (await isWebhookProcessed(id)) return res.status(200).json({ received: true, duplicate: true });

  const type = event.type;
  const data = event.data || {};
  const topupId = data?.metadata?.topup_id || null;

  try {
    if (type === 'payment.succeeded' && topupId) {
      await creditTopupPaid(topupId, { description: 'Dodo ödənişi' });
    } else if ((type === 'payment.failed' || type === 'payment.cancelled') && topupId) {
      await markTopupFailed(topupId);
    }

    await markWebhookProcessed(id, 'dodo', type);
  } catch (err) {

    console.error('[dodo webhook]', err.message);
    return res.status(500).json({ error: 'Daxili emal xətası.' });
  }

  res.status(200).json({ received: true });
};
