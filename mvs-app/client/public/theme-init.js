// Применяем сохранённую тему ДО отрисовки страницы, чтобы не было «вспышки» светлой темы.
// Отдельный файл, а не <script> внутри index.html: защита сервера (Content-Security-Policy)
// запрещает встроенные скрипты — так безопаснее.
try {
  var t = localStorage.getItem('mvs-theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) { /* хранилище недоступно — будет тема как в системе */ }
