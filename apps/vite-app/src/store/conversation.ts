import type { StoreApi, UseBoundStore } from "zustand";
import { useAppStore } from "./appStore";
import type { ConversationSlice } from "./conversationSlice";

export { _setLifecycleOptionsForTesting } from "./conversationSlice";
export type { ConnectionState } from "./conversationState";

/**
 * 对外暴露的会话 store 类型：在完整 ConversationSlice 上收窄掉通用协调补丁入口
 * （resetWithShellCoordination 接收任意 object，可写入页面视图等外壳键），
 * 使公共类型不能通过它传外壳字段；外壳协调动作仍由 AppStore 内部合法使用。
 */
export type ConversationStore = Omit<ConversationSlice, "resetWithShellCoordination">;

/**
 * 兼容 façade：与 useAppStore 共享同一个物理原子容器，
 * 但对外仅以会话切片类型暴露，不暴露页面视图与返回主页等外壳动作。
 */
export const useConversationStore = useAppStore as unknown as UseBoundStore<
  StoreApi<ConversationStore>
>;
