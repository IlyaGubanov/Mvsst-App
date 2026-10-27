// =====================================================================
//  Ввод за отчётный период по объектам «Сетей» — для ответственных по своим объектам.
//  Факт по линиям (накопительно), закрыто КС, рабочие и техника. Сохраняется полный снимок объекта.
// =====================================================================

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useNetMeta, useNetObject, useNetObjects, useSaveNetFacts } from '../../api/networks.js';
import { Loading, ErrorBox } from '../../components/Status.jsx';
import { periodOption, ProgressBar } from '../../components/Period.jsx';
import { fdate, numberToInput, parseNumber, pct, periodLabel, rub } from '../../utils/format.js';
import { NetStatus } from './ui.jsx';
import { fromForm, hasErrors, isChanged, previewFact, toForm, validate, warnings } from './netForm.js';

export default function NetInputPage() {
  const [params, setParams] = useSearchParams();
  const meta = useNetMeta();
  const registry = useNetObjects();
  const save = useSaveNetFacts();

  const m = meta.data;
  const periods = useMemo(() => {
    if (!m) return [];
    const open = m.periods.filter((p) => !p.isClosed);
    return m.currentPeriod.exists ? open : [{ ...m.currentPeriod, isNew: true }, ...open];
  }, [m]);
  const [period, setPeriod] = useState(null);
  const periodValue = period ?? periods[0]?.start;
  const periodInfo = periods.find((p) => p.start === periodValue);

  const myObjects = useMemo(
    () => (registry.data?.objects ?? []).filter((o) => o.canEdit).sort((a, b) => a.section.localeCompare(b.section, 'ru') || a.short.localeCompare(b.short, 'ru')),
    [registry.data],
  );
  const requested = Number(params.get('object'));
  const objectId = myObjects.some((o) => o.id === requested) ? requested : myObjects[0]?.id;
  const card = useNetObject(objectId, periodInfo && !periodInfo.isNew ? periodValue : undefined, { enabled: Boolean(objectId && periodInfo) });

  const lines = card.data?.lines ?? [];
  const object = card.data?.object;
  const original = useMemo(() => (object ? toForm(object, lines) : null), [object, lines]);
  const [draft, setDraft] = useState(null);
  const [message, setMessage] = useState(null);
  const form = draft ?? original;
  const errors = form ? validate(form, lines) : { lines: {} };
  const dirty = Boolean(draft && original && isChanged(draft, original, lines));
  const blocked = dirty && hasErrors(errors);

  useEffect(() => { setDraft(null); }, [objectId, periodValue]);
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  if (meta.isPending || registry.isPending) return <Loading />;
  if (meta.isError) return <ErrorBox error={meta.error} onRetry={meta.refetch} />;
  if (registry.isError) return <ErrorBox error={registry.error} onRetry={registry.refetch} />;

  const crumbs = (
    <nav className="crumbs" aria-label="Навигация"><Link to="/">Сводка</Link><span>/</span><Link to="/networks">Сети и водные объекты</Link><span>/</span><span>Ввод данных</span></nav>
  );
  if (!myObjects.length) {
    return (
      <div className="page sect net">{crumbs}
        <div className="error-box"><h2>Нет объектов для ввода</h2><p>Вы пока не назначены ответственным ни за один объект. Обратитесь к администратору.</p></div>
      </div>
    );
  }

  const confirmLeave = () => !dirty || window.confirm('Есть несохранённые изменения. Перейти без сохранения?');
  const chooseObject = (id) => { if (confirmLeave()) { setParams({ object: String(id) }, { replace: true }); setMessage(null); } };
  const choosePeriod = (v) => { if (confirmLeave()) { setPeriod(v); setMessage(null); } };
  const set = (field, value) => { setMessage(null); setDraft((d) => ({ ...(d ?? original), [field]: value })); };
  const setLine = (id, value) => { setMessage(null); setDraft((d) => { const base = d ?? original; return { ...base, lines: { ...base.lines, [id]: value } }; }); };

  async function onSave() {
    try {
      const r = await save.mutateAsync({ period: periodValue, objects: [{ objectId, ...fromForm(draft, lines) }] });
      setDraft(null);
      setMessage({ ok: true, text: `${r.message}. Показатели «Сводки» обновлены.` });
    } catch (err) {
      setMessage({ ok: false, text: err.details?.fields?.[0]?.message ?? err.message });
    }
  }

  const warns = dirty && form ? warnings(form, original, lines, object) : [];
  const preview = form ? previewFact(form, lines) : 0;
  const was = (field, text) => dirty && form[field] !== original[field] && <span className="was">было: {text}</span>;

  return (
    <div className="page sect net">
      {crumbs}
      <div className="head">
        <div>
          <h1>Ввод данных за период</h1>
          <p className="lead">Факт по линиям — накопительно, с начала работ. Закрыто КС — тоже накопительно. Рабочие и техника — на объекте в этот период.</p>
        </div>
        <label className="period-select">
          <span>Период</span>
          <select value={periodValue} onChange={(e) => choosePeriod(e.target.value)}>
            {periods.map((p) => <option key={p.start} value={p.start}>{periodOption(p)}{p.isNew ? ' · новый' : ''}</option>)}
          </select>
        </label>
      </div>
      {periodInfo?.isNew && <div className="notice">Период {periodLabel(periodInfo)} откроется при первом сохранении. Значения ниже — последние внесённые.</div>}

      <div className="input-layout">
        <nav className="addr-list" aria-label="Мои объекты">
          {myObjects.map((o) => (
            <button key={o.id} type="button" aria-current={o.id === objectId} onClick={() => chooseObject(o.id)}>
              <span>{o.short}{o.id === objectId && dirty && <span className="dirty"> •</span>}</span>
              <small>{o.section} · {pct(o.fact)} / план {pct(o.plan)}</small>
            </button>
          ))}
        </nav>
        <div className="addr-picker">
          <label className="f">
            <span>Объект</span>
            <select value={objectId} onChange={(e) => chooseObject(Number(e.target.value))}>
              {myObjects.map((o) => <option key={o.id} value={o.id}>{o.short} ({o.section})</option>)}
            </select>
          </label>
        </div>

        <section className="items" aria-label="Данные объекта">
          {card.isPending && <Loading text="Загружаем объект…" />}
          {card.isError && <ErrorBox error={card.error} onRetry={card.refetch} />}
          {object && form && (
            <>
              <div className="item-h">
                <div>
                  <b>{object.short}</b>
                  <div className="sub">{object.section} · {fdate(object.start)} – {fdate(object.end)} · договоры {rub(object.cost)}</div>
                </div>
                <Link className="sub" to={`/networks/${objectId}`}>Открыть карточку объекта →</Link>
              </div>

              <article className={'item' + (dirty ? ' changed' : '')}>
                <div className="item-h">
                  <b>Объёмы работ</b>
                  <span className="sub">
                    выполнение {dirty ? <>{pct(object.fact)} → <b>{pct(preview)}</b></> : pct(object.fact)} · план {pct(object.plan)} <NetStatus status={object.status} dev={object.dev} />
                  </span>
                </div>
                {lines.map((l) => {
                  const err = errors.lines[l.id];
                  const changedLine = dirty && form.lines[l.id] !== original.lines[l.id];
                  return (
                    <div key={l.id} className="line-row">
                      <div className="what">
                        <b>{l.label}</b>
                        <span>проект {numberToInput(l.plan)} {l.unit} · {[l.kind, l.diameter && `Ø${l.diameter}`].filter(Boolean).join(' · ')}</span>
                        <ProgressBar pct={Math.min(100, ((parseNumber(form.lines[l.id]) || 0) / (l.plan || 1)) * 100)} />
                      </div>
                      <div className="f">
                        <label htmlFor={`ln-${l.id}`}>Факт, {l.unit}</label>
                        <input id={`ln-${l.id}`} inputMode="decimal" value={form.lines[l.id]} onChange={(e) => setLine(l.id, e.target.value)} aria-invalid={err ? 'true' : undefined} />
                        {err ? <span className="err">{err}</span> : changedLine && <span className="was">было: {original.lines[l.id]} {l.unit}</span>}
                      </div>
                    </div>
                  );
                })}
              </article>

              <article className="item">
                <div className="item-h"><b>Деньги и ресурсы</b><span className="sub">последний ввод: {object.enteredBy ?? 'перенос из прежнего дашборда'}</span></div>
                <div className="fields res">
                  <div className="f">
                    <label htmlFor="ks">Закрыто КС (накопительно), ₽</label>
                    <input id="ks" inputMode="decimal" value={form.ks} onChange={(e) => set('ks', e.target.value)} aria-invalid={errors.ks ? 'true' : undefined} />
                    {errors.ks ? <span className="err">{errors.ks}</span> : was('ks', original.ks || '0')}
                  </div>
                  <div className="f">
                    <label htmlFor="wk">Рабочих, чел.</label>
                    <input id="wk" inputMode="numeric" value={form.workers} onChange={(e) => set('workers', e.target.value)} aria-invalid={errors.workers ? 'true' : undefined} />
                    {errors.workers ? <span className="err">{errors.workers}</span> : was('workers', original.workers)}
                  </div>
                  <div className="f">
                    <label htmlFor="mc">Техники, ед.</label>
                    <input id="mc" inputMode="numeric" value={form.machines} onChange={(e) => set('machines', e.target.value)} aria-invalid={errors.machines ? 'true' : undefined} />
                    {errors.machines ? <span className="err">{errors.machines}</span> : was('machines', original.machines)}
                  </div>
                </div>
              </article>
              {warns.length > 0 && <ul className="warns">{warns.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
            </>
          )}
        </section>
      </div>

      <div className="savebar" role="region" aria-label="Сохранение">
        <span className={'msg' + (message ? (message.ok ? ' ok' : ' err') : '')} role="status">
          {message ? message.text : dirty ? `Есть изменения${blocked ? ' · исправьте ошибки' : ''}` : 'Изменений нет'}
        </span>
        <div className="btns">
          <button type="button" className="btn" disabled={!dirty || save.isPending} onClick={() => { setDraft(null); setMessage(null); }}>Отменить</button>
          <button type="button" className="btn primary" disabled={!dirty || blocked || save.isPending} onClick={onSave}>{save.isPending ? 'Сохраняем…' : 'Сохранить'}</button>
        </div>
      </div>
    </div>
  );
}
