import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  detectPlatform,
  isNativePlatform,
  getApiBaseUrl,
  resolveLiveKitUrl,
  getLiveKitWsUrl,
  PlatformConfigError,
} from "./env";

describe("env utils", () => {
  const originalUserAgent = navigator.userAgent;

  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();

    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    localStorage.clear();

    Object.defineProperty(navigator, "userAgent", {
      value: originalUserAgent,
      configurable: true,
      writable: true,
    });

    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_API_BASE_URL", undefined);
    vi.stubEnv("VITE_LIVEKIT_URL", undefined);
    vi.stubEnv("VITE_LIVEKIT_DIRECT", undefined);
    vi.stubEnv("VITE_LIVEKIT_FORCE_PROXY", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();

    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    localStorage.clear();

    Object.defineProperty(navigator, "userAgent", {
      value: originalUserAgent,
      configurable: true,
      writable: true,
    });
  });

  describe("detectPlatform", () => {
    it("should return 'ios' when Capacitor is native platform and returns 'ios'", () => {
      (window as unknown as { Capacitor: unknown }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };
      expect(detectPlatform()).toBe("ios");
    });

    it("should return 'android' when Capacitor is native platform and returns 'android'", () => {
      (window as unknown as { Capacitor: unknown }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "android",
      };
      expect(detectPlatform()).toBe("android");
    });

    it("should fall through when Capacitor platform is neither 'ios' nor 'android'", () => {
      (window as unknown as { Capacitor: unknown }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "web",
      };
      expect(detectPlatform()).toBe("web");
    });

    it("should fall through when Capacitor isNativePlatform returns false", () => {
      (window as unknown as { Capacitor: unknown }).Capacitor = {
        isNativePlatform: () => false,
        getPlatform: () => "ios",
      };
      expect(detectPlatform()).toBe("web");
    });

    it("should return 'windows' when __TAURI__ is defined and userAgent includes 'win'", () => {
      (window as unknown as { __TAURI__: unknown }).__TAURI__ = {};
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        configurable: true,
        writable: true,
      });
      expect(detectPlatform()).toBe("windows");
    });

    it("should return 'macos' when __TAURI_INTERNALS__ is defined and userAgent does not include 'win'", () => {
      (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        configurable: true,
        writable: true,
      });
      expect(detectPlatform()).toBe("macos");
    });

    it("should return 'web' by default when no native platforms are detected", () => {
      expect(detectPlatform()).toBe("web");
    });

    it("should safely return 'web' in SSR without window", () => {
      vi.stubGlobal("window", undefined);
      expect(detectPlatform()).toBe("web");
    });
  });

  describe("isNativePlatform", () => {
    it("should return true for native platforms (Capacitor or Tauri)", () => {
      (window as unknown as { Capacitor: unknown }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };
      expect(isNativePlatform()).toBe(true);
      expect(isNativePlatform("ios")).toBe(true);
      expect(isNativePlatform("android")).toBe(true);
      expect(isNativePlatform("macos")).toBe(true);
      expect(isNativePlatform("windows")).toBe(true);
    });

    it("should return false for web platform", () => {
      expect(isNativePlatform()).toBe(false);
      expect(isNativePlatform("web")).toBe(false);
    });
  });

  describe("getApiBaseUrl", () => {
    it("should return dev_server_host from localStorage in DEV mode if valid URL", () => {
      vi.stubEnv("DEV", true);
      localStorage.setItem("dev_server_host", "http://192.168.1.100:8000/");

      expect(getApiBaseUrl()).toBe("http://192.168.1.100:8000/api");
    });

    it("should throw error for invalid dev_server_host in localStorage during DEV mode (no fallback)", () => {
      vi.stubEnv("DEV", true);
      localStorage.setItem("dev_server_host", "invalid-host-url");

      expect(() => getApiBaseUrl()).toThrow(PlatformConfigError);
    });

    it("should ignore localStorage dev_server_host when not in DEV mode", () => {
      vi.stubEnv("DEV", false);
      localStorage.setItem("dev_server_host", "http://192.168.1.100:8000");

      expect(getApiBaseUrl()).toBe("/api");
    });

    it("should gracefully handle localStorage access errors without crashing", () => {
      vi.stubEnv("DEV", true);
      const restrictedStorage = {
        getItem: () => {
          throw new DOMException("Access is denied", "SecurityError");
        },
      };

      expect(getApiBaseUrl({ storage: restrictedStorage })).toBe("/api");
    });

    it("should return VITE_API_BASE_URL when specified and normalize origin /api", () => {
      vi.stubEnv("VITE_API_BASE_URL", "https://api.echotalk.com///");
      expect(getApiBaseUrl()).toBe("https://api.echotalk.com/api");

      vi.stubEnv("VITE_API_BASE_URL", "https://api.echotalk.com/api/");
      expect(getApiBaseUrl()).toBe("https://api.echotalk.com/api");
    });

    it("should throw error on native platform if VITE_API_BASE_URL is missing", () => {
      (window as unknown as { Capacitor: unknown }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "android",
      };

      expect(() => getApiBaseUrl()).toThrow("[EchoTalk] 原生环境未配置有效的 VITE_API_BASE_URL");
    });

    it("should throw error on native platform in production when HTTP is used", () => {
      (window as unknown as { Capacitor: unknown }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };
      vi.stubEnv("DEV", false);
      vi.stubEnv("VITE_API_BASE_URL", "http://api.echotalk.com");

      expect(() => getApiBaseUrl()).toThrow("生产原生环境仅允许 HTTPS API 地址");
    });

    it("should allow HTTP on native platform in DEV mode", () => {
      (window as unknown as { Capacitor: unknown }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };
      vi.stubEnv("DEV", true);
      vi.stubEnv("VITE_API_BASE_URL", "http://10.0.2.2:8000");

      expect(getApiBaseUrl()).toBe("http://10.0.2.2:8000/api");
    });

    it("should return '/api' on web platform when no DEV override or VITE_API_BASE_URL is set", () => {
      expect(getApiBaseUrl()).toBe("/api");
    });

    it("should reject illegal URL features (query, hash, userinfo, unsupported path)", () => {
      // Query
      vi.stubEnv("VITE_API_BASE_URL", "https://api.echotalk.com/api?trace=1");
      expect(() => getApiBaseUrl()).toThrow("Query 参数");

      // Hash
      vi.stubEnv("VITE_API_BASE_URL", "https://api.echotalk.com/api#debug");
      expect(() => getApiBaseUrl()).toThrow("Hash 片段");

      // Credentials
      vi.stubEnv("VITE_API_BASE_URL", "https://user:pass@api.echotalk.com/api");
      expect(() => getApiBaseUrl()).toThrow("用户名或密码");

      // Other pathname
      vi.stubEnv("VITE_API_BASE_URL", "https://api.echotalk.com/v1");
      expect(() => getApiBaseUrl()).toThrow("仅支持根路径或 /api 前缀");

      // Illegal URL format
      vi.stubEnv("VITE_API_BASE_URL", "not-a-url");
      expect(() => getApiBaseUrl()).toThrow("非法的 API 地址");
    });
  });

  describe("LiveKit exports", () => {
    it("should resolve Web default proxy livekit ws url", () => {
      const url = resolveLiveKitUrl({
        platform: "web",
        location: { protocol: "https:", host: "echotalk.com" },
      });
      expect(url).toBe("wss://echotalk.com/livekit-ws");
    });

    it("should safely return null via getLiveKitWsUrl on invalid configuration", () => {
      const result = getLiveKitWsUrl({
        platform: "ios",
        isDev: false,
        envLiveKitUrl: "ws://insecure-in-prod.com", // should fail in prod native
      });
      expect(result).toBeNull();
    });
  });
});
