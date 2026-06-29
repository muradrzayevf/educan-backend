import multer from 'multer';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { AppError } from '../utils/AppError.js';
import { UPLOAD_DIR } from '../utils/storage.js';

const genName = (originalname, prefix = '', extLen = 5) => {
  const ext = (path.extname(originalname || '') || '').toLowerCase().slice(0, extLen);
  return prefix + randomBytes(12).toString('hex') + ext;
};

const imageMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Yalnız JPG, PNG və ya WEBP qəbul olunur.')),
});

export const photoUpload = (req, res, next) =>
  imageMulter.single('photo')(req, res, (err) => {
    if (err) return next(new AppError(err.message || 'Yükləmə xətası.', 422));
    if (req.file) req.file.filename = genName(req.file.originalname);
    next();
  });

const recordingStore = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, genName(file.originalname, 'rec_', 6)),
});
const recordingMulter = multer({
  storage: recordingStore,
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    file.mimetype.startsWith('video/')
      ? cb(null, true)
      : cb(new Error('Yalnız video fayl qəbul olunur.')),
});

export const recordingUpload = (req, res, next) =>
  recordingMulter.single('recording')(req, res, (err) =>
    err ? next(new AppError(err.message || 'Yükləmə xətası.', 422)) : next()
  );
