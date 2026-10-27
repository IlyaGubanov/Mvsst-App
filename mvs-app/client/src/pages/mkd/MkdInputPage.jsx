// =====================================================================
//  Ввод статусов позиций МКД за отчётный период — для ответственных по своим адресам.
//
//  • Слева — мои адреса (на телефоне — выпадающий список), справа — позиции выбранного адреса.
//  • Изменённые позиции подсвечиваются; на сервер уходят только они.
//  • Ошибки (как на сервере) не дают сохранить; предупреждения — подсказки.
//  • Уходя со страницы с несохранёнными изменениями, браузер переспросит.
// =====================================================================

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMkdMeta, useMkdObject, useMkdObjects, useSaveMkdStatus } from '../../api/mkd.js';
import { Loading, ErrorBox } from '../../components/Status.jsx';
import { fdate, periodLabel, pct100, rub } from '../../utils/format.js';
import { STATUS, STATUS_ORDER, periodOption } from './ui.jsx';
import { fixedPct, fromForm, isChanged, toForm, validate, warnings } from './itemForm.js';

export default function MkdInputPage() {
  const [params, setParams] = useSearchParams();
  const meta = useMkdMeta();
  const registry = useMkdObjects();
  const save = useSaveMkdStatus();

  // ---------- период: открытые периоды + текущий (если его ещё нет — создастся при сохранении)
  const m = meta.data;
  const periods = useMemo(() => {
    if (!m) return [];
    const open = m.periods.filter((p) => !p.isClosed);
    return m.currentPeriod.exists ? open : [{ ...m.currentPeriod, isNew: true }, ...open];
  }, [m]);
  const [period, setPeriod] = useState(null);
  const periodValue = period ?? periods[0]?.start;
  const periodInfo = periods.find((p) => p.start === periodValue);

  // ---------- адреса, которые я могу править
  const myObjects = useMemo(
    () => (registry.data?.objects ?? []).filter((o) => o.canEdit).sort((a, b) => a.address.localeCompare(b.address, 'ru')),
    [registry.data],
  );
  // Адрес из ссылки (?object=…) — только если он мой; иначе первый из моих
  const requested = Number(params.get('object'));
  const objectId = myObjects.some((o) => o.id === requested) ? requested : myObjects[0]?.id;
  const card = useMkdObject(objectId, periodInfo && !periodInfo.isNew ? periodValue : undefined, { enabled: Boolean(objectId && periodInfo) });

  // ---------- черновик формы: { itemId: { status, pct, ks, paid, note } } — только тронутые позиции
  const [drafts, setDrafts] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [message, setMessage] = useState(null);
  const items = card.data?.items ?? [];
  const originals = useMemo(() => Object.fromEntries(items.map((it) => [it.id, toForm(it)])), [items]);
  const formOf = (id) => drafts[id] ?? originals[id];
  const changedIds = items.filter((it) => drafts[it.id] && isChanged(drafts[it.id], originals[it.id])).map((it) => it.id);
  const dirty = changedIds.length > 0;
  const errorsOf = (id) => ({ ...(drafts[id] ? validate(drafts[id]) : {}), ...(serverErrors[id] ?? {}) });
  const hasErrors = changedIds.some((id) => Object.keys(errorsOf(id)).length > 0);

  // При смене адреса или периода черновик сбрасывается
  useEffect(() => { setDrafts({}); setServerErrors({}); }, [objectId, periodValue]);

  // Браузер переспросит, если закрыть вкладку с несохранёнными изменениями
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  if (meta.isPending || registry.isPending) return <Loading />;
  if (meta.isError) return <ErrorBox error={meta.error} onRetry={meta.refetch} />;
  if (registry.isError) return <ErrorBox error={registry.error} onRetry={registry.refetch} />;

  if (!myObjects.length) {
    return (
      <div className="page sect">
        <nav className="crumbs"><Link to="/">Сводка</Link><span>/</span><Link to="/mkd">Капремонт МКД</Link><span>/</span><span>Ввод данных</span></nav>
        <div className="error-box"><h2>Нет адресов для ввода</h2><p>Вы пока не назначены ответственным ни за один адрес МКД. Обратитесь к администратору.</p></div>
      </div>
    );
  }

  const confirmLeave = () => !dirty || window.confirm('Есть несохранённые изменения. Перейти без сохранения?');
  const chooseObject = (id) => { if (confirmLeave()) { setParams({ object: String(id) }, { replace: true }); setMessage(null); } };
  const choosePeriod = (v) => { if (confirmLeave()) { setPeriod(v); setMessage(null); } };

  const update = (id, field, value) => {
    setMessage(null);
    setServerErrors((s) => ({ ...s, [id]: undefined }));
    setDrafts((d) => {
      const next = { ...(d[id] ?? originals[id]), [field]: value };
      const fixed = fixedPct(next.status);
      if (field === 'status' && fixed != null) next.pct = String(fixed); // КС-2/оплачено → 100 %, исключено → 0 %
      return { ...d, [id]: next };
    });
  };

  async function onSave() {
    const payload = changedIds.map((id) => ({ itemId: id, ...fromForm(drafts[id]) }));
    try {
      const r = await save.mutateAsync({ period: periodValue, items: payload });
      setDrafts({});
      setServerErrors({});
      setMessage({ ok: true, text: `${r.message}. Показатели «Сводки» обновлены.` });
    } catch (err) {
      // Ошибки сервера по полям: 'items.<номер в запросе>.<поле>' → к нужной позиции
      const byItem = {};
      (err.details?.fields ?? []).forEach((f) => {
        const [, idx, field] = f.field.split('.');
        const id = payload[Number(idx)]?.itemId;
        if (id) byItem[id] = { ...byItem[id], [field]: f.message.replace(/^.*?: /, '') };
      });
      setServerErrors(byItem);
      setMessage({ ok: false, text: err.message });
    }
  }

  const current = myObjects.find((o) => o.id === objectId);

  return (
    <div className="page sect">
      <nav className="crumbs" aria-label="Навигация">
        <Link to="/">Сводка</Link><span>/</span><Link to="/mkd">Капремонт МКД</Link><span>/</span><span>Ввод данных</span>
      </nav>

      <div className="head">
        <div>
          <h1>Ввод данных за период</h1>
          <p className="lead">Статус, готовность и суммы по позициям ваших адресов. Сохраняются только изменённые позиции.</p>
        </div>
        <label className="period-select">
          <span>Период</span>
          <select value={periodValue} onChange={(e) => choosePeriod(e.target.value)}>
            {periods.map((p) => <option key={p.start} value={p.start}>{periodOption(p)}{p.isNew ? ' · новый' : ''}</option>)}
          </select>
        </label>
      </div>

      {periodInfo?.isNew && (
        <div className="notice">Период {periodLabel(periodInfo)} ещё не начат — он откроется при первом сохранении. Значения ниже — последние внесённые.</div>
      )}

      <div className="input-layout">
        <nav className="addr-list" aria-label="Мои адреса">
          {myObjects.map((o) => (
            <button key={o.id} type="button" aria-current={o.id === objectId} onClick={() => chooseObject(o.id)}>
              <span>{o.address}{o.id === objectId && dirty && <span className="dirty"> •</span>}</span>
              <small>{pct100(o.pct)} · план {pct100(o.plan)} · {o.n} поз.</small>
            </button>
          ))}
        </nav>
        <div className="addr-picker">
          <label className="f">
            <span>Адрес</span>
            <select value={objectId} onChange={(e) => chooseObject(Number(e.target.value))}>
              {myObjects.map((o) => <option key={o.id} value={o.id}>{o.address}</option>)}
            </select>
          </label>
        </div>

        <section className="items" aria-label={`Позиции: ${current?.address ?? ''}`}>
          {card.isPending && <Loading text="Загружаем позиции…" />}
          {card.isError && <ErrorBox error={card.error} onRetry={card.refetch} />}
          {card.data && (
            <div className="item-h">
              <b>{card.data.object.address}</b>
              <Link className="sub" to={`/mkd/${objectId}`}>Открыть карточку адреса →</Link>
            </div>
          )}
          {items.map((it) => {
            const form = formOf(it.id);
            const errors = errorsOf(it.id);
            const changed = changedIds.includes(it.id);
            const original = originals[it.id];
            const fixed = fixedPct(form.status);
            const warns = changed ? warnings(form, original, it) : [];
            const was = (field, text) => changed && form[field] !== original[field] && <span className="was">было: {text}</span>;
            return (
              <article key={it.id} className={'item' + (changed ? ' changed' : '')}>
                <div className="item-h">
                  <div>
                    <b>{it.workType}</b>
                    <div className="sub">
                      {fdate(it.start)} – {fdate(it.end)} · договор {rub(it.contract)} · план на дату {pct100(it.plan)}
                      {it.overdue && <span style={{ color: 'var(--crit-ink)' }}> · срок прошёл</span>}
                    </div>
                  </div>
                  {it.enteredBy && <span className="sub">последний ввод: {it.enteredBy}</span>}
                </div>

                <div className="fields">
                  <div className="f">
                    <label htmlFor={`st-${it.id}`}>Статус</label>
                    <select id={`st-${it.id}`} value={form.status} onChange={(e) => update(it.id, 'status', e.target.value)}>
                      {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS[s].name}</option>)}
                    </select>
                    {was('status', STATUS[original.status]?.name)}
                  </div>
                  <div className="f">
                    <label htmlFor={`pct-${it.id}`}>Готовность, %</label>
                    <input
                      id={`pct-${it.id}`} inputMode="decimal" value={fixed != null ? String(fixed) : form.pct} disabled={fixed != null}
                      onChange={(e) => update(it.id, 'pct', e.target.value)} aria-invalid={errors.pct ? 'true' : undefined}
                    />
                    {errors.pct ? <span className="err">{errors.pct}</span> : was('pct', `${original.pct} %`)}
                  </div>
                  <div className="f">
                    <label htmlFor={`ks-${it.id}`}>Закрыто КС-2, ₽</label>
                    <input id={`ks-${it.id}`} inputMode="decimal" value={form.ks} onChange={(e) => update(it.id, 'ks', e.target.value)} aria-invalid={errors.ks ? 'true' : undefined} />
                    {errors.ks ? <span className="err">{errors.ks}</span> : was('ks', original.ks || '0')}
                  </div>
                  <div className="f">
                    <label htmlFor={`paid-${it.id}`}>Оплачено, ₽</label>
                    <input id={`paid-${it.id}`} inputMode="decimal" value={form.paid} onChange={(e) => update(it.id, 'paid', e.target.value)} aria-invalid={errors.paid ? 'true' : undefined} />
                    {errors.paid ? <span className="err">{errors.paid}</span> : was('paid', original.paid || '0')}
                  </div>
                </div>
                <div className="f">
                  <label htmlFor={`note-${it.id}`}>Примечание к периоду</label>
                  <textarea id={`note-${it.id}`} rows={1} maxLength={1000} value={form.note} onChange={(e) => update(it.id, 'note', e.target.value)} placeholder="Например: приостановлено до поставки материалов" />
                </div>
                {warns.length > 0 && <ul className="warns">{warns.map((w) => <li key={w}>⚠ {w}</li>)}</ul>}
              </article>
            );
          })}
        </section>
      </div>

      <div className="savebar" role="region" aria-label="Сохранение">
        <span className={'msg' + (message ? (message.ok ? ' ok' : ' err') : '')} role="status">
          {message ? message.text : dirty ? `Изменено позиций: ${changedIds.length}${hasErrors ? ' · исправьте ошибки' : ''}` : 'Изменений нет'}
        </span>
        <div className="btns">
          <button type="button" className="btn" disabled={!dirty || save.isPending} onClick={() => { setDrafts({}); setServerErrors({}); setMessage(null); }}>Отменить</button>
          <button type="button" className="btn primary" disabled={!dirty || hasErrors || save.isPending} onClick={onSave}>
            {save.isPending ? 'Сохраняем…' : `Сохранить${dirty ? ` (${changedIds.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
