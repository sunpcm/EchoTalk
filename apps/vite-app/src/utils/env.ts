/**
 * 跨平台环境探测与 BaseURL 解析工具。
 */

export type PlatformType = "ios" | "android" | "macos" | "windows" | "web";

/** 检测当前运行平台 */
export function detectPlatform(): PlatformType {
  const cap = (
    window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    }
  ).Capacitor;

  if (cap?.isNativePlatform?.()) {
    const p = cap.getPlatform?.();
    if (p === "ios" || p === "android") return p;
  }

  const win = window as unknown as { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  if (win.__TAURI_INTERNALS__ || win.__TAURI__) {
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes("win")) return "windows";
    return "macos";
  }

  return "web";
}

/** 是否处于原生 App 容器 (Capacitor 或 Tauri) */
export function isNativePlatform(): boolean {
  return detectPlatform() !== "web";
}

/** 获取 API Base URL (末尾自动对齐 /api，支持 DEV 覆盖与原生 Fail-Fast) */
export function getApiBaseUrl(): string {
  const platform = detectPlatform();
  const isNative = platform !== "web";

  // 1. 仅在开发环境下允许通过 localStorage 进行本地局域网调试覆盖 (需加 /api)
  if (import.meta.env.DEV) {
    const devHost = localStorage.getItem("dev_server_host");
    if (devHost && /^https?:\/\/.+/.test(devHost)) {
      return `${devHost.replace(/\/+$/, "")}/api`;
    }
  }

  // 2. 生产环境读取注入的 VITE_API_BASE_URL (如 https://api.echotalk.com，自动补齐 /api)
  const envUrl = import.meta.env.VITE_API_BASE_URL;
  if (envUrl && typeof envUrl === "string" && /^https?:\/\/.+/.test(envUrl)) {
    return `${envUrl.replace(/\/+$/, "")}/api`;
  }

  // 3. 原生环境无配置时 Fail-Fast 报警 (在 API 请求时被 catch，不会在首帧加载期让页面变砖)
  if (isNative) {
    throw new Error("[EchoTalk] 原生环境未配置有效的 VITE_API_BASE_URL");
  }

  // 4. Web 端默认相对路径 /api (与 api.ts 路由无缝匹配)
  return "/api";
}
