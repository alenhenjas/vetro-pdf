import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'scripts/docs',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    channel: 'chrome',
        permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
  },
});
