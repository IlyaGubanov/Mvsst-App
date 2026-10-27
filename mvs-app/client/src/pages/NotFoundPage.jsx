import { Link } from 'react-router';

export default function NotFoundPage() {
  return (
    <div className="page">
      <div className="error-box">
        <h2>Страница не найдена</h2>
        <p>Такого раздела нет или он вам не открыт. Если вы считаете, что доступ нужен, обратитесь к администратору.</p>
        <div><Link className="btn" to="/">← К сводке</Link></div>
      </div>
    </div>
  );
}
