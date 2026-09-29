import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import path from "path";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig(({ command, mode }) => {
  const rootDir = path.resolve(__dirname, "../..");
  // 开发时从根目录 .env 读取与后端一致的本地认证配置。
  const rootEnv = loadEnv(mode, rootDir, "");
  const lkTarget = rootEnv.LIVEKIT_URL
    ? rootEnv.LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://")
    : undefined;
  const apiTarget = process.env.E2E_API_URL ?? "http://localhost:8000";

  return {
    envDir: command === "serve" ? rootDir : __dirname,
    // Turbo may treat different env vars as cache hits unless we include them in task inputs.
    // Also, Vite clears outDir by default; to ensure our report artifact doesn't get deleted,
    // we emit it outside dist and treat it as a separate output.
    plugins: [
      react(),
      basicSsl(),
      ...(process.env.ANALYZE === "true"
        ? [
            visualizer({
              open: false,
              gzipSize: true,
              brotliSize: true,
              filename: "stats.html",
            }),
          ]
        : []),
    ],
    server: {
      host: "127.0.0.1", // 默认只允许本机访问；局域网调试需显式使用 --host
      port: 5173,
      proxy: {
        // EchoTalk FastAPI 后端 (localhost:8000)
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
        // 代理 LiveKit WebSocket，解决浏览器无法直连 LiveKit Cloud WSS 的问题
        // 同时绕过 SDK 的 region routing（代理 URL 不含 .livekit.cloud）
        ...(lkTarget && {
          "/livekit-ws": {
            target: lkTarget,
            ws: true,
            changeOrigin: true,
            rewrite: (p: string) => p.replace(/^\/livekit-ws/, ""),
          },
        }),
      },
      warmup: {
        clientFiles: ["./index.html", "./src/index.tsx"],
      },
    },
    // 解析
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },

    //构建 - 对应 Webpack 的 output
    build: {
      outDir: "dist",
      minify: "esbuild", // 默认使用 esbuild，速度快
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ["react", "react-dom"],
          },
        },
      },
    },
    optimizeDeps: {
      include: ["react", "react-dom", "@biu/ui-lib"],
    },
  };
});
