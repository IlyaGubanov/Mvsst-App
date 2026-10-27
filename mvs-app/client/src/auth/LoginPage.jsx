// =====================================================================
//  Страница входа. После входа возвращает туда, куда человек шёл (например, по ссылке на объект).
// =====================================================================

import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from './AuthContext.jsx';
import PasswordField from '../components/PasswordField.jsx';
import { Loading } from '../components/Status.jsx';

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || '/';

  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (user) return <Navigate to={user.mustChangePassword ? '/change-password' : from} replace />;

  async function onSubmit(e) {
    e.preventDefault(); // не перезагружать страницу при отправке формы
    setError('');
    setBusy(true);
    try {
      const u = await login(loginName.trim(), password);
      navigate(u.mustChangePassword ? '/change-password' : from, { replace: true });
    } catch (err) {
      setError(err.message); // текст ошибки приходит с сервера уже по-русски
      setPassword('');
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
            <h1>Ход работ</h1>
            <p>Вход для сотрудников</p>
          </div>
        </div>

        {error && <div className="form-error" role="alert">{error}</div>}

        <div className="field">
          <label htmlFor="login">Логин</label>
          <input
            id="login"
            value={loginName}
            onChange={(e) => setLoginName(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck="false"
            autoFocus
            required
          />
        </div>
        <PasswordField label="Пароль" value={password} onChange={setPassword} autoComplete="current-password" />

        <button type="submit" className="btn primary" disabled={busy || !loginName.trim() || !password}>
          {busy ? 'Входим…' : 'Войти'}
        </button>
        <p className="auth-note">Забыли пароль? Обратитесь к администратору — он выдаст временный.</p>
      </form>
    </main>
  );
}
