// =====================================================================
//  /api/directions — направления, доступные вошедшему пользователю.
//
//    GET /api/directions                         → { directions: [{ code, name, canEdit, myObjects }] }
//    GET /api/directions/:direction/my-objects   → { all: true } для администратора
//                                                  или { all: false, objects: [{ id, code, name }] }
//
//  «Мои объекты» нужны экранам ввода: редактор видит в форме только свои объекты.
// =====================================================================

import { Router } from 'express';
import { query } from '../db.js';
import { useDirectionFromParam } from '../middleware/access.js';
import { describeAccess, editableObjectIds, OBJECT_SOURCES } from '../services/access.js';
import { validate } from '../middleware/validate.js';
import { computeKpi, saveSnapshot, kpiHistory } from '../services/kpi/index.js';
import { todayIso } from '../services/kpi/common.js';
import { dateQuery } from './overview.js';

const router = Router();

router.get('/', async (req, res) => {
  res.json({ directions: await describeAccess(req.user) });
});

// GET /api/directions/:direction/kpi[?date=] — показатели одного направления на дату
router.get('/:direction/kpi', useDirectionFromParam('direction'), validate(dateQuery, 'query'), async (req, res) => {
  const date = req.valid.query.date ?? todayIso();
  const kpi = await computeKpi(req.direction.code, date);
  await saveSnapshot(req.direction, kpi, date);
  res.json({ date, kpi });
});

// GET /api/directions/:direction/kpi/history — сохранённые снимки (для графика динамики)
router.get('/:direction/kpi/history', useDirectionFromParam('direction'), async (req, res) => {
  res.json({ history: await kpiHistory(req.direction.code) });
});

router.get('/:direction/my-objects', useDirectionFromParam('direction'), async (req, res) => {
  const ids = await editableObjectIds(req.user, req.direction);
  if (ids === 'all') return res.json({ all: true, objects: [] });
  if (ids.size === 0) return res.json({ all: false, objects: [] });

  const { table, nameColumn } = OBJECT_SOURCES[req.direction.code];
  // Имя таблицы и колонки — из нашего списка OBJECT_SOURCES, значения — через «?»
  const objects = await query(
    `SELECT id, code, ${nameColumn} AS name FROM ${table} WHERE id IN (?) AND archived = 0 ORDER BY ${nameColumn}`,
    [[...ids]],
  );
  res.json({ all: false, objects });
});

export default router;
