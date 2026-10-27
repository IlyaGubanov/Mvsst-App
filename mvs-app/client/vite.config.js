// =====================================================================
//  Настройки Vite — инструмента, который запускает интерфейс при разработке
//  (npm run dev → http://localhost:5173) и собирает его для сервера (npm run build → папка dist/).
// =====================================================================

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Все запросы /api/… при разработке пересылаем на сервер Node.js (npm run dev в папке server).
    // Для браузера это один адрес, поэтому cookie входа работают без дополнительных настроек.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
