import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    // `npm run dev` serves the UI; the API comes from `npm run dev:server` on port 8080.
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});
