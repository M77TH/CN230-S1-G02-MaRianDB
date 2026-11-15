import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(webDirectory, '..');

function localPipelineApi() {
  let backend: ReturnType<typeof spawn> | undefined;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let serverClosing = false;

  return {
    name: 'cn230-local-pipeline-api',
    configureServer(server: { httpServer?: { once: (event: string, callback: () => void) => void }; config: { logger: { error: (message: string) => void } } }) {
      const python = process.env.CN230_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
      const apiScript = resolve(projectDirectory, 'pipeline_api.py');
      const startBackend = () => {
        if (serverClosing) return;
        backend = spawn(python, [apiScript], {
          cwd: projectDirectory,
          env: { ...process.env, PYTHONUNBUFFERED: '1' },
          stdio: 'inherit',
          windowsHide: true
        });

        backend.on('error', (error) => {
          server.config.logger.error(`Could not start the CN230 pipeline API (${python}): ${error.message}`);
        });
      };

      const restartBackend = () => {
        if (restartTimer) clearTimeout(restartTimer);
        const previous = backend;
        backend = undefined;
        const startAfterExit = () => {
          if (!serverClosing && !backend) startBackend();
        };
        if (previous) {
          previous.once('exit', startAfterExit);
          previous.kill();
        }
        restartTimer = setTimeout(startAfterExit, 1_000);
      };

      startBackend();
      server.watcher.add(apiScript);
      server.watcher.on('change', (changedPath) => {
        if (resolve(changedPath).toLowerCase() === apiScript.toLowerCase()) restartBackend();
      });
      server.httpServer?.once('close', () => {
        serverClosing = true;
        if (restartTimer) clearTimeout(restartTimer);
        backend?.kill();
        backend = undefined;
      });
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), localPipelineApi()],
  base: './',
  server: {
    port: 3000,
    open: false,
    // Keep the local pipeline runner and SQL sandbox on this machine only.
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: false
      }
    }
  },
  build: {
    target: 'esnext',
    outDir: 'dist'
  }
});
