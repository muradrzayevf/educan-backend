import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import {
  listTeachers,
  getTeacher,
  approveTeacher,
  rejectTeacher,
  suspendTeacher,
  reinstateTeacher,
  dashboard,
  listAllLessons,
  adminCancelLesson,
  listPayments,
  payPayout,
  recentActivity,
  listStudents,
  setStudentActive,
} from './admin.controller.js';

const router = Router();
router.use(authenticate, authorize('admin'));

router.get('/dashboard', dashboard);
router.get('/activity', recentActivity);

router.get('/students', listStudents);
router.post('/students/:id/ban', setStudentActive(false));
router.post('/students/:id/unban', setStudentActive(true));

router.get('/teachers', listTeachers);
router.get('/teachers/:id', getTeacher);
router.post('/teachers/:id/approve', approveTeacher);
router.post('/teachers/:id/reject', rejectTeacher);
router.post('/teachers/:id/suspend', suspendTeacher);
router.post('/teachers/:id/reinstate', reinstateTeacher);

router.get('/lessons', listAllLessons);
router.post('/lessons/:id/cancel', adminCancelLesson);
router.get('/payments', listPayments);
router.post('/payouts/:id/pay', payPayout);

export default router;
