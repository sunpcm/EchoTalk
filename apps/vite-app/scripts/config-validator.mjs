/**
 * 跨平台/环境构建配置校验与 Manifest 生成
 * 遵守 docs/CROSS_PLATFORM_ARCHITECTURE.md §8.2 契约
 */

export const ALLOWED_PLATFORMS = Object.freeze(["web", "ios"]);
export const ALLOWED_MODES = Object.freeze(["development", "staging", "production"]);

export class BuildValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "BuildValidationError";
  }
}

/**
 * 校验 API URL 格式（纯函数，静态校验，不联网）
 */
export function validateApiUrl(rawUrl, { requireHttps = false } = {}) {
  const trimmed = (rawUrl || "").trim();
  if (!trimmed) {
    throw new BuildValidationError("[EchoTalk Build] API 地址不能为空");
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BuildValidationError("[EchoTalk Build] 非法的 API 地址格式");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BuildValidationError("[EchoTalk Build] API 地址仅支持 HTTP/HTTPS 协议");
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new BuildValidationError("[EchoTalk Build] API 地址禁止包含用户名或密码");
  }

  if (parsed.search !== "") {
    throw new BuildValidationError("[EchoTalk Build] API 地址禁止包含 Query 参数");
  }

  if (parsed.hash !== "") {
    throw new BuildValidationError("[EchoTalk Build] API 地址禁止包含 Hash 片段");
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, "");
  if (normalizedPath !== "" && normalizedPath !== "/api") {
    throw new BuildValidationError(
      "[EchoTalk Build] API 地址仅支持根路径或 /api 前缀，不支持其他路径",
    );
  }

  if (requireHttps && parsed.protocol !== "https:") {
    throw new BuildValidationError("[EchoTalk Build] 生产/预发布环境 API 地址必须使用 HTTPS 协议");
  }

  return parsed.origin;
}

/**
 * 校验构建配置
 */
export function validateBuildConfig({ platform, mode, env = {}, rawArgs = [] }) {
  if (!ALLOWED_PLATFORMS.includes(platform)) {
    throw new BuildValidationError(
      `[EchoTalk Build] 不支持的构建平台: "${platform}"，仅支持: ${ALLOWED_PLATFORMS.join(", ")}`,
    );
  }

  if (!ALLOWED_MODES.includes(mode)) {
    throw new BuildValidationError(
      `[EchoTalk Build] 不支持的构建模式: "${mode}"，仅支持: ${ALLOWED_MODES.join(", ")}`,
    );
  }

  // 严禁在 production 构建中通过 --mode development 旁路
  if (mode === "production") {
    const hasDevBypass = rawArgs.some(
      (arg, idx) =>
        arg === "--mode=development" || (arg === "--mode" && rawArgs[idx + 1] === "development"),
    );
    if (hasDevBypass) {
      throw new BuildValidationError(
        "[EchoTalk Build] 禁止在 production 构建中使用 --mode development 旁路",
      );
    }
  }

  const authMode = env.VITE_AUTH_MODE;
  const devToken = env.VITE_DEV_AUTH_TOKEN;
  const hasDevToken = typeof devToken === "string" && devToken.trim().length > 0;

  // 针对 iOS 平台的 production 与 staging 校验
  if (platform === "ios" && (mode === "production" || mode === "staging")) {
    if (hasDevToken) {
      throw new BuildValidationError(
        `[EchoTalk Build] ${mode} 环境下的 iOS 构建禁止配置 VITE_DEV_AUTH_TOKEN`,
      );
    }

    if (authMode !== "oidc") {
      throw new BuildValidationError(
        `[EchoTalk Build] ${mode} 环境下的 iOS 构建必须使用 OIDC 认证 (VITE_AUTH_MODE=oidc)，禁止使用 ${authMode || "未配置"}`,
      );
    }

    const apiBaseUrl = env.VITE_API_BASE_URL;
    if (!apiBaseUrl || !apiBaseUrl.trim()) {
      throw new BuildValidationError(
        `[EchoTalk Build] ${mode} 环境下的 iOS 构建必须配置 VITE_API_BASE_URL`,
      );
    }
    validateApiUrl(apiBaseUrl, { requireHttps: true });

    const authority = env.VITE_OIDC_AUTHORITY;
    if (!authority || !authority.trim()) {
      throw new BuildValidationError(
        `[EchoTalk Build] ${mode} 环境下的 iOS 构建必须配置 VITE_OIDC_AUTHORITY`,
      );
    }
    try {
      const authUrl = new URL(authority.trim());
      if (authUrl.protocol !== "https:") {
        throw new BuildValidationError(
          `[EchoTalk Build] ${mode} 环境下的 iOS 构建 VITE_OIDC_AUTHORITY 必须为 HTTPS`,
        );
      }
    } catch (err) {
      if (err instanceof BuildValidationError) throw err;
      throw new BuildValidationError(
        `[EchoTalk Build] ${mode} 环境下的 iOS 构建 VITE_OIDC_AUTHORITY 格式非法`,
      );
    }

    const clientId = env.VITE_OIDC_CLIENT_ID;
    if (!clientId || !clientId.trim()) {
      throw new BuildValidationError(
        `[EchoTalk Build] ${mode} 环境下的 iOS 构建必须配置 VITE_OIDC_CLIENT_ID`,
      );
    }

    const redirectUri = env.VITE_OIDC_REDIRECT_URI;
    if (!redirectUri || !redirectUri.trim()) {
      throw new BuildValidationError(
        `[EchoTalk Build] ${mode} 环境下的 iOS 构建必须配置 VITE_OIDC_REDIRECT_URI`,
      );
    }
  }

  // 针对 Web 平台的 production 校验
  if (platform === "web" && mode === "production") {
    if (authMode === "dev" || hasDevToken) {
      throw new BuildValidationError(
        "[EchoTalk Build] production 环境下的 Web 构建禁止使用 dev 认证或配置 VITE_DEV_AUTH_TOKEN",
      );
    }
  }

  return true;
}

/**
 * 生成构建产物 Manifest 数据（绝对不含任何 Token、密码或私钥秘密）
 * 真实记录字段，不伪造默认认证模式
 */
export function createManifest({ platform, mode, env = {} }) {
  let apiOrigin = "";
  if (env.VITE_API_BASE_URL && env.VITE_API_BASE_URL.trim()) {
    try {
      const u = new URL(env.VITE_API_BASE_URL.trim());
      apiOrigin = u.origin;
    } catch {
      apiOrigin = "";
    }
  }

  // 真实记录环境变量中的 authMode，绝不冒充或自动伪造 oidc 默认值
  const authMode = env.VITE_AUTH_MODE || "";

  return {
    platform,
    mode,
    apiOrigin,
    authMode,
    builtAt: new Date().toISOString(),
    success: true,
  };
}

/**
 * 严格校验 iOS 同步所需的 Manifest Schema
 */
export function validateManifestSchema(manifest, expectedMode) {
  if (!manifest || typeof manifest !== "object") {
    throw new BuildValidationError("[EchoTalk Sync] 构建标识 manifest 格式非法");
  }

  if (manifest.success !== true) {
    throw new BuildValidationError("[EchoTalk Sync] 产物标识记录未成功构建，禁止同步。");
  }

  if (manifest.platform !== "ios") {
    throw new BuildValidationError(
      `[EchoTalk Sync] 产物平台不匹配: 期望 "ios"，实际为 "${manifest.platform}"。禁止将 Web 产物同步至 iOS。`,
    );
  }

  if (manifest.mode !== expectedMode) {
    throw new BuildValidationError(
      `[EchoTalk Sync] 产物模式不匹配: 期望 "${expectedMode}"，实际为 "${manifest.mode}"。禁止跨模式同步。`,
    );
  }

  if (!manifest.builtAt || typeof manifest.builtAt !== "string") {
    throw new BuildValidationError("[EchoTalk Sync] 构建标识缺失 builtAt 字段");
  }

  if (typeof manifest.authMode !== "string" || !manifest.authMode.trim()) {
    throw new BuildValidationError("[EchoTalk Sync] 构建标识缺失 authMode 元数据配置");
  }

  if (typeof manifest.apiOrigin !== "string" || !manifest.apiOrigin.trim()) {
    throw new BuildValidationError("[EchoTalk Sync] 构建标识缺失 apiOrigin 元数据配置");
  }

  if (expectedMode === "production" || expectedMode === "staging") {
    if (manifest.authMode !== "oidc") {
      throw new BuildValidationError(
        `[EchoTalk Sync] ${expectedMode} 环境产物必须配置 OIDC 认证 (VITE_AUTH_MODE=oidc)，实际为 "${manifest.authMode}"`,
      );
    }

    try {
      const parsedOrigin = new URL(manifest.apiOrigin);
      if (parsedOrigin.protocol !== "https:") {
        throw new Error();
      }
    } catch {
      throw new BuildValidationError(
        `[EchoTalk Sync] ${expectedMode} 环境产物 API Origin 必须使用 HTTPS 协议，实际为 "${manifest.apiOrigin}"`,
      );
    }
  } else if (expectedMode === "development") {
    if (!["dev", "oidc"].includes(manifest.authMode)) {
      throw new BuildValidationError(
        `[EchoTalk Sync] development 环境产物认证模式非法: "${manifest.authMode}"`,
      );
    }
  }

  return true;
}
