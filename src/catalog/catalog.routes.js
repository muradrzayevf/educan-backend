import { Router } from 'express';
import {
  listTeachers,
  getTeacher,
  listTeacherSlots,
  listTeacherReviews,
} from './catalog.controller.js';

const router = Router();

router.get('/', listTeachers);
router.get('/:id', getTeacher);
router.get('/:id/slots', listTeacherSlots);
router.get('/:id/reviews', listTeacherReviews);

export default router;
