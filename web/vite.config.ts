import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',
  publicDir: 'data',
  server: {
    port: 3000,
    open: false,
    // The static presentation site needs no pipeline API or database service.
    host: '127.0.0.1',
  },
  build: {
    target: 'esnext',
    outDir: 'dist'
  }
});
