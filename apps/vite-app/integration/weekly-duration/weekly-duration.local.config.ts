import path from "node:path";
import { defineConfig, devices, webkit } from "@playwright/test";

const webPort = 4175;
const apiPort = 18183;

export default defineConfig({
  testDir: path.resolve(__dirname),
  globalSetup: "./weekly-duration.local.runner.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `https://127.0.0.1:${webPort}`,
    ignoreHTTPSErrors: true,
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        ...(process.platform === "darwin"
          ? {
              launchOptions: {
                executablePath: path.resolve(__dirname, "../../e2e/webkit-launch.sh"),
                env: {
                  ...process.env,
                  ECHOTALK_E2E_WEBKIT_EXECUTABLE: webkit.executablePath(),
                },
              },
            }
          : {}),
      },
    },
  ],
  metadata: {
    apiPort,
    webPort,
  },
});
