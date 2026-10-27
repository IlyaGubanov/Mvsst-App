// Индикаторы загрузки и ошибки — одинаковые на всех страницах.

export function Loading({ text = 'Загрузка…' }) {
  return (
    <div className="loading" role="status">
      <div className="track"><i /></div>
      <span>{text}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry, title = 'Не удалось загрузить данные' }) {
  return (
    <div className="error-box" role="alert">
      <h2>{title}</h2>
      <p>{error?.message || 'Неизвестная ошибка'}</p>
      {onRetry && <div><button type="button" className="btn" onClick={onRetry}>Повторить</button></div>}
    </div>
  );
}
