import type { PlatformDetectionOptions, PlatformType } from "./types";

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

interface WindowWithPlatform {
  Capacitor?: CapacitorGlobal;
  __TAURI_INTERNALS__?: unknown;
  __TAURI__?: unknown;
}

/**
 * 检测当前运行平台。
 * 支持测试依赖注入，并在无 window / navigator 环境（如 SSR）下安全回退到 "web"。
 */
export function detectPlatform(options?: PlatformDetectionOptions): PlatformType {
  const currentWindow =
    options?.window !== undefined
      ? (options.window as WindowWithPlatform | undefined)
      : typeof window !== "undefined"
        ? (window as unknown as WindowWithPlatform)
        : undefined;

  if (!currentWindow) {
    return "web";
  }

  // 1. Capacitor 容器检测
  const cap = currentWindow.Capacitor;
  if (cap?.isNativePlatform?.()) {
    const platform = cap.getPlatform?.();
    if (platform === "ios" || platform === "android") {
      return platform;
    }
  }

  // 2. Tauri 容器检测
  if (currentWindow.__TAURI_INTERNALS__ || currentWindow.__TAURI__) {
    const currentNavigator =
      options?.navigator !== undefined
        ? options.navigator
        : typeof navigator !== "undefined"
          ? navigator
          : undefined;
    const userAgent = currentNavigator?.userAgent?.toLowerCase() ?? "";
    if (userAgent.includes("win")) {
      return "windows";
    }
    return "macos";
  }

  return "web";
}

/**
 * 判断是否处于原生 App 容器 (Capacitor 或 Tauri)
 */
export function isNativePlatform(
  platformOrOptions?: PlatformType | PlatformDetectionOptions,
): boolean {
  if (typeof platformOrOptions === "string") {
    return platformOrOptions !== "web";
  }
  return detectPlatform(platformOrOptions) !== "web";
}
