// =====================================================================
//  App.jsx — «скелет» приложения: общие провайдеры и таблица адресов (маршрутов).
//
//  /login             — вход
//  /change-password   — смена пароля (обязательна после временного)
//  /                  — «Сводка»
//  /:direction        — раздел направления (schools, mkd, networks, streets) — шаг 6
//  /:direction/:id    — карточка объекта — шаг 6
// =====================================================================

import { BrowserRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AuthProvider } from './auth/AuthContext.jsx';
import { RequireAuth } from './auth/RequireAuth.jsx';
import { ThemeProvider } from './theme/ThemeContext.jsx';
import LoginPage from './auth/LoginPage.jsx';
import ChangePasswordPage from './auth/ChangePasswordPage.jsx';
import AppShell from './layout/AppShell.jsx';
import OverviewPage from './pages/overview/OverviewPage.jsx';
import DirectionPage from './pages/DirectionPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import DirectionGate from './pages/DirectionGate.jsx';
import MkdRegistryPage from './pages/mkd/MkdRegistryPage.jsx';
import MkdObjectPage from './pages/mkd/MkdObjectPage.jsx';
import MkdInputPage from './pages/mkd/MkdInputPage.jsx';
import NetRegistryPage from './pages/networks/NetRegistryPage.jsx';
import NetObjectPage from './pages/networks/NetObjectPage.jsx';
import NetInputPage from './pages/networks/NetInputPage.jsx';
import SchoolsPage from './pages/schools/SchoolsPage.jsx';
import SchoolPage from './pages/schools/SchoolPage.jsx';
import SchoolInputPage from './pages/schools/SchoolInputPage.jsx';

// Кэш запросов к серверу: данные переиспользуются между страницами и обновляются при возврате на вкладку
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,          // минуту данные считаются свежими
      refetchOnWindowFocus: true,    // вернулись на вкладку — тихо обновить
      retry: (count, error) => count < 2 && !(error?.status >= 400 && error?.status < 500), // ошибки 4xx не повторяем
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/change-password" element={<RequireAuth><ChangePasswordPage /></RequireAuth>} />
              <Route element={<RequireAuth><AppShell /></RequireAuth>}>
                <Route index element={<OverviewPage />} />
                {/* МКД — полный раздел. Точные адреса важнее общих «:direction», поэтому срабатывают они */}
                <Route path="mkd" element={<DirectionGate code="mkd"><MkdRegistryPage /></DirectionGate>} />
                <Route path="mkd/input" element={<DirectionGate code="mkd"><MkdInputPage /></DirectionGate>} />
                <Route path="mkd/:objectId" element={<DirectionGate code="mkd"><MkdObjectPage /></DirectionGate>} />
                <Route path="networks" element={<DirectionGate code="networks"><NetRegistryPage /></DirectionGate>} />
                <Route path="networks/input" element={<DirectionGate code="networks"><NetInputPage /></DirectionGate>} />
                <Route path="networks/:objectId" element={<DirectionGate code="networks"><NetObjectPage /></DirectionGate>} />
                <Route path="schools" element={<DirectionGate code="schools"><SchoolsPage /></DirectionGate>} />
                <Route path="schools/input" element={<DirectionGate code="schools"><SchoolInputPage /></DirectionGate>} />
                <Route path="schools/:objectId" element={<DirectionGate code="schools"><SchoolPage /></DirectionGate>} />
                <Route path=":direction" element={<DirectionPage />} />
                <Route path=":direction/:objectId" element={<DirectionPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
