
import 'dotenv/config';
import { createApp } from './src/app.js';
import { startScheduler } from './src/scheduler.js';

for (const key of ['DATABASE_URL', 'JWT_SECRET']) {
  if (!process.env[key]) {
    console.error(`Xəta: ${key} .env faylında təyin edilməyib.`);
    process.exit(1);
  }
}

const PORT = process.env.PORT || 4000;
const app = createApp();

app.listen(PORT, () => {
  console.log(`EduCan backend ${PORT} portunda işləyir`);
  console.log(`Test konsolu: http://localhost:${PORT}/`);
  startScheduler();
});
