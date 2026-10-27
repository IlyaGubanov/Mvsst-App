// =====================================================================
//  ThemeContext — светлая / тёмная тема.
//  По умолчанию тема как в системе. Кнопка переключает на противоположную и запоминает выбор
//  в браузере (localStorage). Сама раскраска — в styles/tokens.css по атрибуту data-theme.
// =====================================================================

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'mvs-theme';
const ThemeContext = createContext(null);

// localStorage может быть недоступен (приватный режим, запрет сайта) — тогда просто не запоминаем
function readSaved() {
  try { const v = localStorage.getItem(STORAGE_KEY); return v === 'light' || v === 'dark' ? v : null; } catch { return null; }
}
function save(value) {
  try { value ? localStorage.setItem(STORAGE_KEY, value) : localStorage.removeItem(STORAGE_KEY); } catch { /* не страшно */ }
}
const systemTheme = () => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

export function ThemeProvider({ children }) {
  const [chosen, setChosen] = useState(readSaved);   // 'light' | 'dark' | null (как в системе)
  const [system, setSystem] = useState(systemTheme);

  // Следим за сменой темы в системе (например, вечером телефон переключился на тёмную)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const onChange = () => setSystem(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Применяем выбор к <html data-theme="…">
  useEffect(() => {
    if (chosen) document.documentElement.setAttribute('data-theme', chosen);
    else document.documentElement.removeAttribute('data-theme');
  }, [chosen]);

  const theme = chosen ?? system; // тема, которая сейчас на экране

  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setChosen(next);
    save(next);
  }, [theme]);

  // Вернуться к теме «как в системе»
  const followSystem = useCallback(() => { setChosen(null); save(null); }, []);

  return (
    <ThemeContext.Provider value={{ theme, chosen, toggle, followSystem }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
