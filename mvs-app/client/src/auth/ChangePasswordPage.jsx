// =====================================================================
//  Смена пароля. Обязательна после входа с временным паролем (тогда «Назад» не показываем).
//  Требования те же, что проверяет сервер: не короче 10 символов, буквы и цифры.
// =====================================================================

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from './AuthContext.jsx';
import PasswordField from '../components/PasswordField.jsx';

const MIN_LENGTH = 10;

export default function ChangePasswordPage() {
  const { user, changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const forced = user?.mustChangePassword;

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  // Подсказки загораются зелёным по мере ввода
  const rules = [
    { ok: next.length >= MIN_LENGTH, text: `не короче ${MIN_LENGTH} символов` },
    { ok: /\p{L}/u.test(next) && /\d/.test(next), text: 'есть и буквы, и цифры' },
    { ok: next.length > 0 && next !== current, text: 'отличается от текущего' },
  ];
  const mismatch = repeat.length > 0 && repeat !== next;
  const canSubmit = current && rules.every((r) => r.ok) && repeat === next && !busy;

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    setBusy(true);
    try {
      await changePassword(current, next);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
      // Сервер присылает ошибки по полям: { fields: [{ field: 'currentPassword', message }] }
      const byField = {};
      (err.details?.fields ?? []).forEach((f) => { byField[f.field] = f.message; });
      setFieldErrors(byField);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <div className="auth-head">
          <span className="mark" aria-hidden="true">МВС<br />СТ</span>
          <div>
            <h1>{forced ? 'Придумайте свой пароль' : 'Смена пароля'}</h1>
            <p>{user?.fullName}</p>
          </div>
        </div>
        {forced && (
          <p className="auth-note">
            Вы вошли с временным паролем, который выдал администратор. Чтобы продолжить, задайте свой —
            его будете знать только вы.
          </p>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}

        <PasswordField
          label={forced ? 'Временный пароль' : 'Текущий пароль'}
          value={current} onChange={setCurrent} autoComplete="current-password" autoFocus
          error={fieldErrors.currentPassword}
        />
        <PasswordField label="Новый пароль" value={next} onChange={setNext} autoComplete="new-password" error={fieldErrors.newPassword} />
        <ul className="rules" aria-label="Требования к паролю">
          {rules.map((r) => <li key={r.text} className={r.ok ? 'ok' : undefined}>{r.ok ? '✓ ' : ''}{r.text}</li>)}
        </ul>
        <PasswordField
          label="Повторите новый пароль" value={repeat} onChange={setRepeat} autoComplete="new-password"
          error={mismatch ? 'Пароли не совпадают' : undefined}
        />

        <button type="submit" className="btn primary" disabled={!canSubmit}>{busy ? 'Сохраняем…' : 'Сохранить пароль'}</button>
        <div className="auth-links">
          {forced
            ? <button type="button" onClick={async () => { await logout(); navigate('/login', { replace: true }); }}>Выйти</button>
            : <button type="button" onClick={() => navigate(-1)}>← Назад</button>}
        </div>
      </form>
    </main>
  );
}
