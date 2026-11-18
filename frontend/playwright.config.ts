import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  expect: { timeout: 12000 },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    timezoneId: 'Asia/Kuala_Lumpur',
    headless: true,
    channel: 'chrome',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 30000
  }
});
