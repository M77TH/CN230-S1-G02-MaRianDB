import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// https://vitejs.dev/config/
export default defineConfig(({ mode, isPreview }) => {
  // ALLOWED_HOSTS lives in the repo-root .env (comma-separated), e.g. your ngrok domain.
  const env = loadEnv(mode, projectRoot, '');
  const allowedHosts = (env.ALLOWED_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean);

  return {
    plugins: [react()],
    // shortcut: './' makes `vite preview` redirect to /dist/ and blank the page, so preview serves from '/'.
    base: isPreview ? '/' : './',
    publicDir: 'public',
    server: {
      port: 3000,
      open: false,
      // The static presentation site needs no pipeline API or database service.
      host: '127.0.0.1',
      allowedHosts,
    },
    preview: {
      port: 3000,
      host: '127.0.0.1',
      allowedHosts,
    },
    build: {
      target: 'esnext',
      outDir: 'dist'
    }
  };
});
