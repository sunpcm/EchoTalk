import type { ReactNode } from "react";
import type { UserSettingsResponse } from "@/lib/api";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.settings;

const STT_OPTIONS = [{ value: "deepgram", label: "Deepgram" }] as const;
const LLM_OPTIONS = [
  { value: "siliconflow", label: "SiliconFlow" },
  { value: "openrouter", label: "OpenRouter" },
] as const;
const TTS_OPTIONS = [{ value: "cartesia", label: "Cartesia" }] as const;

interface SettingsProviderFieldsProps {
  disabled: boolean;
  settings: UserSettingsResponse | null;
  sttProvider: string;
  llmProvider: string;
  llmModel: string;
  ttsProvider: string;
  sttKey: string;
  llmKey: string;
  ttsKey: string;
  onSttProviderChange: (value: string) => void;
  onLlmProviderChange: (value: string) => void;
  onLlmModelChange: (value: string) => void;
  onTtsProviderChange: (value: string) => void;
  onSttKeyChange: (value: string) => void;
  onLlmKeyChange: (value: string) => void;
  onTtsKeyChange: (value: string) => void;
}

/** Provider 选项、顺序、默认值、状态徽标和精确字段布局的独立视图。 */
export function SettingsProviderFields({
  disabled,
  settings,
  sttProvider,
  llmProvider,
  llmModel,
  ttsProvider,
  sttKey,
  llmKey,
  ttsKey,
  onSttProviderChange,
  onLlmProviderChange,
  onLlmModelChange,
  onTtsProviderChange,
  onSttKeyChange,
  onLlmKeyChange,
  onTtsKeyChange,
}: SettingsProviderFieldsProps) {
  return (
    <fieldset disabled={disabled} className={disabled ? "opacity-50" : ""}>
      <div className="space-y-5">
        <ProviderGroup
          idPrefix="stt"
          label={t.sttProvider}
          options={STT_OPTIONS}
          value={sttProvider}
          onChange={onSttProviderChange}
          apiKey={sttKey}
          onKeyChange={onSttKeyChange}
          hasKey={settings?.has_stt_key ?? false}
          status={settings?.stt_status}
        />

        <ProviderGroup
          idPrefix="llm"
          label={t.llmProvider}
          options={LLM_OPTIONS}
          value={llmProvider}
          onChange={onLlmProviderChange}
          apiKey={llmKey}
          onKeyChange={onLlmKeyChange}
          hasKey={settings?.has_llm_key ?? false}
          status={settings?.llm_status}
        >
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
              onChange={(event) => onLlmModelChange(event.target.value)}
              placeholder={t.llmModelPlaceholder}
              className="border-border-default focus:border-accent-soft-border focus:ring-accent-soft-border w-full rounded-md border px-3 py-1.5 text-sm transition-colors outline-none focus:ring-1"
            />
          </div>
        </ProviderGroup>

        <ProviderGroup
          idPrefix="tts"
          label={t.ttsProvider}
          options={TTS_OPTIONS}
          value={ttsProvider}
          onChange={onTtsProviderChange}
          apiKey={ttsKey}
          onKeyChange={onTtsKeyChange}
          hasKey={settings?.has_tts_key ?? false}
          status={settings?.tts_status}
        />
      </div>
    </fieldset>
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
  onChange: (value: string) => void;
  apiKey: string;
  onKeyChange: (value: string) => void;
  hasKey: boolean;
  status?: "verified" | "error" | "unconfigured";
  children?: ReactNode;
}) {
  const selectId = `${idPrefix}-provider-select`;
  const keyInputId = `${idPrefix}-key-input`;

  return (
    <div className="space-y-2">
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
          onChange={(event) => onChange(event.target.value)}
          className="border-border-default bg-surface focus:border-accent-soft-border focus:ring-accent-soft-border w-full rounded-md border px-3 py-1.5 text-sm transition-colors outline-none focus:ring-1"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {children}

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
          onChange={(event) => onKeyChange(event.target.value)}
          placeholder={hasKey ? t.apiKeyConfiguredPlaceholder : t.apiKeyPlaceholder}
          className="border-border-default focus:border-accent-soft-border focus:ring-accent-soft-border w-full rounded-md border px-3 py-1.5 text-sm transition-colors outline-none focus:ring-1"
        />
      </div>
    </div>
  );
}
