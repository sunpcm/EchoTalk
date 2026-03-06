/**
 * 设置抽屉组件。
 * 从右侧滑出，管理双轨制自定义模式的配置：
 * is_custom_mode 开关、Provider 选择、API Key 输入。
 */

import React, { useCallback, useEffect, useState } from "react";
import { useSettingsStore } from "@/store/settings";
import { zhCN } from "@/i18n/zh-CN";
import type { UserSettingsUpdate } from "@/lib/api";

const t = zhCN.settings;

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

/** Provider 选项配置 */
const STT_OPTIONS = [{ value: "deepgram", label: "Deepgram" }] as const;
const LLM_OPTIONS = [
  { value: "siliconflow", label: "SiliconFlow" },
  { value: "openrouter", label: "OpenRouter" },
] as const;
const TTS_OPTIONS = [{ value: "cartesia", label: "Cartesia" }] as const;

export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const { settings, loading, saving, error, fetchSettings, updateSettings } = useSettingsStore();

  // 本地表单状态
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [sttProvider, setSttProvider] = useState("deepgram");
  const [llmProvider, setLlmProvider] = useState("siliconflow");
  const [llmModel, setLlmModel] = useState("");
  const [ttsProvider, setTtsProvider] = useState("cartesia");
  const [sttKey, setSttKey] = useState("");
  const [llmKey, setLlmKey] = useState("");
  const [ttsKey, setTtsKey] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);

  // 打开时加载设置
  useEffect(() => {
    if (open) {
      void fetchSettings();
    }
  }, [open, fetchSettings]);

  // 从后端数据同步到本地表单
  useEffect(() => {
    if (settings) {
      setIsCustomMode(settings.is_custom_mode);
      setSttProvider(settings.stt_provider || "deepgram");
      setLlmProvider(settings.llm_provider || "siliconflow");
      setLlmModel(settings.llm_model || "");
      setTtsProvider(settings.tts_provider || "cartesia");
      // Key 不从后端读取明文，保持空（仅通过 has_xxx_key 判断是否已配置）
      setSttKey("");
      setLlmKey("");
      setTtsKey("");
      setSaveSuccess(false);
    }
  }, [settings]);

  const handleToggleCustomMode = () => {
    // 试图关闭自备密钥时（即 isCustomMode 从 true 变为 false）拦截校验
    if (isCustomMode && settings?.subscription_tier === "free") {
      alert("该功能仅限 VIP 用户使用（或引导升级）。由于您是普通用户，请继续使用自定义模式。");
      return;
    }
    setIsCustomMode(!isCustomMode);
  };

  const handleSave = useCallback(async () => {
    const data: UserSettingsUpdate = { is_custom_mode: isCustomMode };

    if (isCustomMode) {
      data.stt_provider = sttProvider as "deepgram";
      data.llm_provider = llmProvider as "siliconflow" | "openrouter";
      data.tts_provider = ttsProvider as "cartesia";

      if (llmModel.trim()) {
        data.llm_model = llmModel.trim();
      }
      // 仅在用户输入了新 Key 时才发送（空字符串 = 不更新）
      if (sttKey.trim()) data.stt_key = sttKey.trim();
      if (llmKey.trim()) data.llm_key = llmKey.trim();
      if (ttsKey.trim()) data.tts_key = ttsKey.trim();
    }

    const ok = await updateSettings(data);
    if (ok) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    }
  }, [
    isCustomMode,
    sttProvider,
    llmProvider,
    llmModel,
    ttsProvider,
    sttKey,
    llmKey,
    ttsKey,
    updateSettings,
  ]);

  if (!open) return null;

  const disabled = !isCustomMode;

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-40 bg-black/30 transition-opacity" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-sm animate-[slideInRight_0.25s_ease-out] overflow-y-auto bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-800">{t.title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        <div className="space-y-6 px-6 py-6">
          {/* 加载状态 */}
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
            </div>
          )}

          {!loading && (
            <>
              {/* Switch: is_custom_mode */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-800">{t.customModeLabel}</p>
                  <p className="text-xs text-gray-500">{t.customModeDesc}</p>
                </div>
                <button
                  role="switch"
                  aria-checked={isCustomMode}
                  onClick={handleToggleCustomMode}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
                    isCustomMode ? "bg-indigo-500" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform ${
                      isCustomMode ? "translate-x-5.5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>

              <hr className="border-gray-200" />

              {/* Provider 配置区域 */}
              <fieldset disabled={disabled} className={disabled ? "opacity-50" : ""}>
                <div className="space-y-5">
                  {/* STT */}
                  <ProviderGroup
                    label={t.sttProvider}
                    options={STT_OPTIONS}
                    value={sttProvider}
                    onChange={setSttProvider}
                    apiKey={sttKey}
                    onKeyChange={setSttKey}
                    hasKey={settings?.has_stt_key ?? false}
                  />

                  {/* LLM */}
                  <ProviderGroup
                    label={t.llmProvider}
                    options={LLM_OPTIONS}
                    value={llmProvider}
                    onChange={setLlmProvider}
                    apiKey={llmKey}
                    onKeyChange={setLlmKey}
                    hasKey={settings?.has_llm_key ?? false}
                  >
                    {/* LLM Model */}
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        {t.llmModel}
                      </label>
                      <input
                        type="text"
                        value={llmModel}
                        onChange={(e) => setLlmModel(e.target.value)}
                        placeholder={t.llmModelPlaceholder}
                        className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm transition-colors outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
                      />
                    </div>
                  </ProviderGroup>

                  {/* TTS */}
                  <ProviderGroup
                    label={t.ttsProvider}
                    options={TTS_OPTIONS}
                    value={ttsProvider}
                    onChange={setTtsProvider}
                    apiKey={ttsKey}
                    onKeyChange={setTtsKey}
                    hasKey={settings?.has_tts_key ?? false}
                  />
                </div>
              </fieldset>

              {/* 保存按钮 */}
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? t.saving : t.save}
              </button>

              {/* 保存成功提示 */}
              {saveSuccess && <p className="text-center text-sm text-green-600">{t.saveSuccess}</p>}

              {/* 错误提示 */}
              {error && <p className="text-center text-sm text-red-600">{error}</p>}
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** 单个 Provider 配置组：下拉选择 + API Key 输入 */
function ProviderGroup({
  label,
  options,
  value,
  onChange,
  apiKey,
  onKeyChange,
  hasKey,
  children,
}: {
  label: string;
  options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  value: string;
  onChange: (v: string) => void;
  apiKey: string;
  onKeyChange: (v: string) => void;
  hasKey: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      {/* Provider 下拉 */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm transition-colors outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* 额外子元素（如 LLM Model 输入） */}
      {children}

      {/* API Key 输入 */}
      <div>
        <div className="mb-1 flex items-center gap-2">
          <label className="text-xs font-medium text-gray-600">{t.apiKey}</label>
          {hasKey && !apiKey && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
              {t.apiKeyConfigured}
            </span>
          )}
        </div>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => onKeyChange(e.target.value)}
          placeholder={hasKey ? "••••••••（留空保持不变）" : t.apiKeyPlaceholder}
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm transition-colors outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
        />
      </div>
    </div>
  );
}
