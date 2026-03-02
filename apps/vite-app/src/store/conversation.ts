/**
 * 对话状态管理 (zustand store)。
 * 管理 "未连接 -> 连接中 -> 对话中 -> 已结束" 的状态流转。
 */

import { create } from "zustand";
import { createSession, getSessionToken, endSession as apiEndSession } from "@/lib/api";

/** 连接状态枚举 */
export type ConnectionState = "idle" | "connecting" | "active" | "ended";

/** Store 类型定义 */
interface ConversationStore {
  /** 当前连接状态 */
  connectionState: ConnectionState;
  /** 会话 ID */
  sessionId: string | null;
  /** LiveKit 房间令牌 */
  token: string | null;
  /** LiveKit WebSocket 地址 */
  wsUrl: string | null;
  /** 错误信息 */
  error: string | null;

  /** 开始新会话：创建 session -> 获取 token -> 进入连接中状态 */
  startSession: (mode: string) => Promise<void>;
  /** 结束当前会话 */
  endSession: () => Promise<void>;
  /** LiveKit 房间连接成功后调用，切换到 active 状态 */
  setActive: () => void;
  /** 重置到初始状态，开始新一轮对话 */
  reset: () => void;
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  connectionState: "idle",
  sessionId: null,
  token: null,
  wsUrl: null,
  error: null,

  startSession: async (mode: string) => {
    // 防止重复调用（如双击或 StrictMode 双渲染）
    if (get().connectionState !== "idle") return;
    set({ connectionState: "connecting", error: null });
    try {
      const session = await createSession(mode);
      const { token, ws_url } = await getSessionToken(session.id);
      set({
        sessionId: session.id,
        token,
        wsUrl: ws_url,
        // 状态保持 connecting，等 LiveKit 连接成功后由 setActive 切到 active
      });
    } catch (err) {
      set({
        connectionState: "idle",
        error: err instanceof Error ? err.message : "连接失败",
      });
    }
  },

  endSession: async () => {
    const { sessionId } = get();
    if (sessionId) {
      try {
        await apiEndSession(sessionId);
      } catch {
        // 即使 API 调用失败，也标记为已结束
      }
    }
    set({ connectionState: "ended" });
  },

  setActive: () => {
    set({ connectionState: "active" });
  },

  reset: () => {
    set({
      connectionState: "idle",
      sessionId: null,
      token: null,
      wsUrl: null,
      error: null,
    });
  },
}));
