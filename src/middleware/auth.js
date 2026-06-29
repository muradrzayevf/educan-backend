import { verifyToken } from '../utils/jwt.js';
import { AppError } from '../utils/AppError.js';

export const authenticate = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new AppError('Avtorizasiya tələb olunur.', 401));
  }
  const token = header.slice(7);
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.id, role: payload.role };
    next();
  } catch {
    return next(new AppError('Sessiya etibarsız və ya vaxtı bitib.', 401));
  }
};

export const authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return next(new AppError('Bu əməliyyat üçün icazəniz yoxdur.', 403));
  }
  next();
};
