// Меню пользователя: кто вошёл и с какой ролью, смена пароля, тема «как в системе», выход.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import { useTheme } from '../theme/ThemeContext.jsx';
import { KeyIcon, LogoutIcon, MonitorIcon } from '../components/Icons.jsx';

/** «Петров Сергей Викторович» → «ПС»; «Администратор (тест)» → «АТ» (берём только буквы) */
const initials = (name) => (name || '').split(/\s+/)
  .map((w) => w.match(/\p{L}/u)?.[0])
  .filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';

export default function UserMenu() {
  const { user, logout } = useAuth();
  const { chosen, followSystem } = useTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Закрываем меню по клику мимо или по Escape
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const go = (path) => { setOpen(false); navigate(path); };

  return (
    <div className="user-menu" ref={ref}>
      <button
        type="button" className="btn user-btn" aria-haspopup="menu" aria-expanded={open}
        aria-label={`Меню пользователя: ${user.fullName}`} onClick={() => setOpen((v) => !v)}
      >
        <span className="initials" aria-hidden="true">{initials(user.fullName)}</span>
        <span className="bt">{user.fullName}</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="who">
            <b>{user.fullName}</b>
            <small>{user.roleName} · {user.login}</small>
          </div>
          <button type="button" role="menuitem" onClick={() => go('/change-password')}><KeyIcon /> Сменить пароль</button>
          {chosen && (
            <button type="button" role="menuitem" onClick={() => { followSystem(); setOpen(false); }}><MonitorIcon /> Тема как в системе</button>
          )}
          <button type="button" role="menuitem" onClick={async () => { setOpen(false); await logout(); navigate('/login', { replace: true }); }}>
            <LogoutIcon /> Выйти
          </button>
        </div>
      )}
    </div>
  );
}
