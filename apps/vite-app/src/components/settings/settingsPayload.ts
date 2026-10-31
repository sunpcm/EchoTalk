/**
 * 设置保存载荷行为纯计算模块。
 * 从表单标量快照构建 UserSettingsUpdate 请求体。
 */

import type { UserSettingsUpdate } from "@/lib/api";

export interface SettingsPayloadInput {
  isCustomMode: boolean;
  sttProvider: string;
  llmProvider: string;
  llmModel: string;
  ttsProvider: string;
  sttKey: string;
  llmKey: string;
  ttsKey: string;
}

/**
 * 从当前表单状态纯标量快照构建 UserSettingsUpdate 请求体。
 * 纯计算函数：不读取/修改外部状态，不修改入参，返回独立新对象。
 */
export function buildSettingsUpdate(input: SettingsPayloadInput): UserSettingsUpdate {
  const data: UserSettingsUpdate = { is_custom_mode: input.isCustomMode };

  if (input.isCustomMode) {
    data.stt_provider = input.sttProvider as "deepgram";
    data.llm_provider = input.llmProvider as "siliconflow" | "openrouter";
    data.tts_provider = input.ttsProvider as "cartesia";

    const trimmedModel = input.llmModel.trim();
    if (trimmedModel) {
      data.llm_model = trimmedModel;
    }

    const trimmedSttKey = input.sttKey.trim();
    if (trimmedSttKey) {
      data.stt_key = trimmedSttKey;
    }

    const trimmedLlmKey = input.llmKey.trim();
    if (trimmedLlmKey) {
      data.llm_key = trimmedLlmKey;
    }

    const trimmedTtsKey = input.ttsKey.trim();
    if (trimmedTtsKey) {
      data.tts_key = trimmedTtsKey;
    }
  }

  return data;
}
