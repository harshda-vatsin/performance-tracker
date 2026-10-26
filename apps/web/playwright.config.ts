import { defineConfig, devices } from '@playwright/test';
import { API_PORT, WEB_PORT } from './e2e/helpers';

// The suite owns a private database (mmf_e2e), API (port 4100) and web server (port 5273), so it never touches
// the developer's data. Tests run in order on one worker: each spec builds on the data the previous one created.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1366, height: 850 },
  },
  webServer: {
    command: `npx vite --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${WEB_PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { API_URL: `http://127.0.0.1:${API_PORT}`, WEB_PORT: String(WEB_PORT) },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 850 } } }],
});
