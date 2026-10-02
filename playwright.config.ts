import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3100',
    headless: true,
    launchOptions: process.env.CHROMIUM_EXECUTABLE
      ? {
          executablePath: process.env.CHROMIUM_EXECUTABLE,
          args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
          ],
        }
      : {},
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1050 } } },
    {
      name: 'phone',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      name: 'tablet',
      use: { viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: 'node --import tsx tests/browser/serve.ts',
    url: 'http://localhost:3100/healthz',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
