import { Router } from 'express';
import { topupReturn } from '../student/student.controller.js';
import { publicPaymentConfig } from '../utils/payment.js';

const router = Router();

router.get('/config', (req, res) => res.json(publicPaymentConfig()));

router.get('/return/:id', topupReturn);

export default router;
