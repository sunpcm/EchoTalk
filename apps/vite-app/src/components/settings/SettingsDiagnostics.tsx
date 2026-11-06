import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  clearDiagnosticBuffer,
  getDiagnosticGeneration,
  getDiagnosticSnapshot,
  subscribeDiagnosticBuffer,
} from "@/lib/diagnostics";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.settings.diagnostics;

export function SettingsDiagnostics() {
  const records = useSyncExternalStore(subscribeDiagnosticBuffer, getDiagnosticSnapshot);
  const generation = getDiagnosticGeneration();
  const mountedRef = useRef(false);
  const operationRef = useRef(0);
  const [notice, setNotice] = useState<{ generation: number; message: string } | null>(null);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
    };
  }, []);

  const isCurrent = (operation: number, owner: number) =>
    mountedRef.current && operationRef.current === operation && getDiagnosticGeneration() === owner;

  const copyRecords = async () => {
    const operation = ++operationRef.current;
    const owner = getDiagnosticGeneration();
    const currentRecords = getDiagnosticSnapshot();
    const show = (message: string) => {
      if (isCurrent(operation, owner)) setNotice({ generation: owner, message });
    };

    if (currentRecords.length === 0) {
      show(t.empty);
      return;
    }

    try {
      const clipboard = navigator.clipboard;
      const writeText = clipboard?.writeText;
      if (typeof writeText !== "function") {
        show(t.unsupported);
        return;
      }
      if (!isCurrent(operation, owner)) return;
      show(t.copying);
      await writeText.call(clipboard, JSON.stringify(currentRecords, null, 2));
      show(t.copied);
    } catch {
      show(t.copyFailed);
    }
  };

  const clearRecords = () => {
    const operation = ++operationRef.current;
    const owner = getDiagnosticGeneration() + 1;
    clearDiagnosticBuffer();
    if (isCurrent(operation, owner)) setNotice({ generation: owner, message: t.cleared });
  };

  return (
    <section aria-labelledby="settings-diagnostics-title" className="min-w-0 space-y-3">
      <h3 id="settings-diagnostics-title" className="text-text-default text-sm font-medium">
        {t.title}
      </h3>
      <p className="text-text-muted text-xs">{t.description}</p>
      <p className="text-text-muted text-xs">
        {t.count.replace("{count}", String(records.length))}
      </p>
      <label htmlFor="settings-diagnostics-preview" className="text-text-default block text-xs">
        {t.preview}
      </label>
      <textarea
        id="settings-diagnostics-preview"
        readOnly
        rows={8}
        value={records.length === 0 ? "" : JSON.stringify(records, null, 2)}
        placeholder={t.empty}
        className="border-border-default bg-bg text-text-default focus-visible:ring-accent block w-full min-w-0 rounded-lg border p-3 font-mono text-xs focus-visible:ring-2 focus-visible:outline-none"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void copyRecords()}
          className="border-border-default text-text-default focus-visible:ring-accent min-h-[44px] rounded-lg border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          {t.copy}
        </button>
        <button
          type="button"
          onClick={clearRecords}
          className="border-border-default text-text-default focus-visible:ring-accent min-h-[44px] rounded-lg border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          {t.clear}
        </button>
      </div>
      <p role="status" className="text-text-muted text-xs">
        {notice?.generation === generation ? notice.message : ""}
      </p>
    </section>
  );
}
