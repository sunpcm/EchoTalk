import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { UserSettingsResponse, UserSettingsUpdate } from "@/lib/api";
import { beginLogout } from "@/lib/auth";
import { zhCN } from "@/i18n/zh-CN";
import { buildSettingsUpdate } from "./settingsPayload";

const t = zhCN.settings;
const SAVE_SUCCESS_DURATION_MS = 2000;
const LOCAL_ERROR_DURATION_MS = 3000;

type SettingsUpdateResult = { success: boolean; error?: string };

interface SettingsFormDraft {
  isCustomMode: boolean;
  sttProvider: string;
  llmProvider: string;
  llmModel: string;
  ttsProvider: string;
  sttKey: string;
  llmKey: string;
  ttsKey: string;
}

const INITIAL_DRAFT: SettingsFormDraft = {
  isCustomMode: false,
  sttProvider: "deepgram",
  llmProvider: "siliconflow",
  llmModel: "",
  ttsProvider: "cartesia",
  sttKey: "",
  llmKey: "",
  ttsKey: "",
};

interface UseSettingsFormOptions {
  open: boolean;
  settings: UserSettingsResponse | null;
  updateSettings: (data: UserSettingsUpdate) => Promise<SettingsUpdateResult>;
}

/**
 * 设置草稿、显式保存及本地提示的单一所有者。
 * 本地提示绑定真实打开周期与操作序号；旧异步结果只能静默退出。
 */
export function useSettingsForm({ open, settings, updateSettings }: UseSettingsFormOptions) {
  const [draft, setDraft] = useState<SettingsFormDraft>(INITIAL_DRAFT);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [toastError, setToastError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const openCycleRef = useRef(0);
  const activeOpenCycleRef = useRef<number | null>(null);
  const operationSequenceRef = useRef(0);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearNoticeTimer = useCallback(() => {
    if (noticeTimerRef.current !== null) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
  }, []);

  const clearLocalNotices = useCallback(() => {
    clearNoticeTimer();
    setSaveSuccess(false);
    setToastError(null);
  }, [clearNoticeTimer]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationSequenceRef.current += 1;
      clearNoticeTimer();
    };
  }, [clearNoticeTimer]);

  useLayoutEffect(() => {
    const cycle = open ? ++openCycleRef.current : null;
    activeOpenCycleRef.current = cycle;
    operationSequenceRef.current += 1;
    clearNoticeTimer();

    if (!open) {
      setSaveSuccess(false);
      setToastError(null);
    }

    return () => {
      operationSequenceRef.current += 1;
      if (activeOpenCycleRef.current === cycle) {
        activeOpenCycleRef.current = null;
      }
      clearNoticeTimer();
    };
  }, [clearNoticeTimer, open]);

  // 只按后端 settings 对象引用水合；主题、open 或同引用重渲染不重置草稿。
  useEffect(() => {
    if (!settings) return;

    setDraft({
      isCustomMode: settings.is_custom_mode,
      sttProvider: settings.stt_provider || "deepgram",
      llmProvider: settings.llm_provider || "siliconflow",
      llmModel: settings.llm_model || "",
      ttsProvider: settings.tts_provider || "cartesia",
      sttKey: "",
      llmKey: "",
      ttsKey: "",
    });
    setSaveSuccess(false);
  }, [settings]);

  const isCurrentOperation = useCallback((cycle: number | null, operation: number) => {
    return (
      mountedRef.current &&
      cycle !== null &&
      activeOpenCycleRef.current === cycle &&
      operationSequenceRef.current === operation
    );
  }, []);

  const showSuccess = useCallback(
    (cycle: number, operation: number) => {
      clearNoticeTimer();
      setToastError(null);
      setSaveSuccess(true);
      noticeTimerRef.current = setTimeout(() => {
        if (!isCurrentOperation(cycle, operation)) return;
        noticeTimerRef.current = null;
        setSaveSuccess(false);
      }, SAVE_SUCCESS_DURATION_MS);
    },
    [clearNoticeTimer, isCurrentOperation],
  );

  const showError = useCallback(
    (message: string, cycle: number, operation: number, durationMs: number | null) => {
      clearNoticeTimer();
      setSaveSuccess(false);
      setToastError(message);
      if (durationMs === null) return;

      noticeTimerRef.current = setTimeout(() => {
        if (!isCurrentOperation(cycle, operation)) return;
        noticeTimerRef.current = null;
        setToastError(null);
      }, durationMs);
    },
    [clearNoticeTimer, isCurrentOperation],
  );

  const handleSave = useCallback(async () => {
    const cycle = activeOpenCycleRef.current;
    if (!mountedRef.current || cycle === null) return;

    const operation = ++operationSequenceRef.current;
    clearLocalNotices();

    const result = await updateSettings(
      buildSettingsUpdate({
        isCustomMode: draft.isCustomMode,
        sttProvider: draft.sttProvider,
        llmProvider: draft.llmProvider,
        llmModel: draft.llmModel,
        ttsProvider: draft.ttsProvider,
        sttKey: draft.sttKey,
        llmKey: draft.llmKey,
        ttsKey: draft.ttsKey,
      }),
    );

    if (!isCurrentOperation(cycle, operation)) return;
    if (result.success) {
      showSuccess(cycle, operation);
    } else if (result.error !== "stale") {
      showError(result.error || t.saveError, cycle, operation, LOCAL_ERROR_DURATION_MS);
    }
  }, [clearLocalNotices, draft, isCurrentOperation, showError, showSuccess, updateSettings]);

  const handleLogout = useCallback(async () => {
    const cycle = activeOpenCycleRef.current;
    if (!mountedRef.current || cycle === null) return;

    const operation = ++operationSequenceRef.current;
    clearLocalNotices();

    try {
      await beginLogout();
    } catch {
      if (isCurrentOperation(cycle, operation)) {
        showError(t.logoutError, cycle, operation, null);
      }
    }
  }, [clearLocalNotices, isCurrentOperation, showError]);

  const toggleCustomMode = useCallback(() => {
    if (draft.isCustomMode && settings?.subscription_tier === "free") {
      alert("该功能仅限 VIP 用户使用（或引导升级）。由于您是普通用户，请继续使用自定义模式。");
      return;
    }
    setDraft((current) => ({ ...current, isCustomMode: !current.isCustomMode }));
  }, [draft.isCustomMode, settings?.subscription_tier]);

  return {
    draft,
    saveSuccess,
    toastError,
    setSttProvider: (value: string) => setDraft((current) => ({ ...current, sttProvider: value })),
    setLlmProvider: (value: string) => setDraft((current) => ({ ...current, llmProvider: value })),
    setLlmModel: (value: string) => setDraft((current) => ({ ...current, llmModel: value })),
    setTtsProvider: (value: string) => setDraft((current) => ({ ...current, ttsProvider: value })),
    setSttKey: (value: string) => setDraft((current) => ({ ...current, sttKey: value })),
    setLlmKey: (value: string) => setDraft((current) => ({ ...current, llmKey: value })),
    setTtsKey: (value: string) => setDraft((current) => ({ ...current, ttsKey: value })),
    toggleCustomMode,
    handleSave,
    handleLogout,
  };
}
