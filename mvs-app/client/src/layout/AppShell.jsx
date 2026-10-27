// =====================================================================
//  AppShell — каркас страниц после входа: верхняя панель + содержимое страницы (<Outlet />).
//  Вкладки строятся из направлений, ДОСТУПНЫХ пользователю (их присылает сервер в /auth/me).
//  Число на вкладке — сколько объектов направления отстают от графика (зелёное 0 — всё в графике).
// =====================================================================

import { Link, NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../theme/ThemeContext.jsx';
import { useOverview } from '../api/overview.js';
import { directionUi } from '../directions.js';
import { todayIso } from '../utils/format.js';
import { SunIcon, MoonIcon } from '../components/Icons.jsx';
import UserMenu from './UserMenu.jsx';

const tabClass = ({ isActive }) => 'tab' + (isActive ? ' active' : '');

export default function AppShell() {
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  const overview = useOverview(todayIso());

  // code → сколько отстают (null — у направления нет графика)
  const lagging = Object.fromEntries((overview.data?.directions ?? []).map((d) => [d.code, d.kpi?.lagging ?? null]));

  return (
    <>
      <a className="visually-hidden" href="#main">Перейти к содержимому</a>
      <header className="bar">
        <div className="bar-in">
          <Link to="/" className="brand">
            <span className="mark" aria-hidden="true">МВС<br />СТ</span>
            <span className="brand-t">
              <b>Ход работ</b>
              <small>Производственная сводка по направлениям</small>
            </span>
          </Link>

          <nav className="tabs" aria-label="Направления">
            <NavLink to="/" end className={tabClass}>Сводка</NavLink>
            {user.directions.map((d) => {
              const ui = directionUi(d.code);
              const n = lagging[d.code];
              return (
                <NavLink key={d.code} to={`/${d.code}`} className={tabClass} style={{ '--tc': ui.color }}>
                  <span className="dot" aria-hidden="true" />
                  <span className="ln">{ui.name}</span>
                  <span className="sn">{ui.short}</span>
                  {n != null && (
                    <span className={'cnt' + (n ? '' : ' zero')} title={n ? `Отстают от графика: ${n}` : 'Все в графике'}>{n}</span>
                  )}
                </NavLink>
              );
            })}
          </nav>

          <div className="acts">
            <button
              type="button" className="btn icon" onClick={toggle}
              aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
              title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
            <UserMenu />
          </div>
        </div>
      </header>
      <main id="main">
        <Outlet />
      </main>
    </>
  );
}
