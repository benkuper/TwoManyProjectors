import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 90000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1500, height: 950 },
    launchOptions: { channel: 'msedge' },
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run dev -- --port 5174',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: true
  }
})
