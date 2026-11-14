import type { StoreApi, UseBoundStore } from "zustand";
import { useAppStore } from "./appStore";
import type { ConversationSlice } from "./conversationSlice";

export type { ConnectionState } from "./conversationState";
export type { ConversationSlice as ConversationStore } from "./conversationSlice";

/**
 * 兼容 façade：与 useAppStore 共享同一个物理原子容器，
 * 但对外仅以会话切片类型暴露，不暴露页面视图与返回主页等外壳动作。
 */
export const useConversationStore = useAppStore as unknown as UseBoundStore<
  StoreApi<ConversationSlice>
>;
