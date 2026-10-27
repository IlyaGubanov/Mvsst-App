// =====================================================================
//  RequireAuth — «охранник» страниц: не вошёл → на вход; временный пароль → на смену пароля.
//  Это удобство для пользователя. Настоящую проверку прав всё равно делает сервер.
// =====================================================================

import { Navigate, useLocation } from 'react-router';
import { useAuth } from './AuthContext.jsx';
import { Loading, ErrorBox } from '../components/Status.jsx';

export function RequireAuth({ children }) {
  const { user, loading, error, retry } = useAuth();
  const location = useLocation();

  if (loading) return <Loading text="Проверяем вход…" />;
  if (error) return <ErrorBox error={error} onRetry={retry} title="Сервер недоступен" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}
