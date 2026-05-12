import { defineConfig, devices } from '@playwright/test';

/**
 * doc2test skill 生成的默认 Playwright 配置。
 * 可按项目情况修改 baseURL，但目录结构必须与
 * skill 的 conventions/artifacts-layout.md 保持一致。
 */
export default defineConfig({
  testDir: './test/playwright/specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ['html', { outputFolder: process.env.PW_HTML_OUT ?? 'playwright-report', open: 'never' }],
    ['json', { outputFile: process.env.PW_JSON_OUT ?? 'playwright-results.json' }],
    ['list'],
  ],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
