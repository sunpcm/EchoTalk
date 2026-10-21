import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import path from "path";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig(({ command, mode }) => {
  // serve 沿用根目录 envDir，保持既有本地开发与代理配置；build 严格限定在当前 app 目录实现构建隔离，不读取根目录 .env
  const isServe = command === "serve";
  const repoRoot = path.resolve(__dirname, "../..");
  const envDir = isServe ? repoRoot : __dirname;

  const env = loadEnv(mode, envDir, "");
  const lkTarget = env.LIVEKIT_URL
    ? env.LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://")
    : undefined;
  const apiTarget = process.env.E2E_API_URL ?? "http://localhost:8000";

  return {
    envDir,
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
