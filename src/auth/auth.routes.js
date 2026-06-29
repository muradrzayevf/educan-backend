import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  registerStudent,
  registerTeacher,
  login,
  me,
  verifyOtp,
  resendOtp,
  googleAuth,
  authConfig,
  forgotPassword,
  resetPassword,
  changePassword,
  logout,
} from './auth.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çox sayda cəhd. Bir az sonra yenidən yoxlayın.' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çox sayda qeydiyyat cəhdi. Bir az sonra yenidən yoxlayın.' },
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çox sayda kod cəhdi. Bir az sonra yenidən yoxlayın.' },
});

router.get('/config', authConfig);
router.post('/register/student', registerLimiter, registerStudent);
router.post('/register/teacher', registerLimiter, registerTeacher);
router.post('/verify-otp', otpLimiter, verifyOtp);
router.post('/resend-otp', otpLimiter, resendOtp);
router.post('/google', loginLimiter, googleAuth);
router.post('/login', loginLimiter, login);
router.get('/me', authenticate, me);
router.post('/forgot-password', loginLimiter, forgotPassword);
router.post('/reset-password', loginLimiter, resetPassword);
router.post('/change-password', authenticate, changePassword);
router.post('/logout', authenticate, logout);

export default router;
