// Итоговая полоса «по организации»: объекты, отставание, портфель, КС-2, люди и техника.
import { bnShort, nf, pct, plural } from '../../utils/format.js';
import { shortNames } from './model.js';

export default function Totals({ T, directionsCount }) {
  return (
    <section aria-label="Итоги по организации">
      <div className="totals">
        <div className="tot">
          <span className="l">Объектов в работе</span>
          <span className="v">{nf(T.objects)}</span>
          <span className="s">{directionsCount} {plural(directionsCount, 'направление', 'направления', 'направлений')}</span>
        </div>
        <div className={'tot' + (T.crit ? ' alert' : '')}>
          <span className="l">Отстают от графика</span>
          <span className="v">{nf(T.lag)}<small>из {nf(T.schedObjects)}</small></span>
          <span className="s">
            критично {nf(T.crit)}
            {T.noSched.length > 0 && ` · не учтено: ${shortNames(T.noSched)} (нет графика)`}
          </span>
        </div>
        <div className="tot">
          <span className="l">Портфель: лимиты и договоры</span>
          <span className="v">{bnShort(T.portfolio)}<small>млрд ₽</small></span>
          <span className="s">{shortNames(T.portfolioDirs) || 'нет данных'}</span>
        </div>
        <div className="tot">
          <span className="l">Закрыто КС-2</span>
          <span className="v">{bnShort(T.closed)}<small>млрд ₽</small></span>
          <span className="s">
            {T.closedBase ? `${pct(T.closed / T.closedBase)} договоров · ` : ''}{shortNames(T.closedDirs) || 'нет данных'}
          </span>
        </div>
        <div className="tot">
          <span className="l">Люди и техника на объектах</span>
          <span className="v">{nf(T.people)}<small>чел.</small></span>
          <span className="s">{nf(T.tech)} ед. техники · {shortNames(T.resDirs) || 'нет данных'}</span>
        </div>
      </div>
    </section>
  );
}
