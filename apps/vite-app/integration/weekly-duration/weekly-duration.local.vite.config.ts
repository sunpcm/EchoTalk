import path from "node:path";
import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_ORIGIN = "http://127.0.0.1:18183";
const WEB_PORT = 4175;

const configuredApiOrigin = process.env.E2E_API_URL;
if (configuredApiOrigin !== API_ORIGIN) {
  throw new Error(`E2E_API_URL must be ${API_ORIGIN}`);
}

export default defineConfig({
  envDir: false,
  plugins: [react(), basicSsl()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: WEB_PORT,
    strictPort: true,
    proxy: {
      "/api": {
        target: configuredApiOrigin,
        changeOrigin: true,
      },
    },
  },
});
