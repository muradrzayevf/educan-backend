

const provider = process.env.PAYMENT_PROVIDER || 'stub';
export const paymentProvider = () => provider;

const AZN_PER_USD = Number(process.env.AZN_PER_USD || 1.7);
export const isRealGateway = () => provider === 'kapital' || provider === 'dodo';

export const paymentMode = () =>
  provider === 'square' ? 'card' : provider === 'kapital' || provider === 'dodo' ? 'redirect' : 'instant';

export const publicPaymentConfig = () => {
  if (provider === 'square')
    return {
      provider: 'square',
      square: {
        appId: process.env.SQUARE_APP_ID || '',
        locationId: process.env.SQUARE_LOCATION_ID || '',
        env: process.env.SQUARE_ENV || 'sandbox',
      },
    };
  if (provider === 'kapital') return { provider: 'kapital' };
  if (provider === 'dodo') return { provider: 'dodo' };
  return { provider: 'stub' };
};

const SQUARE_BASE = () =>
  process.env.SQUARE_ENV === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';

export const chargeCard = async ({ amountCents, currency = 'USD', sourceId, idempotencyKey }) => {
  const res = await fetch(SQUARE_BASE() + '/v2/payments', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + (process.env.SQUARE_ACCESS_TOKEN || ''),
      'Content-Type': 'application/json',
      'Square-Version': process.env.SQUARE_VERSION || '2025-01-23',
    },
    body: JSON.stringify({
      source_id: sourceId,
      idempotency_key: idempotencyKey,
      amount_money: { amount: amountCents, currency },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.payment && data.payment.status === 'COMPLETED') return { ok: true, payment: data.payment };
  const err = (data.errors && data.errors[0] && (data.errors[0].detail || data.errors[0].code)) || 'HTTP ' + res.status;
  return { ok: false, error: err };
};

let _gw = null;
let _OrderStatus = null;
const gateway = async () => {
  if (_gw) return _gw;
  const mod = await import('@twelver313/kapital-bank');
  _OrderStatus = mod.OrderStatus;
  _gw = new mod.PaymentGateway({
    login: process.env.KAPITAL_LOGIN,
    password: process.env.KAPITAL_PASSWORD,
    isDev: process.env.KAPITAL_IS_DEV !== 'false',
  });
  return _gw;
};

export const createTopupOrder = async ({ amount, description, redirectUrl }) => {
  const gw = await gateway();
  const order = await gw.createPurchaseOrder({
    amount: Number(amount),
    currency: 'AZN',
    description,
    redirectUrl,
    language: 'az',
  });
  return {
    providerOrderId: String(order.id),
    providerPassword: order.password,
    paymentUrl: order.url,
  };
};

export const fetchTopupStatus = async ({ providerOrderId, providerPassword }) => {
  const gw = await gateway();
  const st = await gw.getOrderStatus({ id: providerOrderId, password: providerPassword });
  if (typeof st.isFullyPaid === 'function' ? st.isFullyPaid() : st.status === _OrderStatus.FULLY_PAID) return 'paid';
  const terminal = [_OrderStatus.DECLINED, _OrderStatus.CANCELED, _OrderStatus.EXPIRED];
  if (typeof st.isOneOf === 'function' ? st.isOneOf(terminal) : terminal.includes(st.status)) return 'failed';
  return 'pending';
};

const DODO_BASE = () =>
  process.env.DODO_ENV === 'live' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com';

export const createDodoPayment = async ({ amountAzn, topupId, customer, returnUrl }) => {
  const cartItem = { product_id: process.env.DODO_PRODUCT_ID, quantity: 1 };
  if (process.env.DODO_PWYW === 'true' && amountAzn != null) {
    cartItem.amount = Math.round((amountAzn / AZN_PER_USD) * 100);
  }

  const res = await fetch(DODO_BASE() + '/payments', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + (process.env.DODO_API_KEY || ''),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      payment_link: true,
      product_cart: [cartItem],
      customer: { email: customer?.email || 'test@example.com', name: customer?.name || 'EduCan istifadəçi' },

      billing: { city: 'Baku', country: 'AZ', state: 'Baku', street: 'N/A', zipcode: '1000' },
      return_url: returnUrl,
      metadata: { topup_id: String(topupId) },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !(data.payment_link || data.checkout_url)) {
    const msg = data.message || (data.errors && JSON.stringify(data.errors)) || 'HTTP ' + res.status;
    throw new Error('Dodo ödəniş yaradıla bilmədi: ' + msg);
  }
  return { providerOrderId: data.payment_id || data.id || null, paymentUrl: data.payment_link || data.checkout_url };
};

export const fetchDodoPaymentStatus = async (paymentId) => {
  if (!paymentId) return 'pending';
  const res = await fetch(DODO_BASE() + '/payments/' + encodeURIComponent(paymentId), {
    headers: { Authorization: 'Bearer ' + (process.env.DODO_API_KEY || '') },
  });
  if (!res.ok) return 'pending';
  const data = await res.json().catch(() => ({}));
  const s = (data.status || '').toLowerCase();
  if (s === 'succeeded') return 'paid';
  if (['failed', 'cancelled', 'canceled', 'expired'].includes(s)) return 'failed';
  return 'pending';
};
