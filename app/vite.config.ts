import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
// CI builds between releases carry their run number ("сборка 57"); releases and local builds have none.
const build = process.env.HERPLAN_BUILD ?? '';

// Tauri serves the build from disk, so assets use relative paths; the dev server port is fixed for `tauri dev`.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version), __APP_BUILD__: JSON.stringify(build) },
  base: './',
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    // The Markdown fuzzer (F5-11) takes minutes: a step of its own in CI, `npm run test:fuzz`.
    include: mode === 'fuzz' ? ['src/**/*.fuzz.test.ts'] : ['src/**/*.test.{ts,tsx}'],
    exclude: mode === 'fuzz' ? [] : ['src/**/*.fuzz.test.ts', 'node_modules/**'],
    testTimeout: mode === 'fuzz' ? 1_800_000 : 5000,
  },
}));
