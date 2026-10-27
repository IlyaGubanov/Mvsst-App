// Пропускает на страницы направления, только если оно открыто пользователю.
// Иначе — «Страница не найдена» (не раскрываем, что такой раздел есть). Сервер права проверит всё равно.
import { useAuth } from '../auth/AuthContext.jsx';
import NotFoundPage from './NotFoundPage.jsx';

export default function DirectionGate({ code, children }) {
  const { user } = useAuth();
  return user.directions.some((d) => d.code === code) ? children : <NotFoundPage />;
}
