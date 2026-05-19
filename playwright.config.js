// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 15000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5501',
    headless: true,
  },
  webServer: {
    command: 'npx serve . -p 5501 -s',
    port: 5501,
    reuseExistingServer: true,
    timeout: 10000,
  },
  projects: [
    { name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'Mobile Chrome',  use: { ...devices['Pixel 5'] } },
  ],
});
