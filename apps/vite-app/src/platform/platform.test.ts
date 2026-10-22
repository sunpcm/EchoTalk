import { describe, it, expect, afterEach, vi } from "vitest";
import {
  detectPlatform,
  isNativePlatform,
  resolveApiBaseUrl,
  validateAndNormalizeApiUrl,
  validateAndNormalizeWsUrl,
  resolveLiveKitUrl,
  getLiveKitWsUrl,
  PlatformConfigError,
} from "./index";

describe("Platform Adapter - Detection", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should return 'web' in SSR context where window is undefined", () => {
    vi.stubGlobal("window", undefined);
    expect(detectPlatform()).toBe("web");
    expect(isNativePlatform()).toBe(false);
  });

  it("should default to 'macos' for Tauri when navigator is undefined", () => {
    vi.stubGlobal("navigator", undefined);
    const fakeWindow = { __TAURI__: {} };
    expect(detectPlatform({ window: fakeWindow })).toBe("macos");
  });

  it("should return 'web' in SSR context where navigator is undefined", () => {
    vi.stubGlobal("navigator", undefined);
    expect(detectPlatform()).toBe("web");
    expect(isNativePlatform()).toBe(false);
  });

  it("should detect Capacitor ios and android platforms via injection", () => {
    const iosWindow = {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      },
    };
    expect(detectPlatform({ window: iosWindow })).toBe("ios");
    expect(isNativePlatform({ window: iosWindow })).toBe(true);

    const androidWindow = {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => "android",
      },
    };
    expect(detectPlatform({ window: androidWindow })).toBe("android");
    expect(isNativePlatform({ window: androidWindow })).toBe(true);
  });

  it("should fall back to web when Capacitor isNativePlatform is false or unknown platform", () => {
    const notNativeWindow = {
      Capacitor: {
        isNativePlatform: () => false,
        getPlatform: () => "ios",
      },
    };
    expect(detectPlatform({ window: notNativeWindow })).toBe("web");

    const unknownWindow = {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => "electron",
      },
    };
    expect(detectPlatform({ window: unknownWindow })).toBe("web");
  });

  it("should detect Tauri windows and macos platforms via userAgent injection", () => {
    const tauriWindow = { __TAURI__: {} };
    expect(
      detectPlatform({
        window: tauriWindow,
        navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
      }),
    ).toBe("windows");

    const tauriInternalsWindow = { __TAURI_INTERNALS__: {} };
    expect(
      detectPlatform({
        window: tauriInternalsWindow,
        navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
      }),
    ).toBe("macos");
  });
});

describe("Platform Adapter - API Base URL Validation and Normalization", () => {
  it("should unify origin and /api trailing slashes to single /api", () => {
    expect(validateAndNormalizeApiUrl("https://api.echotalk.com", false, false)).toBe(
      "https://api.echotalk.com/api",
    );
    expect(validateAndNormalizeApiUrl("https://api.echotalk.com/", false, false)).toBe(
      "https://api.echotalk.com/api",
    );
    expect(validateAndNormalizeApiUrl("https://api.echotalk.com/api", false, false)).toBe(
      "https://api.echotalk.com/api",
    );
    expect(validateAndNormalizeApiUrl("https://api.echotalk.com/api/", false, false)).toBe(
      "https://api.echotalk.com/api",
    );
    expect(validateAndNormalizeApiUrl("https://api.echotalk.com/api///", false, false)).toBe(
      "https://api.echotalk.com/api",
    );
  });

  it("should reject non-empty pathname other than /api", () => {
    expect(() => validateAndNormalizeApiUrl("https://api.echotalk.com/v1", false, false)).toThrow(
      PlatformConfigError,
    );
    expect(() =>
      validateAndNormalizeApiUrl("https://api.echotalk.com/api/v1", false, false),
    ).toThrow(PlatformConfigError);
    expect(() =>
      validateAndNormalizeApiUrl("https://api.echotalk.com/custom/path", false, false),
    ).toThrow(PlatformConfigError);
  });

  it("should reject query parameters", () => {
    expect(() =>
      validateAndNormalizeApiUrl("https://api.echotalk.com?query=true", false, false),
    ).toThrow("Query 参数");
    expect(() =>
      validateAndNormalizeApiUrl("https://api.echotalk.com/api?debug=1", false, false),
    ).toThrow("Query 参数");
  });

  it("should reject hash fragments", () => {
    expect(() =>
      validateAndNormalizeApiUrl("https://api.echotalk.com#anchor", false, false),
    ).toThrow("Hash 片段");
    expect(() =>
      validateAndNormalizeApiUrl("https://api.echotalk.com/api#top", false, false),
    ).toThrow("Hash 片段");
  });

  it("should reject credentials in URL", () => {
    expect(() =>
      validateAndNormalizeApiUrl("https://admin:secret@api.echotalk.com", false, false),
    ).toThrow("用户名或密码");
  });

  it("should reject unsupported protocols and malformed URLs", () => {
    expect(() => validateAndNormalizeApiUrl("ftp://api.echotalk.com", false, false)).toThrow(
      "仅支持 HTTP/HTTPS 协议",
    );
    expect(() => validateAndNormalizeApiUrl("ws://api.echotalk.com", false, false)).toThrow(
      "仅支持 HTTP/HTTPS 协议",
    );
    expect(() => validateAndNormalizeApiUrl("not-a-valid-url", false, false)).toThrow(
      "非法的 API 地址",
    );
    expect(() => validateAndNormalizeApiUrl("   ", false, false)).toThrow("API 地址不能为空");
  });

  it("should enforce HTTPS in production native, but allow HTTP in DEV mode", () => {
    expect(() => validateAndNormalizeApiUrl("http://api.echotalk.com", true, false)).toThrow(
      "生产原生环境仅允许 HTTPS API 地址",
    );

    expect(validateAndNormalizeApiUrl("https://api.echotalk.com", true, false)).toBe(
      "https://api.echotalk.com/api",
    );

    expect(validateAndNormalizeApiUrl("http://192.168.1.100:8000", true, true)).toBe(
      "http://192.168.1.100:8000/api",
    );
  });

  it("should not leak sensitive credentials or query parameters in error messages", () => {
    const sensitiveUrlWithCredentials =
      "https://admin:super_secret_password_123@api.echotalk.com/api";
    try {
      validateAndNormalizeApiUrl(sensitiveUrlWithCredentials, false, false);
      expect.fail("Should have thrown PlatformConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformConfigError);
      const message = (err as Error).message;
      expect(message).not.toContain("super_secret_password_123");
      expect(message).not.toContain("admin");
      expect(message).not.toContain("api.echotalk.com");
    }

    const sensitiveUrlWithQuery =
      "https://api.echotalk.com/api?access_token=super_secret_token_456";
    try {
      validateAndNormalizeApiUrl(sensitiveUrlWithQuery, false, false);
      expect.fail("Should have thrown PlatformConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformConfigError);
      const message = (err as Error).message;
      expect(message).not.toContain("super_secret_token_456");
      expect(message).not.toContain("access_token");
      expect(message).not.toContain("api.echotalk.com");
    }

    const malformedSensitiveUrl = "not a valid url with sensitive info: secret_password_789";
    try {
      validateAndNormalizeApiUrl(malformedSensitiveUrl, false, false);
      expect.fail("Should have thrown PlatformConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformConfigError);
      const message = (err as Error).message;
      expect(message).not.toContain("secret_password_789");
    }
  });
});

describe("Platform Adapter - resolveApiBaseUrl", () => {
  it("should default to /api for web platform when no config is provided", () => {
    expect(resolveApiBaseUrl({ platform: "web", isDev: false })).toBe("/api");
    expect(resolveApiBaseUrl({ platform: "web", isDev: true })).toBe("/api");
  });

  it("should throw in native platform when VITE_API_BASE_URL is missing", () => {
    expect(() => resolveApiBaseUrl({ platform: "ios", isDev: false })).toThrow(
      "[EchoTalk] 原生环境未配置有效的 VITE_API_BASE_URL",
    );
    expect(() => resolveApiBaseUrl({ platform: "android", isDev: true })).toThrow(
      "[EchoTalk] 原生环境未配置有效的 VITE_API_BASE_URL",
    );
  });

  it("should apply valid DEV localStorage override in DEV mode", () => {
    const mockStorage = {
      getItem: (key: string) => (key === "dev_server_host" ? "http://192.168.1.150:8000" : null),
    };

    expect(
      resolveApiBaseUrl({
        platform: "ios",
        isDev: true,
        storage: mockStorage,
      }),
    ).toBe("http://192.168.1.150:8000/api");
  });

  it("should throw when DEV localStorage override is present but invalid (no fallback)", () => {
    const mockStorage = {
      getItem: (key: string) => (key === "dev_server_host" ? "invalid://url" : null),
    };

    expect(() =>
      resolveApiBaseUrl({
        platform: "web",
        isDev: true,
        storage: mockStorage,
      }),
    ).toThrow(PlatformConfigError);
  });

  it("should ignore DEV localStorage override in production mode", () => {
    const mockStorage = {
      getItem: (key: string) => (key === "dev_server_host" ? "http://192.168.1.150:8000" : null),
    };

    expect(
      resolveApiBaseUrl({
        platform: "web",
        isDev: false,
        storage: mockStorage,
      }),
    ).toBe("/api");
  });

  it("should not crash when storage access throws an exception", () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error("QuotaExceeded or SecurityError");
      },
    };

    expect(
      resolveApiBaseUrl({
        platform: "web",
        isDev: true,
        storage: throwingStorage,
      }),
    ).toBe("/api");
  });

  it("should throw when explicit VITE_API_BASE_URL is invalid, instead of falling back", () => {
    expect(() =>
      resolveApiBaseUrl({
        platform: "web",
        isDev: false,
        envApiBaseUrl: "invalid-url",
      }),
    ).toThrow(PlatformConfigError);

    expect(() =>
      resolveApiBaseUrl({
        platform: "web",
        isDev: false,
        envApiBaseUrl: "",
      }),
    ).toThrow(PlatformConfigError);
  });
});

describe("Platform Adapter - LiveKit URL Resolution", () => {
  it("should default to current origin /livekit-ws in Web proxy mode", () => {
    const httpsResult = resolveLiveKitUrl({
      platform: "web",
      isDev: false,
      direct: false,
      location: { protocol: "https:", host: "echotalk.example.com" },
    });
    expect(httpsResult).toBe("wss://echotalk.example.com/livekit-ws");

    const httpResult = resolveLiveKitUrl({
      platform: "web",
      isDev: true,
      direct: false,
      location: { protocol: "http:", host: "localhost:5173" },
    });
    expect(httpResult).toBe("ws://localhost:5173/livekit-ws");
  });

  it("should use token ws_url or VITE_LIVEKIT_URL in Web direct mode (DIRECT=true)", () => {
    const tokenResult = resolveLiveKitUrl({
      platform: "web",
      direct: true,
      tokenWsUrl: "wss://livekit.cloud.example.com",
    });
    expect(tokenResult).toBe("wss://livekit.cloud.example.com/");

    const envResult = resolveLiveKitUrl({
      platform: "web",
      direct: true,
      tokenWsUrl: null,
      envLiveKitUrl: "wss://env-livekit.example.com",
    });
    expect(envResult).toBe("wss://env-livekit.example.com/");
  });

  it("should throw in Web direct mode when both sources are missing", () => {
    expect(() =>
      resolveLiveKitUrl({
        platform: "web",
        direct: true,
        tokenWsUrl: null,
        envLiveKitUrl: null,
      }),
    ).toThrow("Web 直连模式未配置有效的 LiveKit 地址");
  });

  it("should default to direct connection in Native platform", () => {
    const nativeDirect = resolveLiveKitUrl({
      platform: "ios",
      isDev: false,
      forceProxy: false,
      tokenWsUrl: "wss://livekit.cloud.example.com",
    });
    expect(nativeDirect).toBe("wss://livekit.cloud.example.com/");
  });

  it("should construct /livekit-ws from API origin when FORCE_PROXY=true in Native", () => {
    const proxyResult = resolveLiveKitUrl({
      platform: "ios",
      isDev: false,
      forceProxy: true,
      apiBaseUrl: "https://api.echotalk.com/api",
      location: { protocol: "http:", host: "localhost" }, // simulated WebView localhost
    });
    expect(proxyResult).toBe("wss://api.echotalk.com/livekit-ws");

    const devProxyResult = resolveLiveKitUrl({
      platform: "android",
      isDev: true,
      forceProxy: true,
      apiBaseUrl: "http://10.0.2.2:8000/api",
      location: { protocol: "http:", host: "localhost" },
    });
    expect(devProxyResult).toBe("ws://10.0.2.2:8000/livekit-ws");
  });

  it("should validate LiveKit URL protocols and reject invalid schemes", () => {
    expect(() => validateAndNormalizeWsUrl("https://livekit.com", false, false)).toThrow(
      "仅允许 ws:// 或 wss:// 协议",
    );
    expect(() => validateAndNormalizeWsUrl("http://livekit.com", false, false)).toThrow(
      "仅允许 ws:// 或 wss:// 协议",
    );
    expect(() => validateAndNormalizeWsUrl("javascript:void(0)", false, false)).toThrow(
      "仅允许 ws:// 或 wss:// 协议",
    );
  });

  it("should reject credentials and hash in LiveKit WebSocket URL", () => {
    expect(() =>
      validateAndNormalizeWsUrl("wss://user:pass@livekit.example.com", false, false),
    ).toThrow("禁止包含用户名或密码");

    expect(() =>
      validateAndNormalizeWsUrl("wss://livekit.example.com#section", false, false),
    ).toThrow("禁止包含 Hash 片段");
  });

  it("should not leak sensitive credentials in LiveKit WS error messages", () => {
    const sensitiveWsUrl = "wss://user:top_secret_pass_999@livekit.example.com";
    try {
      validateAndNormalizeWsUrl(sensitiveWsUrl, false, false);
      expect.fail("Should have thrown PlatformConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformConfigError);
      const message = (err as Error).message;
      expect(message).not.toContain("top_secret_pass_999");
      expect(message).not.toContain("user");
      expect(message).not.toContain("livekit.example.com");
    }

    const malformedWsUrl = "invalid ws url with top_secret_data_333";
    try {
      validateAndNormalizeWsUrl(malformedWsUrl, false, false);
      expect.fail("Should have thrown PlatformConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(PlatformConfigError);
      const message = (err as Error).message;
      expect(message).not.toContain("top_secret_data_333");
    }
  });

  it("should require WSS in production native, allowing WS in DEV", () => {
    expect(() => validateAndNormalizeWsUrl("ws://livekit.example.com", true, false)).toThrow(
      "生产原生环境仅允许使用 wss:// 协议连接 LiveKit",
    );

    expect(validateAndNormalizeWsUrl("wss://livekit.example.com", true, false)).toBe(
      "wss://livekit.example.com/",
    );

    expect(validateAndNormalizeWsUrl("ws://192.168.1.100:7880", true, true)).toBe(
      "ws://192.168.1.100:7880/",
    );
  });

  it("getLiveKitWsUrl should return null safely on errors without throwing", () => {
    expect(
      getLiveKitWsUrl({
        platform: "ios",
        isDev: false,
        envLiveKitUrl: "ws://insecure.example.com", // prod native rejects ws
      }),
    ).toBeNull();

    expect(
      getLiveKitWsUrl({
        platform: "ios",
        isDev: false,
        forceProxy: true,
        apiBaseUrl: undefined, // missing api base url in native
      }),
    ).toBeNull();
  });
});
