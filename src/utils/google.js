import crypto from 'node:crypto';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const VALID_ISS = ['accounts.google.com', 'https://accounts.google.com'];

export const googleConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID);

let _jwks = { keys: [], exp: 0 };
const getKeys = async () => {
  if (_jwks.keys.length && Date.now() < _jwks.exp) return _jwks.keys;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error('Google açarları alınmadı.');
  const data = await res.json();

  const cc = res.headers.get('cache-control') || '';
  const m = cc.match(/max-age=(\d+)/);
  const ttl = (m ? Number(m[1]) : 3600) * 1000;
  _jwks = { keys: data.keys || [], exp: Date.now() + ttl };
  return _jwks.keys;
};

const b64urlToBuf = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const b64urlToJson = (s) => JSON.parse(b64urlToBuf(s).toString('utf8'));

export const verifyGoogleIdToken = async (credential) => {
  if (!googleConfigured()) throw new Error('Google girişi konfiqurasiya olunmayıb.');
  if (typeof credential !== 'string' || credential.split('.').length !== 3) {
    throw new Error('Etibarsız Google token.');
  }
  const [headerB64, payloadB64, sigB64] = credential.split('.');
  const header = b64urlToJson(headerB64);
  if (header.alg !== 'RS256') throw new Error('Gözlənilməyən imza alqoritmi.');

  const keys = await getKeys();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Uyğun Google açarı tapılmadı.');

  const pubKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const signedData = `${headerB64}.${payloadB64}`;
  const ok = crypto.verify('RSA-SHA256', Buffer.from(signedData), pubKey, b64urlToBuf(sigB64));
  if (!ok) throw new Error('Google imzası doğrulanmadı.');

  const p = b64urlToJson(payloadB64);
  if (!VALID_ISS.includes(p.iss)) throw new Error('Etibarsız token mənbəyi (iss).');
  if (p.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error('Token bu tətbiq üçün deyil (aud).');
  if (!p.exp || Date.now() / 1000 > p.exp) throw new Error('Token vaxtı bitib.');
  if (!p.email) throw new Error('Token-də email yoxdur.');

  if (!(p.email_verified === true || p.email_verified === 'true')) {
    throw new Error('Google email təsdiqlənməyib.');
  }

  return {
    sub: p.sub,
    email: String(p.email).trim().toLowerCase(),
    emailVerified: true,
    name: p.name || p.email,
    picture: p.picture || null,
  };
};
