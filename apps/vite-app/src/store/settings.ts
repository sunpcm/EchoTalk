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

  fetchSettings: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const settings = await getUserSettings();
      set({ settings, loading: false });
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
