import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { photoUpload } from '../middleware/upload.js';
import {
  getWallet,
  topUp,
  verifyTopup,
  createBooking,
  listLessons,
  getLessonRoom,
  cancelLesson,
  createReview,
  getDashboard,
  listRecordings,
  getAccount,
  updateAccount,
  deleteAccount,
  uploadStudentPhoto,
} from './student.controller.js';

const router = Router();
router.use(authenticate, authorize('student'));

router.get('/dashboard', getDashboard);

router.get('/wallet', getWallet);
router.post('/wallet/topup', topUp);
router.post('/wallet/topup/:id/verify', verifyTopup);

router.post('/bookings', createBooking);
router.get('/lessons', listLessons);
router.get('/lessons/:id', getLessonRoom);
router.post('/lessons/:id/cancel', cancelLesson);
router.get('/recordings', listRecordings);
router.post('/reviews', createReview);

router.get('/account', getAccount);
router.patch('/account', updateAccount);
router.post('/account/photo', photoUpload, uploadStudentPhoto);
router.delete('/account', deleteAccount);

export default router;
