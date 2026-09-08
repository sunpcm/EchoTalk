import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { detectPlatform, isNativePlatform, getApiBaseUrl } from "./env";

describe("env utils", () => {
  const originalUserAgent = navigator.userAgent;
  const originalDev = import.meta.env.DEV;
  const originalViteApiBaseUrl = import.meta.env.VITE_API_BASE_URL;

  beforeEach(() => {
    // Reset window custom properties
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    // Clear localStorage
    localStorage.clear();

    // Reset userAgent default
    Object.defineProperty(navigator, "userAgent", {
      value: originalUserAgent,
      configurable: true,
      writable: true,
    });

    // Reset import.meta.env default
    import.meta.env.DEV = false;
    import.meta.env.VITE_API_BASE_URL = undefined;
  });

  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    localStorage.clear();

    Object.defineProperty(navigator, "userAgent", {
      value: originalUserAgent,
      configurable: true,
      writable: true,
    });

    import.meta.env.DEV = originalDev;
    import.meta.env.VITE_API_BASE_URL = originalViteApiBaseUrl;
    vi.restoreAllMocks();
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
  });

  describe("isNativePlatform", () => {
    it("should return true for native platforms (Capacitor or Tauri)", () => {
      (window as unknown as { Capacitor: unknown }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };
      expect(isNativePlatform()).toBe(true);
    });

    it("should return false for web platform", () => {
      expect(isNativePlatform()).toBe(false);
    });
  });

  describe("getApiBaseUrl", () => {
    it("should return dev_server_host from localStorage in DEV mode if valid URL", () => {
      import.meta.env.DEV = true;
      localStorage.setItem("dev_server_host", "http://192.168.1.100:8000/");

      expect(getApiBaseUrl()).toBe("http://192.168.1.100:8000/api");
    });

    it("should ignore invalid dev_server_host in localStorage during DEV mode", () => {
      import.meta.env.DEV = true;
      localStorage.setItem("dev_server_host", "invalid-host-url");

      expect(getApiBaseUrl()).toBe("/api");
    });

    it("should return VITE_API_BASE_URL when specified and valid", () => {
      import.meta.env.VITE_API_BASE_URL = "https://api.echotalk.com///";

      expect(getApiBaseUrl()).toBe("https://api.echotalk.com/api");
    });

    it("should throw error on native platform if VITE_API_BASE_URL is missing or invalid", () => {
      (window as unknown as { Capacitor: unknown }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "android",
      };

      expect(() => getApiBaseUrl()).toThrow("[EchoTalk] 原生环境未配置有效的 VITE_API_BASE_URL");
    });

    it("should return '/api' on web platform when no DEV override or VITE_API_BASE_URL is set", () => {
      expect(getApiBaseUrl()).toBe("/api");
    });
  });
});
