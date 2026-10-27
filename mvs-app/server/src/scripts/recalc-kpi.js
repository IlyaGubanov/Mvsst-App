// =====================================================================
//  npm run recalc-kpi — пересчитать и сохранить снимки показателей (kpi_snapshots)
//  за ВСЕ отчётные точки: периоды МКД и Сетей, отчёты благоустройства, даты истории школ.
//  Нужен после переноса данных (чтобы сразу появилась история для графиков динамики)
//  и после изменения формул или порогов. Повторный запуск безопасен — снимки перезаписываются.
// =====================================================================

import { pool, query, explainDbError } from '../db.js';
import { getDirectionByCode } from '../services/access.js';
import { computeKpi, saveSnapshot } from '../services/kpi/index.js';
import { todayIso } from '../services/kpi/common.js';

// Отчётные точки каждого направления
const POINTS = {
  schools: () => query('SELECT DISTINCT report_date AS d FROM sch_work_progress ORDER BY d'),
  mkd: (dir) => query('SELECT period_start AS d FROM reporting_periods WHERE direction_id = ? ORDER BY d', [dir.id]),
  networks: (dir) => query('SELECT period_start AS d FROM reporting_periods WHERE direction_id = ? ORDER BY d', [dir.id]),
  streets: () => query("SELECT report_date AS d FROM st_reports WHERE program = 'kbu' ORDER BY d"),
};

async function main() {
  const today = todayIso();
  for (const code of Object.keys(POINTS)) {
    const direction = await getDirectionByCode(code);
    const dates = (await POINTS[code](direction)).map((r) => r.d);
    if (code === 'schools' && !dates.includes(today)) dates.push(today); // школы: ещё и «на сегодня»
    let saved = 0;
    for (const date of dates) {
      const kpi = await computeKpi(code, date);
      if (!kpi) continue;
      await saveSnapshot(direction, kpi, date);
      saved++;
    }
    console.log(`✔ ${direction.name}: снимков ${saved}`);
  }
}

main()
  .catch((err) => {
    console.error('\n✖ ' + explainDbError(err));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
