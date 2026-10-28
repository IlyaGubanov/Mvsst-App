// Точка входа интерфейса: подключаем стили и «монтируем» приложение React в <div id="root">.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// Порядок важен: сначала цвета и общие правила, затем общие элементы, в конце — стили отдельных страниц.
import './styles/tokens.css';    // цвета, размеры, светлая и тёмная тема
import './styles/base.css';      // основа: шрифт, кнопки, метки статуса, загрузка и ошибка
import './styles/layout.css';    // каркас страниц: заголовок, крошки, панели, блоки, сетки
import './styles/controls.css';  // фильтры, выбор даты, вкладки раздела, поля ввода
import './styles/data.css';      // плитки, полосы готовности, таблицы, карточки на телефоне, история
import './styles/charts.css';    // графики и легенды
import './styles/input.css';     // экраны ввода: список объектов, блоки полей, панель сохранения
import './styles/shell.css';
import './styles/auth.css';
import './styles/overview.css';
import './styles/mkd.css';
import './styles/networks.css';
import './styles/schools.css';
import './styles/streets.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
