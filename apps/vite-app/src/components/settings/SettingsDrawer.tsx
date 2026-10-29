/**
 * 设置抽屉组件。
 * 从右侧滑出，管理双轨制自定义模式的配置：
 * is_custom_mode 开关、Provider 选择、API Key 输入。
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore, type ThemeName } from "@/store/settings";
import { zhCN } from "@/i18n/zh-CN";
import { buildSettingsUpdate } from "./settingsPayload";
import { beginLogout, getAuthMode } from "@/lib/auth";

const t = zhCN.settings;

/** Phase 8.5：外观主题色板预览 */
const THEME_SWATCHES: { value: ThemeName; label: string; bg: string; accent: string }[] = [
  { value: "warm", label: t.themeWarm, bg: "#FBF7F1", accent: "#F76B4A" },
  { value: "cool", label: t.themeCool, bg: "#F1F5FB", accent: "#3D6FE0" },
  { value: "dark", label: t.themeDark, bg: "#17181B", accent: "#E8A23D" },
];

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

/** 获取当前容器内真正可聚焦且未被禁用的元素列表（排除 disabled fieldset 的后代） */
function getTabbableElements(container: HTMLElement): HTMLElement[] {
  const elements = Array.from(
    container.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]"),
  );

  return elements.filter((el) => {
    // 排除已禁用控件（自身 disabled 或祖先 fieldset disabled）
    if (el.matches(":disabled") || el.closest("fieldset[disabled]")) {
      return false;
    }
    if ((el as HTMLButtonElement | HTMLInputElement | HTMLSelectElement).disabled === true) {
      return false;
    }
    // 排除负 tabindex
    const tabIndex = el.getAttribute("tabindex");
    if (tabIndex !== null && parseInt(tabIndex, 10) < 0) {
      return false;
    }
    // 排除无几何尺寸或隐藏的元素
    if (el.getClientRects().length === 0) {
      return false;
    }
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") {
      return false;
    }
    return true;
  });
}

export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  const { settings, loading, saving, error, fetchSettings, updateSettings } = useSettingsStore();
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

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
  const [toastError, setToastError] = useState<string | null>(null);

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

  // 原生 dialog 模态控制、焦点管理及背景滚动锁定
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;

    // 记录打开前的焦点元素以供关闭后恢复
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      previousActiveElementRef.current = document.activeElement;
    } else {
      // 使用现有 i18n 配置寻找触发设置抽屉的按钮
      const triggerBtn = document.querySelector<HTMLElement>(`button[aria-label="${t.title}"]`);
      if (triggerBtn) {
        previousActiveElementRef.current = triggerBtn;
      }
    }

    // 锁定背景滚动
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // 调起原生模态 dialog
    if (typeof dialog.showModal === "function") {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      dialog.setAttribute("open", "");
    }

    // 自动聚焦内部关闭按钮，明确避免自动聚焦 API Key 等输入框调起移动端键盘
    const frameId = requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const handleFocusIn = (e: FocusEvent) => {
      if (!dialog.contains(e.target as Node)) {
        closeButtonRef.current?.focus();
      }
    };

    document.addEventListener("focusin", handleFocusIn);

    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener("focusin", handleFocusIn);
      document.body.style.overflow = originalOverflow;

      if (typeof dialog.close === "function" && dialog.open) {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }

      // 恢复原先激活的控件焦点
      if (previousActiveElementRef.current && document.contains(previousActiveElementRef.current)) {
        previousActiveElementRef.current.focus();
        previousActiveElementRef.current = null;
      }
    };
  }, [open]);

  // 点击遮罩区域（dialog 元素外部）关闭，内部点击不关闭
  const handleDialogClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target !== dialogRef.current) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const rect = dialog.getBoundingClientRect();
    const isInDialog =
      rect.top <= e.clientY &&
      e.clientY <= rect.bottom &&
      rect.left <= e.clientX &&
      e.clientX <= rect.right;

    if (!isInDialog) {
      onClose();
    }
  };

  // 单一权威焦点所有权路径：键盘 Tab 双向循环与 Escape 关闭
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === "Tab") {
      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusables = getTabbableElements(dialog);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const current = document.activeElement as HTMLElement | null;
      const currentIndex = current ? focusables.indexOf(current) : -1;

      if (e.shiftKey) {
        const prevIndex = currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1;
        focusables[prevIndex].focus();
      } else {
        const nextIndex =
          currentIndex === -1 || currentIndex >= focusables.length - 1 ? 0 : currentIndex + 1;
        focusables[nextIndex].focus();
      }
    }
  };

  const handleToggleCustomMode = () => {
    // 试图关闭自备密钥时（即 isCustomMode 从 true 变为 false）拦截校验
    if (isCustomMode && settings?.subscription_tier === "free") {
      alert("该功能仅限 VIP 用户使用（或引导升级）。由于您是普通用户，请继续使用自定义模式。");
      return;
    }
    setIsCustomMode(!isCustomMode);
  };

  const handleSave = useCallback(async () => {
    const data = buildSettingsUpdate({
      isCustomMode,
      sttProvider,
      llmProvider,
      llmModel,
      ttsProvider,
      sttKey,
      llmKey,
      ttsKey,
    });

    // 清除上一次的toast
    setToastError(null);

    const result = await updateSettings(data);
    if (result.success) {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } else {
      setToastError(result.error || t.saveError);
      setTimeout(() => setToastError(null), 3000);
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
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-drawer-title"
      onClick={handleDialogClick}
      onKeyDown={handleKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="settings-drawer bg-bg fixed inset-y-0 right-0 z-50 m-0 ml-auto flex h-full max-h-none w-full max-w-sm animate-[slideInRight_0.25s_ease-out] flex-col border-0 p-0 shadow-xl"
      style={{
        height: "100dvh",
        maxHeight: "100dvh",
        paddingTop: "max(0px, env(safe-area-inset-top))",
        paddingBottom: "max(0px, env(safe-area-inset-bottom))",
        paddingLeft: "max(0px, env(safe-area-inset-left))",
        paddingRight: "max(0px, env(safe-area-inset-right))",
      }}
    >
      {/* Header - 固定在顶部，确保关闭按钮持续到达 */}
      <div className="border-border-default bg-bg sticky top-0 z-20 flex shrink-0 items-center justify-between border-b px-6 py-3">
        <h2 id="settings-drawer-title" className="text-text-default text-lg font-semibold">
          {t.title}
        </h2>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="text-text-faint hover:bg-surface-alt hover:text-text-default focus-visible:ring-accent flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          title={t.close}
          aria-label={t.closeAriaLabel || t.close}
        >
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>

      {/* Toast 提示 (位于 Header 下方，不遮挡关闭按钮) */}
      {toastError && (
        <div className="bg-danger-bg ring-danger-border mx-6 mt-3 shrink-0 rounded-lg p-4 shadow-lg ring-1">
          <div className="flex gap-3">
            <svg className="text-danger h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                clipRule="evenodd"
              />
            </svg>
            <p className="text-danger-text text-sm font-medium">{toastError}</p>
          </div>
        </div>
      )}

      {/* 主面板内容（独立纵向滚动，不使用 overflow-x: hidden） */}
      <div className="flex-1 space-y-6 overflow-x-visible overflow-y-auto px-6 py-6">
        {/* Phase 8.5 / A28：外观主题切换（local-first 即时切换，未认证仅本地偏好，已认证防抖同步后端持久化；不受设置加载态影响，始终可用） */}
        <div className="space-y-2">
          <div>
            <p className="text-text-default text-sm font-medium">{t.themeTitle}</p>
            <p className="text-text-muted text-xs">{t.themeDesc}</p>
          </div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t.themeTitle}>
            {THEME_SWATCHES.map((s) => {
              const active = theme === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`${s.label}${t.themeTitle}`}
                  onClick={() => setTheme(s.value)}
                  className={`flex min-h-[44px] min-w-[44px] flex-1 items-center justify-center gap-2 rounded-[14px] border-2 px-3 py-2.5 transition-colors ${
                    active
                      ? "border-accent"
                      : "border-border-default hover:border-accent-soft-border"
                  }`}
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                    style={{ background: s.bg, border: `2px solid ${s.accent}` }}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.accent }} />
                  </span>
                  <span className="text-text-default text-sm font-semibold">{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <hr className="border-border-default" />

        {/* 加载状态 */}
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="border-accent h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        )}

        {!loading && (
          <>
            {/* Switch: is_custom_mode */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-text-default text-sm font-medium">{t.customModeLabel}</p>
                <p className="text-text-muted text-xs">{t.customModeDesc}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isCustomMode}
                aria-label={t.customModeLabel}
                onClick={handleToggleCustomMode}
                className="focus-visible:ring-accent relative inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-full p-2 transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <span
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
                    isCustomMode ? "bg-accent" : "bg-border-default"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform ${
                      isCustomMode ? "translate-x-5.5" : "translate-x-0.5"
                    }`}
                  />
                </span>
              </button>
            </div>

            <hr className="border-border-default" />

            {/* Provider 配置区域 */}
            <fieldset disabled={disabled} className={disabled ? "opacity-50" : ""}>
              <div className="space-y-5">
                {/* STT */}
                <ProviderGroup
                  idPrefix="stt"
                  label={t.sttProvider}
                  options={STT_OPTIONS}
                  value={sttProvider}
                  onChange={setSttProvider}
                  apiKey={sttKey}
                  onKeyChange={setSttKey}
                  hasKey={settings?.has_stt_key ?? false}
                  status={settings?.stt_status}
                />

                {/* LLM */}
                <ProviderGroup
                  idPrefix="llm"
                  label={t.llmProvider}
                  options={LLM_OPTIONS}
                  value={llmProvider}
                  onChange={setLlmProvider}
                  apiKey={llmKey}
                  onKeyChange={setLlmKey}
                  hasKey={settings?.has_llm_key ?? false}
                  status={settings?.llm_status}
                >
                  {/* LLM Model */}
                  <div>
                    <label
                      htmlFor="llm-model-input"
                      className="text-text-muted mb-1 block text-xs font-medium"
                    >
                      {t.llmModel}
                    </label>
                    <input
                      id="llm-model-input"
                      type="text"
                      value={llmModel}
                      onChange={(e) => setLlmModel(e.target.value)}
                      placeholder={t.llmModelPlaceholder}
                      className="border-border-default focus:border-accent-soft-border focus:ring-accent-soft-border w-full rounded-md border px-3 py-1.5 text-sm transition-colors outline-none focus:ring-1"
                    />
                  </div>
                </ProviderGroup>

                {/* TTS */}
                <ProviderGroup
                  idPrefix="tts"
                  label={t.ttsProvider}
                  options={TTS_OPTIONS}
                  value={ttsProvider}
                  onChange={setTtsProvider}
                  apiKey={ttsKey}
                  onKeyChange={setTtsKey}
                  hasKey={settings?.has_tts_key ?? false}
                  status={settings?.tts_status}
                />
              </div>
            </fieldset>

            {/* 保存按钮 */}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="bg-accent text-accent-contrast hover:bg-accent-hover flex min-h-[44px] w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? t.saving : t.save}
            </button>

            {/* 保存成功提示 */}
            {saveSuccess && <p className="text-success text-center text-sm">{t.saveSuccess}</p>}

            {/* 错误提示 */}
            {error && <p className="text-danger text-center text-sm">{error}</p>}

            {getAuthMode() === "oidc" && (
              <button
                type="button"
                onClick={() => void beginLogout().catch(() => setToastError(t.logoutError))}
                className="border-border-default text-text-muted hover:text-text-default flex min-h-[44px] w-full items-center justify-center rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors"
              >
                {t.logout}
              </button>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}

function KeyStatusBadge({ status }: { status?: "verified" | "error" | "unconfigured" }) {
  if (status === "verified") {
    return (
      <span className="bg-success-bg text-success-text flex items-center gap-1 rounded-full px-2 py-0.5 text-xs">
        <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
            clipRule="evenodd"
          />
        </svg>
        {t.statusVerified}
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="bg-danger-bg text-danger-text flex items-center gap-1 rounded-full px-2 py-0.5 text-xs">
        <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
          <path
            fillRule="evenodd"
            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
        {t.statusError}
      </span>
    );
  }
  return (
    <span className="bg-surface-alt text-text-muted rounded-full px-2 py-0.5 text-xs">
      {t.statusUnconfigured}
    </span>
  );
}

/** 单个 Provider 配置组：下拉选择 + API Key 输入 */
function ProviderGroup({
  idPrefix,
  label,
  options,
  value,
  onChange,
  apiKey,
  onKeyChange,
  hasKey,
  status,
  children,
}: {
  idPrefix: string;
  label: string;
  options: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  value: string;
  onChange: (v: string) => void;
  apiKey: string;
  onKeyChange: (v: string) => void;
  hasKey: boolean;
  status?: "verified" | "error" | "unconfigured";
  children?: React.ReactNode;
}) {
  const selectId = `${idPrefix}-provider-select`;
  const keyInputId = `${idPrefix}-key-input`;

  return (
    <div className="space-y-2">
      {/* Provider 下拉及状态 Badge */}
      <div className="mb-1 flex items-center justify-between">
        <label htmlFor={selectId} className="text-text-muted block text-xs font-medium">
          {label}
        </label>
        <KeyStatusBadge status={status} />
      </div>
      <div>
        <select
          id={selectId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="border-border-default bg-surface focus:border-accent-soft-border focus:ring-accent-soft-border w-full rounded-md border px-3 py-1.5 text-sm transition-colors outline-none focus:ring-1"
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
          <label htmlFor={keyInputId} className="text-text-muted text-xs font-medium">
            {t.apiKey}
          </label>
        </div>
        <input
          id={keyInputId}
          type="password"
          value={apiKey}
          onChange={(e) => onKeyChange(e.target.value)}
          placeholder={hasKey ? t.apiKeyConfiguredPlaceholder : t.apiKeyPlaceholder}
          className="border-border-default focus:border-accent-soft-border focus:ring-accent-soft-border w-full rounded-md border px-3 py-1.5 text-sm transition-colors outline-none focus:ring-1"
        />
      </div>
    </div>
  );
}
