// =====================================================================
//  «Капремонт МКД» → вкладка «Ответственные»: нагрузка и дисциплина (vPeople прежнего модуля).
//  Куратор и ответственный за ввод — на уровне адреса; ответственный по работам — на уровне позиции.
//  «Заполнение периода» — сколько позиций адресов сотрудника обновлено за выбранный период
//  из тех, которым нужно обновление (не оплачены и не исключены к прошлому периоду).
//  Сотрудники — из справочника МКД (перенесён из прежнего модуля); это не учётные записи приложения.
// =====================================================================

import { useMkdPeople } from '../../api/mkd.js';
import { Loading, ErrorBox } from '../../components/Status.jsx';
import { nf, pct100, periodLabel } from '../../utils/format.js';
import { ProgressBar } from './ui.jsx';
import MkdFilters, { useMkdFilters } from './MkdFilters.jsx';

const mlnN = (v) => nf((v || 0) / 1e6, 1);
const dash = (v) => (v ? v : '—');

export default function MkdPeople({ meta, period }) {
  const filterState = useMkdFilters();
  const pp = useMkdPeople(period, filterState.filters);
  const filterBar = <MkdFilters meta={meta} state={filterState} />;

  if (pp.isPending) return <>{filterBar}<Loading text="Считаем нагрузку…" /></>;
  if (pp.isError) return <>{filterBar}<ErrorBox error={pp.error} onRetry={pp.refetch} /></>;
  const { rows, period: p } = pp.data;

  return (
    <>
      {filterBar}
      <section className="card" aria-labelledby="pplH">
        <div className="sec-h"><h2 id="pplH">Нагрузка и дисциплина ответственных</h2></div>
        <p className="hint" style={{ marginTop: -6 }}>
          Куратор и ответственный за ввод — на уровне адреса; ответственный по работам — на уровне вида работ.
          Заполнение — доля позиций, обновлённых за период {periodLabel(p)}.
        </p>
        <div className="tbl-wrap flat">
          <table className="data">
            <thead>
              <tr>
                <th>ФИО</th><th className="hide-md">Роль</th>
                <th className="num">Курирует адресов</th><th className="num">Вводит по адресам</th>
                <th className="num">Позиций (ответств.)</th><th className="num hide-sm">В работе</th><th className="num hide-sm">Сумма в работе, млн</th>
                <th>Готовность по своим работам</th><th className="num">Критичных</th><th className="num">Просрочено</th><th>Заполнение периода</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={11} className="empty-row">Под фильтры никого нет</td></tr>}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.name}</td>
                  <td className="sub hide-md">{r.role ?? ''}</td>
                  <td className="num">{dash(r.nCur)}</td>
                  <td className="num">{dash(r.nEnt)}</td>
                  <td className="num">{dash(r.n)}</td>
                  <td className="num hide-sm">{dash(r.open)}</td>
                  <td className="num hide-sm">{r.n ? mlnN(r.inwork) : '—'}</td>
                  <td>{r.n ? <div className="prog"><ProgressBar pct={r.pct} plan={r.plan} /><span>{pct100(r.pct)} / {pct100(r.plan)}</span></div> : '—'}</td>
                  <td className="num">{r.crit ? <span className="bad-text">{r.crit}</span> : '—'}</td>
                  <td className="num">{r.over ? <span className="bad-text">{r.over}</span> : '—'}</td>
                  <td>
                    {r.need ? (
                      <div className="prog">
                        <ProgressBar pct={(r.upd / r.need) * 100} color={r.upd === r.need ? 'var(--good)' : 'var(--warn)'} />
                        <span>{r.upd} / {r.need}</span>
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
