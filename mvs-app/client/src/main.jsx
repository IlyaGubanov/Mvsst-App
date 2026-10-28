// Точка входа интерфейса: подключаем стили и «монтируем» приложение React в <div id="root">.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/auth.css';
import './styles/overview.css';
import './styles/mkd.css';
import './styles/networks.css';
import './styles/schools.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
