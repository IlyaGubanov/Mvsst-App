// =====================================================================
//  GET /api/overview[?date=ГГГГ-ММ-ДД] — «Сводка»: показатели всех направлений,
//  доступных пользователю, со статусом (ok / warn / crit / na / empty).
//  Без даты — на сегодня. С датой — «срез на дату» (последняя отчётная точка не позже неё).
// =====================================================================

import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { getOverview } from '../services/kpi/index.js';
import { todayIso } from '../services/kpi/common.js';

const router = Router();

export const dateQuery = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД').optional(),
});

router.get('/', validate(dateQuery, 'query'), async (req, res) => {
  res.json(await getOverview(req.user, req.valid.query.date ?? todayIso()));
});

export default router;
