/**
 * 评估数据状态管理 (zustand store)。
 * 管理发音评估、语法错误、知识状态的获取和加载状态。
 */

import { create } from "zustand";
import {
  getAssessment,
  getGrammarErrors,
  getKnowledgeStates,
  ApiError,
  type AssessmentResponse,
  type GrammarErrorResponse,
  type KnowledgeStateResponse,
} from "@/lib/api";

/** 评估数据加载状态 */
export type AssessmentLoadState =
  | "idle" // 未开始获取
  | "polling" // 正在轮询中（404 → 分析尚未完成）
  | "loaded" // 数据加载完成
  | "error"; // 非 404 的真实错误

/** Store 类型定义 */
interface AssessmentStore {
  /** 数据加载状态 */
  loadState: AssessmentLoadState;
  /** 发音评估数据 */
  assessment: AssessmentResponse | null;
  /** 语法错误列表 */
  grammarErrors: GrammarErrorResponse[];
  /** 知识状态列表 */
  knowledgeStates: KnowledgeStateResponse[];
  /** 错误信息 */
  error: string | null;

  /**
   * 获取评估数据。
   * 返回 true 表示加载成功，false 表示 404（需要重试），throw 表示真实错误。
   */
  fetchAssessment: (sessionId: string) => Promise<boolean>;
  /** 获取知识状态（静默，失败不阻塞） */
  fetchKnowledgeStates: () => Promise<void>;
  /** 重置 store（新一轮对话时调用） */
  reset: () => void;
}

export const useAssessmentStore = create<AssessmentStore>((set) => ({
  loadState: "idle",
  assessment: null,
  grammarErrors: [],
  knowledgeStates: [],
  error: null,

  fetchAssessment: async (sessionId: string): Promise<boolean> => {
    set({ loadState: "polling", error: null });
    try {
      const [assessment, grammarErrors] = await Promise.all([
        getAssessment(sessionId),
        getGrammarErrors(sessionId),
      ]);
      set({
        loadState: "loaded",
        assessment,
        grammarErrors,
      });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // 分析尚未完成，保持 polling 状态，让调用者决定是否重试
        return false;
      }
      // 真实错误
      set({
        loadState: "error",
        error: err instanceof Error ? err.message : "加载评估数据失败",
      });
      throw err;
    }
  },

  fetchKnowledgeStates: async () => {
    try {
      const states = await getKnowledgeStates();
      set({ knowledgeStates: states });
    } catch {
      // 知识状态加载失败不阻塞主流程
    }
  },

  reset: () => {
    set({
      loadState: "idle",
      assessment: null,
      grammarErrors: [],
      knowledgeStates: [],
      error: null,
    });
  },
}));
