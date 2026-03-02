import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import path from "path";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig(({ mode }) => {
  // 读取 monorepo 根目录 .env 中的 LIVEKIT_URL，用于配置 WebSocket 代理
  const rootEnv = loadEnv(mode, path.resolve(__dirname, "../.."), "");
  const lkTarget = rootEnv.LIVEKIT_URL
    ? rootEnv.LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://")
    : undefined;

  return {
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
      host: true, // 监听 0.0.0.0，允许局域网访问
      port: 5173,
      proxy: {
        // EchoTalk FastAPI 后端 (localhost:8000)
        "/api": {
          target: "http://localhost:8000",
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
