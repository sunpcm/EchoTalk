/**
 * 用户设置状态管理 (zustand store)。
 * 管理双轨制配置的获取、更新和本地缓存，
 * 供 SettingsDrawer 和 DataChannel 错误流程使用。
 */

import { create } from "zustand";
import {
  getUserSettings,
  updateUserSettings,
  type UserSettingsResponse,
  type UserSettingsUpdate,
} from "@/lib/api";

/** Phase 8：界面主题 */
export type ThemeName = "warm" | "cool" | "dark";

export const THEME_STORAGE_KEY = "echotalk-theme";

let themeSyncTimer: ReturnType<typeof setTimeout> | null = null;
let lastSyncedTheme: ThemeName | null = null;

function debouncedSyncThemeToBackend(theme: ThemeName): void {
  if (themeSyncTimer) {
    clearTimeout(themeSyncTimer);
  }
  themeSyncTimer = setTimeout(() => {
    themeSyncTimer = null;
    lastSyncedTheme = theme;
    updateUserSettings({ theme }).then((settings) => {
      // 序列化保护：仅当后端响应对应的 theme 属于最新设定的主题时，才写回 store settings
      if (lastSyncedTheme === theme && settings) {
        useSettingsStore.setState({ settings });
      }
    }).catch(() => {
      // 忽略切换主题时的网络或未鉴权错误，以本地存储为准
    });
  }, 300);
}

/** 读取本地持久化的主题（无则回退暖色） */
export function readStoredTheme(): ThemeName {
  if (typeof window === "undefined") return "warm";
  const v = window.localStorage.getItem(THEME_STORAGE_KEY);
  return v === "cool" || v === "dark" ? v : "warm";
}

/** 把主题写到 <html data-theme> 上（warm 为默认，仍显式写便于调试） */
export function applyThemeAttr(theme: ThemeName): void {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

/** Store 类型定义 */
interface SettingsStore {
  /** 当前用户设置（从后端获取） */
  settings: UserSettingsResponse | null;
  /** 是否正在加载设置 */
  loading: boolean;
  /** 是否正在保存设置 */
  saving: boolean;
  /** 错误信息 */
  error: string | null;
  /** Phase 8：当前界面主题 */
  theme: ThemeName;

  /** Phase 8：切换主题——更新 store + <html data-theme> + 本地持久化 */
  setTheme: (theme: ThemeName) => void;

  /** 从后端获取当前用户设置（水合） */
  fetchSettings: () => Promise<void>;
  /** 部分更新用户设置，返回包含成功与否和错误信息的对象 */
  updateSettings: (data: UserSettingsUpdate) => Promise<{ success: boolean; error?: string }>;
  /** 重置到初始状态 */
  reset: () => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: null,
  loading: false,
  saving: false,
  error: null,
  theme: readStoredTheme(),

  setTheme: (theme: ThemeName) => {
    applyThemeAttr(theme);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
    set({ theme });

    // 防抖与 Sequence 保护：300ms 内快速多次切换只向后端发送最后一次设置
    debouncedSyncThemeToBackend(theme);
  },

  fetchSettings: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const settings = await getUserSettings();
      if (settings.theme === "warm" || settings.theme === "cool" || settings.theme === "dark") {
        const backendTheme = settings.theme as ThemeName;
        applyThemeAttr(backendTheme);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(THEME_STORAGE_KEY, backendTheme);
        }
        set({ settings, theme: backendTheme, loading: false });
      } else {
        set({ settings, loading: false });
      }
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : "加载设置失败",
      });
    }
  },

  updateSettings: async (data: UserSettingsUpdate) => {
    set({ saving: true, error: null });
    try {
      const settings = await updateUserSettings(data);

      // 如果后端验证未通过，但 HTTP 请求成功返回了，我们需要视为"校验失败"
      if (settings.is_custom_mode && !settings.is_custom_verified) {
        const errorMsg = "密钥验证未通过，请检查提供的 API Key 是否有效。";
        set({ settings, saving: false, error: errorMsg });
        return { success: false, error: errorMsg };
      }

      set({ settings, saving: false });
      return { success: true };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "保存失败";
      set({
        saving: false,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  },

  reset: () => {
    set({ settings: null, loading: false, saving: false, error: null });
  },
}));
