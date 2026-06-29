const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isEmail = (v) => typeof v === 'string' && EMAIL_RE.test(v.trim());

export const isNonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

export const isStrongPassword = (v) => typeof v === 'string' && v.length >= 8;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
