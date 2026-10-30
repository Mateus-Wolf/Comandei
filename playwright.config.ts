import { defineConfig } from '@playwright/test';
import { loadTestEnvironment } from './tests/playwright/environment';

loadTestEnvironment();
const baseURL = process.env.E2E_API_URL || 'http://127.0.0.1:8011';
const managed = new URL(baseURL).origin === 'http://127.0.0.1:8011';
export default defineConfig({
  testDir: './tests/playwright',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/playwright/environment.ts',
  workers: 1,
  retries: 0,
  timeout: 90000,
  reporter: [['list', { printSteps: true }], ['html', { open: 'never' }]],
  webServer: managed ? {
    command: 'npm run api:dev -- --port 8011',
    url: `${baseURL}/health/ready`,
    reuseExistingServer: false,
    timeout: 60000,
  } : undefined,
  use: { baseURL, trace: 'retain-on-failure' },
});
