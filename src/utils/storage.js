import { randomBytes } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { AppError } from './AppError.js';

export const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const storageMode = () => process.env.STORAGE || 'local';

const r2Env = () => {
  const env = {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
    publicUrl: process.env.R2_PUBLIC_URL,
  };
  const missing = Object.entries(env)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new AppError(`STORAGE=r2 üçün bu env dəyişənləri tələb olunur: ${missing.join(', ')}`, 500);
  }
  return env;
};

let _client = null;
const getClient = async (env) => {
  if (_client) return _client;
  let S3Client;
  try {
    ({ S3Client } = await import('@aws-sdk/client-s3'));
  } catch {
    throw new AppError('R2 üçün @aws-sdk/client-s3 quraşdırılmayıb (npm install).', 500);
  }
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.accessKeyId, secretAccessKey: env.secretAccessKey },
  });
  return _client;
};

const publicUrl = (base, filename) => base.replace(/\/+$/, '') + '/' + filename;

export async function saveUpload({ buffer, path: tmpPath, filename, contentType }) {
  if (!filename) throw new AppError('Daxili xəta: fayl adı verilməyib.', 500);

  if (storageMode() === 'r2') {
    const env = r2Env();
    const client = await getClient(env);
    let Upload;
    try {
      ({ Upload } = await import('@aws-sdk/lib-storage'));
    } catch {
      throw new AppError('R2 üçün @aws-sdk/lib-storage quraşdırılmayıb (npm install).', 500);
    }
    const body = buffer ?? fs.createReadStream(tmpPath);
    const upload = new Upload({
      client,
      params: { Bucket: env.bucket, Key: filename, Body: body, ContentType: contentType },
    });
    await upload.done();
    if (tmpPath) await fs.promises.unlink(tmpPath).catch(() => {});
    return publicUrl(env.publicUrl, filename);
  }

  if (buffer) {
    await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), buffer);
  }
  return '/uploads/' + filename;
}
