import { detectPlatform, isNativePlatform } from "./detection";
import { type ApiBaseUrlOptions, type LiveKitUrlOptions, PlatformConfigError } from "./types";
import { zhCN } from "@/i18n/zh-CN";

const platformConfigErrors = zhCN.platformConfigErrors;

/**
 * 校验并规范化 API URL。
 * - Origin 或以 /api 结尾（允许尾斜杠）统一为单个 /api
 * - 只支持空 pathname 或 /api，拒绝其他 path、query、hash、用户名密码及非法 URL
 * - 生产原生仅允许 HTTPS；DEV 允许 HTTP
 */
export function validateAndNormalizeApiUrl(
  rawUrl: string,
  isNative: boolean,
  isDev: boolean,
): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new PlatformConfigError(platformConfigErrors.apiEmpty);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new PlatformConfigError(platformConfigErrors.apiInvalid);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PlatformConfigError(platformConfigErrors.apiProtocol);
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new PlatformConfigError(platformConfigErrors.apiCredentials);
  }

  if (parsed.search !== "") {
    throw new PlatformConfigError(platformConfigErrors.apiQuery);
  }

  if (parsed.hash !== "") {
    throw new PlatformConfigError(platformConfigErrors.apiHash);
  }

  // 统一去除 pathname 末尾斜杠后进行路径范围校验
  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  if (normalizedPath !== "" && normalizedPath !== "/api") {
    throw new PlatformConfigError(platformConfigErrors.apiPath);
  }

  if (isNative && !isDev && parsed.protocol !== "https:") {
    throw new PlatformConfigError(platformConfigErrors.apiNativeHttps);
  }

  return `${parsed.origin}/api`;
}

/**
 * 解析 API Base URL。
 * - Web 缺省 /api
 * - 原生环境必须配置绝对 API 地址
 * - DEV 模式支持 localStorage dev_server_host 覆盖，覆盖非法时直接报错；storage 访问异常不使应用崩溃
 * - 显式配置无效时直接抛错，不隐式回退
 */
export function resolveApiBaseUrl(options?: ApiBaseUrlOptions): string {
  const platform = options?.platform ?? detectPlatform();
  const isNative = isNativePlatform(platform);
  const isDev = options?.isDev ?? Boolean(import.meta.env.DEV);

  // 1. DEV 模式下尝试读取 localStorage 覆盖
  if (isDev) {
    let devHost: string | null = null;
    try {
      const storage =
        options?.storage !== undefined
          ? options.storage
          : typeof window !== "undefined"
            ? window.localStorage
            : null;
      if (storage) {
        devHost = storage.getItem("dev_server_host");
      }
    } catch {
      // storage 访问异常（例如 iframe 限制或隐私模式），不使页面崩溃，降级为不覆盖
      devHost = null;
    }

    if (devHost !== null) {
      const trimmed = devHost.trim();
      if (!trimmed) {
        throw new PlatformConfigError(platformConfigErrors.devHostEmpty);
      }
      return validateAndNormalizeApiUrl(trimmed, isNative, true);
    }
  }

  // 2. 读取环境变量显式配置
  const envApiBaseUrl =
    options?.envApiBaseUrl !== undefined
      ? options.envApiBaseUrl
      : (import.meta.env.VITE_API_BASE_URL as string | undefined);

  if (envApiBaseUrl !== undefined && envApiBaseUrl !== null) {
    const trimmed = typeof envApiBaseUrl === "string" ? envApiBaseUrl.trim() : "";
    if (trimmed) {
      return validateAndNormalizeApiUrl(trimmed, isNative, isDev);
    }
    // 显式配置存在但为空字符串
    if (isNative) {
      throw new PlatformConfigError(platformConfigErrors.nativeApiMissing);
    }
    throw new PlatformConfigError(platformConfigErrors.apiExplicitEmpty);
  }

  // 3. 原生无配置时 Fail-Fast 报错
  if (isNative) {
    throw new PlatformConfigError(platformConfigErrors.nativeApiMissing);
  }

  // 4. Web 缺省相对路径 /api
  return "/api";
}

/** 获取 API Base URL (便捷包装，使用当前运行时上下文) */
export function getApiBaseUrl(options?: ApiBaseUrlOptions): string {
  return resolveApiBaseUrl(options);
}

/**
 * 校验并规范化 LiveKit WebSocket URL。
 * - 仅 ws/wss 合法，拒绝 credentials/hash
 * - 生产原生必须使用 wss
 */
export function validateAndNormalizeWsUrl(
  rawUrl: string,
  isNative: boolean,
  isDev: boolean,
): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new PlatformConfigError(platformConfigErrors.liveKitEmpty);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new PlatformConfigError(platformConfigErrors.liveKitInvalid);
  }

  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new PlatformConfigError(platformConfigErrors.liveKitProtocol);
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new PlatformConfigError(platformConfigErrors.liveKitCredentials);
  }

  if (parsed.hash !== "") {
    throw new PlatformConfigError(platformConfigErrors.liveKitHash);
  }

  if (isNative && !isDev && parsed.protocol !== "wss:") {
    throw new PlatformConfigError(platformConfigErrors.liveKitNativeWss);
  }

  return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
}

/**
 * 解析 LiveKit WebSocket URL。
 * - Web：默认使用当前页面 origin 的 /livekit-ws；DIRECT=true 才使用 token ws_url 或 VITE_LIVEKIT_URL
 * - 原生：默认直连 token ws_url 或 VITE_LIVEKIT_URL；FORCE_PROXY=true 时从 API origin 构造 /livekit-ws（杜绝 WebView localhost）
 * - 校验协议必须为 ws/wss，拒绝凭据/hash，生产原生强制 wss
 */
export function resolveLiveKitUrl(options?: LiveKitUrlOptions): string {
  const platform = options?.platform ?? detectPlatform();
  const isNative = isNativePlatform(platform);
  const isDev = options?.isDev ?? Boolean(import.meta.env.DEV);

  const direct =
    options?.direct !== undefined ? options.direct : import.meta.env.VITE_LIVEKIT_DIRECT === "true";

  const forceProxy =
    options?.forceProxy !== undefined
      ? options.forceProxy
      : import.meta.env.VITE_LIVEKIT_FORCE_PROXY === "true";

  const tokenWsUrl = options?.tokenWsUrl;
  const envLiveKitUrl =
    options?.envLiveKitUrl !== undefined
      ? options.envLiveKitUrl
      : (import.meta.env.VITE_LIVEKIT_URL as string | undefined);

  let candidate: string | null = null;

  if (!isNative) {
    // ===== Web 端 =====
    if (direct) {
      candidate = tokenWsUrl || envLiveKitUrl || null;
      if (!candidate) {
        throw new PlatformConfigError(platformConfigErrors.liveKitWebDirectMissing);
      }
    } else {
      const pageLocation =
        options?.location !== undefined
          ? options.location
          : typeof window !== "undefined"
            ? window.location
            : null;
      if (!pageLocation?.host) {
        throw new PlatformConfigError(platformConfigErrors.liveKitLocationMissing);
      }
      const wsProtocol = pageLocation.protocol === "https:" ? "wss:" : "ws:";
      candidate = `${wsProtocol}//${pageLocation.host}/livekit-ws`;
    }
  } else {
    // ===== 原生端 =====
    if (forceProxy) {
      let apiBase = options?.apiBaseUrl;
      if (!apiBase) {
        apiBase = resolveApiBaseUrl({ platform, isDev });
      }
      const apiUrl = new URL(apiBase);
      const wsProtocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
      candidate = `${wsProtocol}//${apiUrl.host}/livekit-ws`;
    } else {
      candidate = tokenWsUrl || envLiveKitUrl || null;
      if (!candidate) {
        throw new PlatformConfigError(platformConfigErrors.liveKitNativeDirectMissing);
      }
    }
  }

  return validateAndNormalizeWsUrl(candidate, isNative, isDev);
}

/**
 * 获取 LiveKit WebSocket URL (安全求值)。
 * 若配置无效或发生错误，返回 null，供调用方渲染受控错误卡片。
 */
export function getLiveKitWsUrl(options?: Partial<LiveKitUrlOptions>): string | null {
  try {
    return resolveLiveKitUrl(options);
  } catch {
    return null;
  }
}
