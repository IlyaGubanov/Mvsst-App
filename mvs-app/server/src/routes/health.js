// =====================================================================
//  GET /api/health — «жив ли сервер и доступна ли база».
//  Удобно открыть в браузере после развёртывания и для систем мониторинга.
//  Вход не нужен, никаких данных не раскрывает.
// =====================================================================

import { Router } from 'express';
import { checkConnection } from '../db.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    await checkConnection();
    res.json({ ok: true, db: true, time: new Date().toISOString() });
  } catch {
    // 503 = «сервис временно недоступен»
    res.status(503).json({ ok: false, db: false, error: 'База данных недоступна' });
  }
});

export default router;
