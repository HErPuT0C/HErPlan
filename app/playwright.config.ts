import { defineConfig } from '@playwright/test';

// End-to-end tests run against the web build in Chromium: the same engine as WebView2 on Windows.
export default defineConfig({
  testDir: 'e2e',
  // CI machines sometimes take longer than a test's budget just to start the browser: one retry there.
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:4174/',
    viewport: { width: 1366, height: 768 },
    // The canvas needs WebGL 2; CI machines have no GPU, so Chromium renders it in software.
    launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4174/',
    reuseExistingServer: !process.env.CI,
  },
});
