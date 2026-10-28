// =====================================================================
//  Фильтры вкладок «Сводка» и «Матрица» раздела МКД (как в прежнем модуле):
//  раздел, группа работ, сотрудник (куратор, ответственный за ввод или за позицию), поиск.
//  Хранятся в адресе страницы (?sec=&grp=&person=&q=) — поэтому общие для вкладок,
//  и такой ссылкой можно поделиться.
// =====================================================================

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

const PARAM = { section: 'sec', group: 'grp', person: 'person', q: 'q' };

/** Текущие фильтры из адреса и функции, чтобы их менять. */
export function useMkdFilters() {
  const [params, setParams] = useSearchParams();
  const filters = Object.fromEntries(Object.entries(PARAM).map(([k, p]) => [k, params.get(p) || undefined]));
  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(PARAM[key], value); else next.delete(PARAM[key]);
    setParams(next, { replace: true });
  };
  const reset = () => {
    const next = new URLSearchParams(params);
    Object.values(PARAM).forEach((p) => next.delete(p));
    setParams(next, { replace: true });
  };
  return { filters, setFilter, reset, filtered: Object.values(filters).some(Boolean) };
}

/** Панель фильтров. meta — справочники раздела (useMkdMeta). */
export default function MkdFilters({ meta, state }) {
  const { filters, setFilter, reset, filtered } = state;
  const groups = [...new Set(meta.workTypes.map((t) => t.groupName || 'Прочее'))];

  // Поиск применяем с небольшой задержкой, чтобы не пересчитывать на каждую букву
  const [q, setQ] = useState(filters.q ?? '');
  useEffect(() => { setQ(filters.q ?? ''); }, [filters.q]);
  useEffect(() => {
    const t = setTimeout(() => { if ((filters.q ?? '') !== q.trim()) setFilter('q', q.trim()); }, 400);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="toolbar" aria-label="Фильтры">
      <select className="tb-select" value={filters.section ?? ''} onChange={(e) => setFilter('section', e.target.value)} aria-label="Раздел">
        <option value="">Все разделы</option>
        {meta.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <select className="tb-select" value={filters.group ?? ''} onChange={(e) => setFilter('group', e.target.value)} aria-label="Группа работ">
        <option value="">Все группы работ</option>
        {groups.map((g) => <option key={g} value={g}>{g}</option>)}
      </select>
      <select className="tb-select" value={filters.person ?? ''} onChange={(e) => setFilter('person', e.target.value)} aria-label="Сотрудник">
        <option value="">Все ответственные</option>
        {meta.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <input className="search" type="search" placeholder="Адрес или вид работ…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
      {filtered && <button type="button" className="btn" onClick={() => { setQ(''); reset(); }}>Сбросить</button>}
    </section>
  );
}
