import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(here, "../.."),
  // 禁止 dotenv：不读任何 .env 文件；API base 由 jsdom Web 缺省内联为 "/api"
  envDir: false,
  define: {
    // 与 .env.development 的 VITE_API_URL=/api 等价的内联合成值，不读 dotenv
    "import.meta.env.VITE_API_URL": JSON.stringify("/api"),
  },
  resolve: {
    alias: {
      "@": path.resolve(here, "../../src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    fileParallelism: false,
    testTimeout: 60000,
    include: ["integration/call-lease/call-lease.local.spec.ts"],
    env: {
      ECHOTALK_CALL_LEASE_LOCAL_PG: "1",
    },
  },
});
