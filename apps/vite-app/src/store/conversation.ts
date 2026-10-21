/**
 * 对话状态管理 (zustand store)。
 * 管理 "未连接 -> 连接中 -> 对话中 -> 已结束" 的状态流转，
 * 以及 Dashboard / Session 视图切换。
 */

import { create } from "zustand";
import {
  createSession,
  getSessionToken,
  endSession as apiEndSession,
  checkHealthReady,
} from "@/lib/api";
import type { CurriculumRecommendation, DocContext } from "@/lib/api";

/** 连接状态枚举 */
export type ConnectionState =
  | "idle"
  | "checking_health"
  | "connecting"
  | "active"
  | "ending"
  | "end_failed"
  | "ended";

/** 顶层视图枚举 */
export type AppView = "dashboard" | "session" | "doc-chat-setup";

/** Store 类型定义 */
interface ConversationStore {
  /** 会话代际标识（用于防迟到响应污染） */
  sessionGen: number;
  /** 当前连接状态 */
  connectionState: ConnectionState;
  /** 顶层视图 */
  appView: AppView;
  /** 会话 ID */
  sessionId: string | null;
  /** LiveKit 房间令牌 */
  token: string | null;
  /** LiveKit WebSocket 地址 */
  wsUrl: string | null;
  /** 错误信息 */
  error: string | null;
  /** 用户选中的推荐场景 */
  selectedScenario: CurriculumRecommendation | null;
  /** Agent DataChannel 错误（自定义轨 fail-fast） */
  agentError: { code: string; message: string } | null;

  /** 开始新会话：创建 session -> 获取 token -> 切换到 session 视图 */
  startSession: (mode: string, docContext?: DocContext) => Promise<void>;
  /** 结束当前会话 */
  endSession: () => Promise<void>;
  /** LiveKit 房间连接成功后调用，切换到 active 状态 */
  setActive: (forSessionId?: string, forGen?: number) => void;
  /** 设置选中的推荐场景 */
  setSelectedScenario: (scenario: CurriculumRecommendation | null) => void;
  /** 记录 Agent DataChannel 错误，同时切换到 ended 状态以卸载 LiveKitRoom */
  setAgentError: (error: { code: string; message: string }) => void;
  /** 重置连接状态（不切换视图） */
  reset: () => void;
  /** 返回主页：重置所有状态并切换到 Dashboard */
  goHome: () => void;
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  sessionGen: 0,
  connectionState: "idle",
  appView: "dashboard",
  sessionId: null,
  token: null,
  wsUrl: null,
  error: null,
  selectedScenario: null,
  agentError: null,

  startSession: async (mode: string, docContext?: DocContext) => {
    // 防止重复调用（如双击或 StrictMode 双渲染）
    if (get().connectionState !== "idle") return;

    const targetGen = get().sessionGen + 1;

    // 1. 先置为检查状态，不切换视图，代际递增
    set({
      sessionGen: targetGen,
      connectionState: "checking_health",
      error: null,
    });

    try {
      await checkHealthReady();
    } catch (err) {
      if (get().sessionGen !== targetGen) return;
      console.error("Health check failed:", err);

      set({
        connectionState: "idle",
        appView: "dashboard",
        error: err instanceof Error ? err.message : "服务不可用，请稍后再试或检查相关配置",
      });
      return;
    }

    if (get().sessionGen !== targetGen) return;

    // 2. 检查可用后再切换到 session 视图并创建实际会话
    set({ connectionState: "connecting", appView: "session", error: null });
    try {
      const session = await createSession(mode, docContext);
      if (get().sessionGen !== targetGen) return;

      // 创建成功立即保存归属 ID，防止在 getSessionToken 在途期间无法结束
      set({ sessionId: session.id });

      const { token, ws_url } = await getSessionToken(session.id);
      if (get().sessionGen !== targetGen) return;

      set({
        token,
        wsUrl: ws_url,
        // 状态保持 connecting，等 LiveKit 连接成功后由 setActive 切到 active
      });
    } catch (err) {
      if (get().sessionGen !== targetGen) return;
      set({
        connectionState: "idle",
        appView: "dashboard",
        error: err instanceof Error ? err.message : "连接失败",
      });
    }
  },

  endSession: async () => {
    const state = get();
    // 1. 同一在途结束去重
    if (state.connectionState === "ending") {
      return;
    }

    // 已经处于 idle 或 ended 状态，无需结束
    if (state.connectionState === "idle" || state.connectionState === "ended") {
      return;
    }

    const { sessionId } = state;
    const newGen = state.sessionGen + 1;

    // 2. 无论是否已有 sessionId，结束都必须取消本地启动代际，使在途的 health/create/token 结果失效
    if (!sessionId) {
      // 在 health/create 尚未返回、无 ID 时结束：取消本地启动代际，不伪称已关闭未知服务端记录
      set({
        sessionGen: newGen,
        connectionState: "ended",
        token: null,
        wsUrl: null,
        error: null,
      });
      return;
    }

    const targetGen = newGen;
    const targetSessionId = sessionId;

    // 3. 结束发起前立即清除内存 Token/URL 并进入独立 ending 状态，使 LiveKitRoom 卸载/音轨释放
    set({
      sessionGen: targetGen,
      connectionState: "ending",
      token: null,
      wsUrl: null,
      error: null,
    });

    try {
      await apiEndSession(targetSessionId);
      // 代际或会话已改变（如离开返回主页或进入新会话），静默丢弃
      if (get().sessionGen !== targetGen || get().sessionId !== targetSessionId) {
        return;
      }
      set({ connectionState: "ended", error: null });
    } catch (err) {
      if (get().sessionGen !== targetGen || get().sessionId !== targetSessionId) {
        return;
      }
      // 失败 end_failed 显示本地音频停止、服务端待重试，只能显式重试同一 session
      set({
        connectionState: "end_failed",
        error: err instanceof Error ? err.message : "结束会话失败，请重试",
      });
    }
  },

  setActive: (forSessionId?: string, forGen?: number) => {
    const state = get();
    if (forSessionId && state.sessionId !== forSessionId) {
      return;
    }
    if (forGen !== undefined && state.sessionGen !== forGen) {
      return;
    }
    // 只能在 connecting 且 token 存在时切换为 active；ending/end_failed/ended/idle 均禁止复活
    if (state.connectionState !== "connecting" || !state.token) {
      return;
    }
    set({ connectionState: "active" });
  },

  setSelectedScenario: (scenario) => {
    set({ selectedScenario: scenario });
  },

  setAgentError: (error) => {
    set((state) => ({
      sessionGen: state.sessionGen + 1,
      agentError: error,
      connectionState: "ended",
      token: null,
      wsUrl: null,
    }));
  },

  reset: () => {
    set((state) => ({
      sessionGen: state.sessionGen + 1,
      connectionState: "idle",
      sessionId: null,
      token: null,
      wsUrl: null,
      error: null,
      agentError: null,
    }));
  },

  goHome: () => {
    set((state) => ({
      sessionGen: state.sessionGen + 1,
      connectionState: "idle",
      appView: "dashboard",
      sessionId: null,
      token: null,
      wsUrl: null,
      error: null,
      selectedScenario: null,
      agentError: null,
    }));
  },
}));
