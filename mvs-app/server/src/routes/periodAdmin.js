// =====================================================================
//  Закрыть / открыть отчётный период — общие маршруты для МКД и Сетей (только администратор):
//    POST /api/<направление>/periods/:start/close
//    POST /api/<направление>/periods/:start/reopen
//  Направление берётся из req.direction (его ставит useDirection в app.js).
// =====================================================================

import { z } from 'zod';
import { notFound } from '../errors.js';
import { validate } from '../middleware/validate.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { getPeriod, setPeriodClosed } from '../services/periods.js';

export const startParams = z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Период — дата ГГГГ-ММ-ДД') });

export function addPeriodAdminRoutes(router) {
  for (const [action, closed] of [['close', true], ['reopen', false]]) {
    router.post(`/periods/:start/${action}`, requireRole('admin'), validate(startParams, 'params'), async (req, res) => {
      const { start } = req.valid.params;
      if (!(await setPeriodClosed(req.direction, start, closed, req.user))) throw notFound(`Отчётного периода с ${start} нет`);
      await audit(undefined, {
        req, directionId: req.direction.id, entity: 'reporting_period', entityId: start,
        action: 'update', summary: `${closed ? 'Закрыт' : 'Открыт'} отчётный период с ${start}`,
      });
      res.json({ period: await getPeriod(req.direction, start) });
    });
  }
}
