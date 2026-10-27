import { defineConfig, devices } from '@playwright/test';
import { DEMO_API_PORT, DEMO_WEB_PORT } from './demo-e2e/helpers';

// Runs docs/DEMO-SCRIPT.md in the browser against the simplified demo data in mmf_demo (reloaded fresh for every run), on
// its own ports so it can run while `npm run demo` is serving on 4000 / 5173. One worker, in script order.
export default defineConfig({
  testDir: 'demo-e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  globalSetup: './demo-e2e/global-setup.ts',
  outputDir: 'test-results-demo',
  use: {
    baseURL: `http://127.0.0.1:${DEMO_WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1366, height: 850 },
  },
  webServer: {
    command: `npx vite --port ${DEMO_WEB_PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${DEMO_WEB_PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { API_URL: `http://127.0.0.1:${DEMO_API_PORT}`, WEB_PORT: String(DEMO_WEB_PORT) },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 850 } } }],
});
