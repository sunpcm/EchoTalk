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
import {
  getAuthSnapshot,
  getAuthRevision,
  arePrincipalsEqual,
  type AuthPrincipal,
} from "@/lib/auth";

/** Phase 8：界面主题 */
export type ThemeName = "warm" | "cool" | "dark";

export const THEME_STORAGE_KEY = "echotalk-theme";

let settingsGeneration = 0;
let themeSyncTimer: ReturnType<typeof setTimeout> | null = null;
let themeSyncSequence = 0;

interface SyncContext {
  gen: number;
  principal: AuthPrincipal;
  authRevision: number;
}

interface InFlightSync extends SyncContext {
  sequence: number;
  theme: ThemeName;
}

interface PendingIntent extends SyncContext {
  sequence: number;
  theme: ThemeName;
  debounceReady: boolean;
}

let inFlightSync: InFlightSync | null = null;
let pendingIntent: PendingIntent | null = null;

// TH-08: 绑定特定 owner 的本地主题意图与同步状态追踪
interface LocalThemeIntentTracker {
  gen: number;
  principal: AuthPrincipal;
  authRevision: number;
  latestSequence: number;
  lastSyncedSequence: number;
}
let currentOwnerThemeTracker: LocalThemeIntentTracker | null = null;

interface InFlightFetch {
  id: number;
  gen: number;
  principal: AuthPrincipal;
  authRevision: number;
}
let fetchRequestId = 0;
let inFlightFetch: InFlightFetch | null = null;

// TH-09: 通用保存操作所有权追踪
interface InFlightUpdate {
  id: number;
  gen: number;
  principal: AuthPrincipal;
  authRevision: number;
}
let updateRequestId = 0;
let inFlightUpdate: InFlightUpdate | null = null;

function cancelPendingThemeSyncTimer(): void {
  if (themeSyncTimer) {
    clearTimeout(themeSyncTimer);
    themeSyncTimer = null;
  }
}

/** 统一的上下文有效性复核函数 */
function isContextValid(ctx: {
  gen: number;
  principal: AuthPrincipal | null;
  authRevision: number;
}): boolean {
  if (ctx.gen !== settingsGeneration) return false;
  if (ctx.authRevision !== getAuthRevision()) return false;
  if (!ctx.principal) return false;
  const currentAuth = getAuthSnapshot();
  if (currentAuth.state !== "authenticated" || !currentAuth.principal) return false;
  return arePrincipalsEqual(currentAuth.principal, ctx.principal);
}

/** TH-11: 区分发布资格与物理在途串行占用——同 store 代际与同已认证 principal 下等待其 settle */
function isSerialSyncBusy(): boolean {
  if (inFlightSync === null) return false;
  if (inFlightSync.gen !== settingsGeneration) return false;
  const currentAuth = getAuthSnapshot();
  if (currentAuth.state !== "authenticated" || !currentAuth.principal) return false;
  return arePrincipalsEqual(currentAuth.principal, inFlightSync.principal);
}

function tryDispatchNextThemeSync(): void {
  if (inFlightSync !== null) {
    if (isSerialSyncBusy()) {
      // TH-11: 同账号同 store 代际物理在途仍占位串行，即使 revision 变动也等待其 settle
      return;
    }
    // 已发生换号、reset 或登出，旧在途孤儿化，不阻塞新身份
    inFlightSync = null;
  }

  if (!pendingIntent) {
    return;
  }

  // TH-05 两门状态机：防抖门与串行无在途门同时满足才写
  if (!pendingIntent.debounceReady) {
    return;
  }

  const next = pendingIntent;
  pendingIntent = null;

  if (!isContextValid(next)) {
    return;
  }

  const currentInFlight: InFlightSync = {
    gen: next.gen,
    principal: next.principal,
    authRevision: next.authRevision,
    sequence: next.sequence,
    theme: next.theme,
  };
  inFlightSync = currentInFlight;

  updateUserSettings({ theme: next.theme })
    .then((settings) => {
      if (!isContextValid(currentInFlight)) {
        return;
      }

      // TH-04: 若当前 sequence 已被更新的本地选择超越，绝对不写入 store（零发布，保留负向断言契约）
      if (currentInFlight.sequence !== themeSyncSequence) {
        return;
      }

      // TH-08: 更新当前 owner 的已同步序列号
      if (
        currentOwnerThemeTracker &&
        isContextValid(currentOwnerThemeTracker) &&
        arePrincipalsEqual(currentOwnerThemeTracker.principal, currentInFlight.principal)
      ) {
        currentOwnerThemeTracker.lastSyncedSequence = currentInFlight.sequence;
      }

      // 旧 theme-only 响应不能回写覆盖更新的通用设置保存结果（Provider/验证状态/密钥存在标志）
      const currentSettings = useSettingsStore.getState().settings;
      if (currentSettings) {
        useSettingsStore.setState({
          settings: {
            ...currentSettings,
            theme: settings.theme,
          },
        });
      } else {
        useSettingsStore.setState({ settings });
      }
    })
    .catch(() => {
      // 切换主题保持 local-first；后台同步失败不回滚当前界面
    })
    .finally(() => {
      // 旧 finally 绝不能清除属于新操作或新代际的槽位
      if (inFlightSync === currentInFlight) {
        inFlightSync = null;
        tryDispatchNextThemeSync();
      }
    });
}

function scheduleDebouncedThemeSync(theme: ThemeName, ctx: SyncContext, sequence: number): void {
  cancelPendingThemeSyncTimer();

  // TH-05: 初始防抖门关闭
  pendingIntent = {
    ...ctx,
    sequence,
    theme,
    debounceReady: false,
  };

  themeSyncTimer = setTimeout(() => {
    themeSyncTimer = null;
    if (!isContextValid(ctx)) {
      if (pendingIntent?.sequence === sequence) {
        pendingIntent = null;
      }
      return;
    }
    // 只有当待发意图仍是此 sequence 时，才开启防抖门并尝试调度
    if (pendingIntent && pendingIntent.sequence === sequence) {
      pendingIntent.debounceReady = true;
      tryDispatchNextThemeSync();
    }
  }, 300);
}

/** 读取本地持久化的主题（无则或抛错安全回退暖色） */
export function readStoredTheme(): ThemeName {
  if (typeof window === "undefined") return "warm";
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return v === "cool" || v === "dark" ? v : "warm";
  } catch {
    return "warm";
  }
}

/** 安全持久化主题至本地 Storage，捕获 QuotaExceededError / SecurityError 等异常，不阻断即时更新或网络同步 */
function safeSetStoredTheme(theme: ThemeName): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage I/O 故障安全忽略，保持 local-first 与网络同步
  }
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
  /** 重置到初始状态并递增操作代际（不重置成0） */
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
    safeSetStoredTheme(theme);

    const currentGen = settingsGeneration;
    const auth = getAuthSnapshot();
    const isAuth = auth.state === "authenticated" && auth.principal !== null;
    const currentAuthRev = getAuthRevision();

    if (!isAuth || !auth.principal) {
      // 匿名/未认证：仅本地偏好，不向后端发写
      set({ theme });
      return;
    }

    // TH-01: 在同步发布通知前确定意图归属序列号，防止嵌套选择覆盖
    const opSequence = ++themeSyncSequence;

    // 同步更新 store 中的 theme 并触发订阅者
    set({ theme });

    // 同步订阅后复核
    if (
      !isContextValid({
        gen: currentGen,
        principal: auth.principal,
        authRevision: currentAuthRev,
      })
    ) {
      // TH-12: 仅当待发意图仍属于此操作时才清理，绝不取消新身份或新代际同步创建的新意图与计时器
      if (pendingIntent && pendingIntent.sequence === opSequence) {
        cancelPendingThemeSyncTimer();
        pendingIntent = null;
      }
      return;
    }

    // TH-01: 若订阅者同步触发了内层 setTheme，此时 themeSyncSequence 已被超越，外层直接退出
    if (themeSyncSequence !== opSequence) {
      return;
    }

    // TH-08: 更新当前 owner 的 tracker
    if (
      !currentOwnerThemeTracker ||
      !isContextValid(currentOwnerThemeTracker) ||
      !arePrincipalsEqual(currentOwnerThemeTracker.principal, auth.principal)
    ) {
      currentOwnerThemeTracker = {
        gen: currentGen,
        principal: auth.principal,
        authRevision: currentAuthRev,
        latestSequence: opSequence,
        lastSyncedSequence: 0,
      };
    } else {
      currentOwnerThemeTracker.latestSequence = opSequence;
    }

    scheduleDebouncedThemeSync(
      theme,
      {
        gen: currentGen,
        principal: auth.principal,
        authRevision: currentAuthRev,
      },
      opSequence,
    );
  },

  fetchSettings: async () => {
    const auth = getAuthSnapshot();
    if (auth.state !== "authenticated" || !auth.principal) {
      // TH-10: 未认证（anonymous/loading/misconfigured）直接失败关闭，拒绝所有设置 GET
      // 释放自身资源并保留本地 theme，绝对不向后端发网络请求
      if (get().loading) {
        set({ loading: false });
      }
      return;
    }

    const currentGen = settingsGeneration;
    const currentRev = getAuthRevision();
    const currentPrincipal = auth.principal;

    // TH-03: 检查是否已有同身份在途 fetch 请求去重
    if (inFlightFetch !== null) {
      if (isContextValid(inFlightFetch)) {
        return;
      }
      inFlightFetch = null;
    } else if (get().loading) {
      return;
    }

    // 分配新请求所有权槽位
    const currentRequestId = ++fetchRequestId;
    const currentOwner: InFlightFetch = {
      id: currentRequestId,
      gen: currentGen,
      principal: currentPrincipal,
      authRevision: currentRev,
    };
    inFlightFetch = currentOwner;

    // 同步更新 store 中的 loading
    set({ loading: true, error: null });

    // ----------------------------------------------------
    // TH-07 / TH-10: 在实际调用 getUserSettings() 副作用前严格复核！
    // 订阅者在通知内换 principal/revision 或变更为 anonymous/loading/misconfigured，
    // 必须直接在 API 副作用前复核拦截并失败关闭，绝对不向后端发网络请求！
    // ----------------------------------------------------
    const postAuth = getAuthSnapshot();
    const isOwnerStillValid =
      settingsGeneration === currentGen &&
      getAuthRevision() === currentRev &&
      inFlightFetch?.id === currentRequestId &&
      postAuth.state === "authenticated" &&
      postAuth.principal !== null &&
      arePrincipalsEqual(postAuth.principal, currentPrincipal);

    if (!isOwnerStillValid) {
      if (inFlightFetch?.id === currentRequestId) {
        inFlightFetch = null;
        set({ loading: false });
      }
      return;
    }

    // TH-08: 锁定 GET 发起时当前 owner 的本地主题同步状态
    const hasUnconfirmedThemeAtStart =
      (currentOwnerThemeTracker !== null &&
        isContextValid(currentOwnerThemeTracker) &&
        currentOwnerThemeTracker.latestSequence > currentOwnerThemeTracker.lastSyncedSequence) ||
      (themeSyncTimer !== null && isContextValid(pendingIntent ?? currentOwner)) ||
      (inFlightSync !== null && isContextValid(inFlightSync));
    const startOwnerSequence =
      currentOwnerThemeTracker && isContextValid(currentOwnerThemeTracker)
        ? currentOwnerThemeTracker.latestSequence
        : 0;

    try {
      const settings = await getUserSettings();

      // TH-03 / TH-07: 响应返回时严格复核身份与请求槽位归属
      if (inFlightFetch?.id !== currentRequestId || !isContextValid(currentOwner)) {
        return;
      }

      // TH-08: 水合冲突判断（只针对当前 owner 本身）
      const hasConflict =
        hasUnconfirmedThemeAtStart ||
        (currentOwnerThemeTracker !== null &&
          isContextValid(currentOwnerThemeTracker) &&
          currentOwnerThemeTracker.latestSequence !== startOwnerSequence) ||
        (themeSyncTimer !== null && isContextValid(pendingIntent ?? currentOwner)) ||
        (inFlightSync !== null && isContextValid(inFlightSync));

      if (!hasConflict) {
        const backendTheme = settings.theme;
        applyThemeAttr(backendTheme);
        safeSetStoredTheme(backendTheme);
        set({ settings, theme: backendTheme });
      } else {
        const localTheme = get().theme;
        set({
          settings: {
            ...settings,
            theme: localTheme,
          },
        });
      }
    } catch (err) {
      // TH-03: 错误返回时同样复核身份归属
      if (inFlightFetch?.id !== currentRequestId || !isContextValid(currentOwner)) {
        return;
      }
      set({
        error: err instanceof Error ? err.message : "加载设置失败",
      });
    } finally {
      // TH-03 / TH-07: 旧 finally 绝不清理属于新请求或新身份的槽位
      if (inFlightFetch?.id === currentRequestId) {
        inFlightFetch = null;
        set({ loading: false });
      }
    }
  },

  updateSettings: async (data: UserSettingsUpdate) => {
    const auth = getAuthSnapshot();
    if (auth.state !== "authenticated" || !auth.principal) {
      // TH-10: 未认证状态失败关闭，直接拒绝所有设置 PUT，保留本地状态，不发网络请求
      if (get().saving) {
        set({ saving: false });
      }
      return { success: false, error: "stale" };
    }

    const currentGen = settingsGeneration;
    const currentRev = getAuthRevision();
    const currentPrincipal = auth.principal;

    // TH-09: 分配新保存操作所有权槽位
    const currentRequestId = ++updateRequestId;
    const currentOwner: InFlightUpdate = {
      id: currentRequestId,
      gen: currentGen,
      principal: currentPrincipal,
      authRevision: currentRev,
    };
    inFlightUpdate = currentOwner;

    set({ saving: true, error: null });

    // ----------------------------------------------------
    // TH-07 / TH-09 / TH-10: 在实际调用 updateUserSettings() 副作用前严格复核！
    // 若同步订阅者触发了 reset、换号、登出或启动了新的保存操作，
    // 立即取消发送并退出！
    // ----------------------------------------------------
    const postAuth = getAuthSnapshot();
    const isOwnerStillValid =
      settingsGeneration === currentGen &&
      getAuthRevision() === currentRev &&
      inFlightUpdate?.id === currentRequestId &&
      postAuth.state === "authenticated" &&
      postAuth.principal !== null &&
      arePrincipalsEqual(postAuth.principal, currentPrincipal);

    if (!isOwnerStillValid) {
      // TH-09: 只有当前槽位仍属于自己时，才清理槽位并释放 saving；
      // 若槽位已被新操作（例如订阅者同步发起的保存 B）接管，绝不清空 B 的槽位或将 saving 误置为 false
      if (inFlightUpdate?.id === currentRequestId) {
        inFlightUpdate = null;
        set({ saving: false });
      }
      return { success: false, error: "stale" };
    }

    try {
      const settings = await updateUserSettings(data);

      // TH-09: 响应返回后复核所有权，旧操作迟到不写入新会话
      if (inFlightUpdate?.id !== currentRequestId || !isContextValid(currentOwner)) {
        return { success: false, error: "stale" };
      }

      // 如果后端验证未通过，但 HTTP 请求成功返回了，我们需要视为"校验失败"
      if (settings.is_custom_mode && !settings.is_custom_verified) {
        const errorMsg = "密钥验证未通过，请检查提供的 API Key 是否有效。";
        if (inFlightUpdate?.id === currentRequestId) {
          inFlightUpdate = null;
        }
        set({ settings, saving: false, error: errorMsg });
        return { success: false, error: errorMsg };
      }

      if (inFlightUpdate?.id === currentRequestId) {
        inFlightUpdate = null;
      }
      set({ settings, saving: false });
      return { success: true };
    } catch (err) {
      if (inFlightUpdate?.id !== currentRequestId || !isContextValid(currentOwner)) {
        return { success: false, error: "stale" };
      }
      const errorMessage = err instanceof Error ? err.message : "保存失败";
      if (inFlightUpdate?.id === currentRequestId) {
        inFlightUpdate = null;
      }
      set({
        saving: false,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    } finally {
      // TH-09: 旧 finally 绝不清理属于新请求或新身份的槽位
      if (inFlightUpdate?.id === currentRequestId) {
        inFlightUpdate = null;
        set({ saving: false });
      }
    }
  },

  reset: () => {
    settingsGeneration += 1;
    cancelPendingThemeSyncTimer();
    inFlightSync = null;
    pendingIntent = null;
    inFlightFetch = null;
    inFlightUpdate = null;
    currentOwnerThemeTracker = null;
    set({ settings: null, loading: false, saving: false, error: null });
  },
}));
