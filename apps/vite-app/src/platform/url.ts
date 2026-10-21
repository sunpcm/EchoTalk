import { detectPlatform, isNativePlatform } from "./detection";
import { type ApiBaseUrlOptions, type LiveKitUrlOptions, PlatformConfigError } from "./types";

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
    throw new PlatformConfigError("[EchoTalk] API 地址不能为空");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new PlatformConfigError("[EchoTalk] 非法的 API 地址");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PlatformConfigError("[EchoTalk] API 地址仅支持 HTTP/HTTPS 协议");
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new PlatformConfigError("[EchoTalk] API 地址禁止包含用户名或密码");
  }

  if (parsed.search !== "") {
    throw new PlatformConfigError("[EchoTalk] API 地址禁止包含 Query 参数");
  }

  if (parsed.hash !== "") {
    throw new PlatformConfigError("[EchoTalk] API 地址禁止包含 Hash 片段");
  }

  // 统一去除 pathname 末尾斜杠后进行路径范围校验
  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  if (normalizedPath !== "" && normalizedPath !== "/api") {
    throw new PlatformConfigError("[EchoTalk] API 地址仅支持根路径或 /api 前缀，不支持其他路径");
  }

  if (isNative && !isDev && parsed.protocol !== "https:") {
    throw new PlatformConfigError("[EchoTalk] 生产原生环境仅允许 HTTPS API 地址");
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
        throw new PlatformConfigError("[EchoTalk] dev_server_host 覆盖配置不能为空");
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
      throw new PlatformConfigError("[EchoTalk] 原生环境未配置有效的 VITE_API_BASE_URL");
    }
    throw new PlatformConfigError("[EchoTalk] 显式配置的 VITE_API_BASE_URL 不能为空");
  }

  // 3. 原生无配置时 Fail-Fast 报错
  if (isNative) {
    throw new PlatformConfigError("[EchoTalk] 原生环境未配置有效的 VITE_API_BASE_URL");
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
    throw new PlatformConfigError("[EchoTalk] LiveKit WebSocket 地址不能为空");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new PlatformConfigError("[EchoTalk] 非法的 LiveKit WebSocket 地址");
  }

  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new PlatformConfigError("[EchoTalk] LiveKit 仅允许 ws:// 或 wss:// 协议");
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new PlatformConfigError("[EchoTalk] LiveKit 地址禁止包含用户名或密码");
  }

  if (parsed.hash !== "") {
    throw new PlatformConfigError("[EchoTalk] LiveKit 地址禁止包含 Hash 片段");
  }

  if (isNative && !isDev && parsed.protocol !== "wss:") {
    throw new PlatformConfigError("[EchoTalk] 生产原生环境仅允许使用 wss:// 协议连接 LiveKit");
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
        throw new PlatformConfigError("[EchoTalk] Web 直连模式未配置有效的 LiveKit 地址");
      }
    } else {
      const pageLocation =
        options?.location !== undefined
          ? options.location
          : typeof window !== "undefined"
            ? window.location
            : null;
      if (!pageLocation?.host) {
        throw new PlatformConfigError("[EchoTalk] 无法获取当前页面 location 构造代理地址");
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
        throw new PlatformConfigError("[EchoTalk] 原生直连模式未配置有效的 LiveKit 地址");
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
