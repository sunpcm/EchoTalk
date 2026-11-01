/**
 * 设置抽屉公共入口。
 * 负责 store 接线、打开时加载和行为模块组装。
 */

import { useEffect } from "react";
import { useSettingsStore } from "@/store/settings";
import { zhCN } from "@/i18n/zh-CN";
import { getAuthMode } from "@/lib/auth";
import { SettingsAppearance } from "./SettingsAppearance";
import { SettingsProviderFields } from "./SettingsProviderFields";
import { useSettingsDialog } from "./useSettingsDialog";
import { useSettingsForm } from "./useSettingsForm";

const t = zhCN.settings;

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const { settings, loading, saving, error, fetchSettings, updateSettings } = useSettingsStore();
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);

  // 该 hook 必须在 open=false 时保持挂载，以保留既有草稿语义。
  const form = useSettingsForm({ open, settings, updateSettings });
  const { dialogRef, closeButtonRef, handleDialogClick, handleKeyDown, handleCancel } =
    useSettingsDialog({ open, onClose });

  useEffect(() => {
    if (open) {
      void fetchSettings();
    }
  }, [fetchSettings, open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-drawer-title"
      onClick={handleDialogClick}
      onKeyDown={handleKeyDown}
      onCancel={handleCancel}
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

      {form.toastError && (
        <div className="bg-danger-bg ring-danger-border mx-6 mt-3 shrink-0 rounded-lg p-4 shadow-lg ring-1">
          <div className="flex gap-3">
            <svg className="text-danger h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                clipRule="evenodd"
              />
            </svg>
            <p className="text-danger-text text-sm font-medium">{form.toastError}</p>
          </div>
        </div>
      )}

      <div className="flex-1 space-y-6 overflow-x-visible overflow-y-auto px-6 py-6">
        <SettingsAppearance theme={theme} onThemeChange={setTheme} />

        <hr className="border-border-default" />

        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="border-accent h-6 w-6 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        )}

        {!loading && (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-text-default text-sm font-medium">{t.customModeLabel}</p>
                <p className="text-text-muted text-xs">{t.customModeDesc}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.draft.isCustomMode}
                aria-label={t.customModeLabel}
                onClick={form.toggleCustomMode}
                className="focus-visible:ring-accent relative inline-flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-full p-2 transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <span
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
                    form.draft.isCustomMode ? "bg-accent" : "bg-border-default"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform ${
                      form.draft.isCustomMode ? "translate-x-5.5" : "translate-x-0.5"
                    }`}
                  />
                </span>
              </button>
            </div>

            <hr className="border-border-default" />

            <SettingsProviderFields
              disabled={!form.draft.isCustomMode}
              settings={settings}
              sttProvider={form.draft.sttProvider}
              llmProvider={form.draft.llmProvider}
              llmModel={form.draft.llmModel}
              ttsProvider={form.draft.ttsProvider}
              sttKey={form.draft.sttKey}
              llmKey={form.draft.llmKey}
              ttsKey={form.draft.ttsKey}
              onSttProviderChange={form.setSttProvider}
              onLlmProviderChange={form.setLlmProvider}
              onLlmModelChange={form.setLlmModel}
              onTtsProviderChange={form.setTtsProvider}
              onSttKeyChange={form.setSttKey}
              onLlmKeyChange={form.setLlmKey}
              onTtsKeyChange={form.setTtsKey}
            />

            <button
              type="button"
              onClick={() => void form.handleSave()}
              disabled={saving}
              className="bg-accent text-accent-contrast hover:bg-accent-hover flex min-h-[44px] w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? t.saving : t.save}
            </button>

            {form.saveSuccess && (
              <p className="text-success text-center text-sm">{t.saveSuccess}</p>
            )}

            {error && <p className="text-danger text-center text-sm">{error}</p>}

            {getAuthMode() === "oidc" && (
              <button
                type="button"
                onClick={() => void form.handleLogout()}
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
