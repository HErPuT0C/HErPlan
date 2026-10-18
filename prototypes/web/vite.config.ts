import { defineConfig } from 'vite';

// Relative base so the same build loads from a Tauri asset URL, an Electron file:// URL or a dev server.
export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, strictPort: true },
});
