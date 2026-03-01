import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  // Turbo may treat different env vars as cache hits unless we include them in task inputs.
  // Also, Vite clears outDir by default; to ensure our report artifact doesn't get deleted,
  // we emit it outside dist and treat it as a separate output.
  plugins: [
    react(),
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
    port: 5173,
    proxy: {
      // EchoTalk FastAPI 后端 (localhost:8000)
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
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
});
