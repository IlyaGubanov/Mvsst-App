// =====================================================================
//  AuthContext — «кто вошёл» для всего приложения.
//
//  const { user, login, logout, changePassword } = useAuth();
//    user — null, если не вошёл; иначе { fullName, role, roleName, mustChangePassword, directions: [...] }
//
//  Сервер — единственный источник правды: при загрузке спрашиваем GET /api/auth/me.
//  Если какой-то запрос вернул 401 (сеанс истёк), пользователь сбрасывается и попадает на вход.
// =====================================================================

import { createContext, useCallback, useContext, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';

const AuthContext = createContext(null);
const ME = ['me'];

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();

  const me = useQuery({
    queryKey: ME,
    queryFn: async () => {
      try {
        return (await api('/auth/me')).user;
      } catch (err) {
        if (err.status === 401) return null; // не вошёл — это не ошибка
        throw err;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Сбросить данные прежнего пользователя (сводка, показатели), но НЕ сам запрос «кто я»:
  // к нему подписан интерфейс, и при удалении он не узнал бы о новом пользователе.
  const resetUserData = useCallback((user) => {
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    queryClient.setQueryData(ME, user);
  }, [queryClient]);

  // Реакция на события из api/client.js
  useEffect(() => {
    const onUnauthorized = () => resetUserData(null);
    const onPasswordChange = () => queryClient.invalidateQueries({ queryKey: ME });
    window.addEventListener('mvs:unauthorized', onUnauthorized);
    window.addEventListener('mvs:password-change-required', onPasswordChange);
    return () => {
      window.removeEventListener('mvs:unauthorized', onUnauthorized);
      window.removeEventListener('mvs:password-change-required', onPasswordChange);
    };
  }, [queryClient, resetUserData]);

  const login = useCallback(async (loginName, password) => {
    const { user } = await api('/auth/login', { method: 'POST', body: { login: loginName, password } });
    resetUserData(user); // данные предыдущего пользователя — прочь
    return user;
  }, [resetUserData]);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    resetUserData(null);
  }, [resetUserData]);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const { user } = await api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
    queryClient.setQueryData(ME, user);
    return user;
  }, [queryClient]);

  const value = {
    user: me.data ?? null,
    loading: me.isPending,
    error: me.error,
    retry: me.refetch,
    login,
    logout,
    changePassword,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
