import { defineConfig, devices } from "@playwright/test";

const webPort = 4173;
const apiPort = 18181;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  webServer: [
    {
      command: "node e2e/fake-api.mjs",
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        ...process.env,
        E2E_API_PORT: String(apiPort),
      },
    },
    {
      command: `pnpm dev --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: `https://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 60_000,
      ignoreHTTPSErrors: true,
      env: {
        ...process.env,
        E2E_API_URL: `http://127.0.0.1:${apiPort}`,
        VITE_AUTH_MODE: "dev",
        VITE_DEV_AUTH_TOKEN: "e2e-dev-token",
      },
    },
  ],
  use: {
    baseURL: `https://127.0.0.1:${webPort}`,
    ignoreHTTPSErrors: true,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
