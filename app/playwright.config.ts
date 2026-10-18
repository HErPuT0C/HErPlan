import { defineConfig } from '@playwright/test';

// End-to-end tests run against the web build in Chromium: the same engine as WebView2 on Windows.
export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:4174/', viewport: { width: 1366, height: 768 } },
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4174/',
    reuseExistingServer: !process.env.CI,
  },
});
