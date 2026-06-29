import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import authRoutes from './auth/auth.routes.js';
import catalogRoutes from './catalog/catalog.routes.js';
import teacherRoutes from './teacher/teacher.routes.js';
import studentRoutes from './student/student.routes.js';
import adminRoutes from './admin/admin.routes.js';
import paymentRoutes from './payment/payment.routes.js';
import { dodoWebhook } from './payment/dodo.webhook.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const createApp = () => {
  const app = express();

  app.set('trust proxy', 1);

  app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));

  app.post('/api/payments/dodo/webhook', express.raw({ type: '*/*' }), dodoWebhook);

  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', authRoutes);
  app.use('/api/teachers', catalogRoutes);
  app.use('/api/teacher', teacherRoutes);
  app.use('/api/student', studentRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/payments', paymentRoutes);

  app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

  app.use(express.static(join(__dirname, '..', 'public')));

  app.use(notFound);
  app.use(errorHandler);

  return app;
};
