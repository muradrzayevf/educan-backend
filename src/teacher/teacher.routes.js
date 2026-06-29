import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { photoUpload, recordingUpload } from '../middleware/upload.js';
import {
  getMyProfile, updateMyProfile, uploadPhoto,
  getAccount, updateAccount, deleteAccount,
} from './teacher.controller.js';
import { listMySlots, createSlot, createSlotsBulk, deleteSlot, setSlotMeeting } from '../schedule/schedule.controller.js';
import {
  listTeacherLessons, getTeacherLessonRoom, completeLesson, setLessonRecording, cancelTeacherLesson,
  getEarnings, requestPayout,
  listTeacherRecordings, listMyStudents, studentLessonHistory, getTeacherDashboard,
} from './lessons.controller.js';

const router = Router();
router.use(authenticate, authorize('teacher'));

router.get('/dashboard', getTeacherDashboard);

router.get('/profile', getMyProfile);
router.patch('/profile', updateMyProfile);
router.post('/profile/photo', photoUpload, uploadPhoto);

router.get('/slots', listMySlots);
router.post('/slots', createSlot);
router.post('/slots/bulk', createSlotsBulk);
router.patch('/slots/:id/meeting', setSlotMeeting);
router.delete('/slots/:id', deleteSlot);

router.get('/students', listMyStudents);
router.get('/students/:id/lessons', studentLessonHistory);

router.get('/lessons', listTeacherLessons);
router.get('/lessons/:id/room', getTeacherLessonRoom);
router.post('/lessons/:id/complete', completeLesson);
router.post('/lessons/:id/recording', recordingUpload, setLessonRecording);
router.post('/lessons/:id/cancel', cancelTeacherLesson);

router.get('/recordings', listTeacherRecordings);

router.get('/earnings', getEarnings);
router.post('/payouts', requestPayout);

router.get('/account', getAccount);
router.patch('/account', updateAccount);
router.delete('/account', deleteAccount);

export default router;
