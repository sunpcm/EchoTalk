import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDiagnosticBuffer,
  getDiagnosticSnapshot,
  logDiagnostic,
  subscribeDiagnosticBuffer,
} from "@/lib/diagnostics";
import { zhCN } from "@/i18n/zh-CN";
import { SettingsDiagnostics } from "./SettingsDiagnostics";

const auth = vi.hoisted(() => ({ revision: 1, listeners: new Set<() => void>() }));
vi.mock("@/lib/auth", () => ({
  getAuthRevision: () => auth.revision,
  subscribeAuthSnapshot: (listener: () => void) => {
    auth.listeners.add(listener);
    return () => auth.listeners.delete(listener);
  },
}));

const t = zhCN.settings.diagnostics;

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function installClipboard(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

function copy() {
  fireEvent.click(screen.getByRole("button", { name: t.copy }));
}

async function settle(pending: ReturnType<typeof deferred>, result: "resolve" | "reject") {
  await act(async () => {
    if (result === "resolve") pending.resolve();
    else pending.reject(new Error("synthetic-clipboard-error-canary"));
    await Promise.resolve();
  });
}

describe("SettingsDiagnostics", () => {
  let clipboardDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    auth.revision = 1;
    clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    clearDiagnosticBuffer();
  });

  afterEach(() => {
    cleanup();
    expect(auth.listeners.size).toBe(0);
    clearDiagnosticBuffer();
    vi.restoreAllMocks();
    if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    else Reflect.deleteProperty(navigator, "clipboard");
  });

  it("shows an empty, readonly selectable preview and gives empty feedback without copying", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installClipboard(writeText);
    render(<SettingsDiagnostics />);
    expect(screen.getByRole("region", { name: t.title })).toBeInTheDocument();
    const preview = screen.getByRole("textbox", { name: t.preview });
    expect(preview).toHaveAttribute("readonly");
    expect(preview).toHaveValue("");
    expect(preview).toHaveAttribute("placeholder", t.empty);
    copy();
    expect(screen.getByRole("status")).toHaveTextContent(t.empty);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies real safe logs only on request without network or storage writes", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installClipboard(writeText);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected diagnostic network request"));
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");
    render(<SettingsDiagnostics />);
    act(() => {
      logDiagnostic("api_http_failed", Object.freeze({ status: 503, body: "body-canary" }));
    });
    const expected = JSON.stringify(getDiagnosticSnapshot(), null, 2);
    expect(screen.getByRole("textbox", { name: t.preview })).toHaveValue(expected);
    expect(screen.getByText(t.count.replace("{count}", "1"))).toBeInTheDocument();
    expect(expected).not.toContain("body-canary");
    expect(writeText).not.toHaveBeenCalled();
    await act(async () => {
      copy();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(expected);
    expect(screen.getByRole("status")).toHaveTextContent(t.copied);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it("keeps selectable preview when clipboard is unsupported or throws synchronously", () => {
    installClipboard();
    logDiagnostic("api_network_failed");
    render(<SettingsDiagnostics />);
    copy();
    expect(screen.getByRole("status")).toHaveTextContent(t.unsupported);
    const preview = screen.getByRole("textbox", { name: t.preview }) as HTMLTextAreaElement;
    preview.focus();
    preview.select();
    expect(preview.selectionEnd).toBe(preview.value.length);
    installClipboard(() => {
      throw new Error("synthetic-clipboard-error-canary");
    });
    copy();
    expect(screen.getByRole("status")).toHaveTextContent(t.copyFailed);
    expect(preview.value).not.toContain("synthetic-clipboard-error-canary");
    expect(getDiagnosticSnapshot()).toHaveLength(1);
  });

  it("can recover with a new copy after a rejected request", async () => {
    const failed = deferred();
    const writeText = vi
      .fn()
      .mockImplementationOnce(() => failed.promise)
      .mockResolvedValue(undefined);
    installClipboard(writeText);
    logDiagnostic("api_network_failed");
    render(<SettingsDiagnostics />);
    copy();
    expect(screen.getByRole("status")).toHaveTextContent(t.copying);
    await settle(failed, "reject");
    expect(screen.getByRole("status")).toHaveTextContent(t.copyFailed);
    expect(screen.getByRole("textbox", { name: t.preview })).not.toHaveValue("");
    await act(async () => {
      copy();
    });
    expect(screen.getByRole("status")).toHaveTextContent(t.copied);
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it("does not copy stale content if accessing the clipboard reenters account cleanup", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    logDiagnostic("api_network_failed");
    render(<SettingsDiagnostics />);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      get() {
        clearDiagnosticBuffer();
        return { writeText };
      },
    });
    copy();
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: t.preview })).toHaveValue("");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it.each(["resolve", "reject"] as const)(
    "ignores late copy %s after clear and lets a new copy recover",
    async (result) => {
      const stale = deferred();
      const writeText = vi
        .fn()
        .mockImplementationOnce(() => stale.promise)
        .mockResolvedValue(undefined);
      installClipboard(writeText);
      logDiagnostic("api_network_failed");
      render(<SettingsDiagnostics />);
      copy();
      fireEvent.click(screen.getByRole("button", { name: t.clear }));
      expect(screen.getByRole("status")).toHaveTextContent(t.cleared);
      expect(screen.getByRole("textbox", { name: t.preview })).toHaveValue("");
      await settle(stale, result);
      expect(screen.getByRole("status")).toHaveTextContent(t.cleared);
      act(() => {
        logDiagnostic("api_http_failed", { status: 502 });
      });
      await act(async () => {
        copy();
      });
      expect(screen.getByRole("status")).toHaveTextContent(t.copied);
      expect(JSON.parse(writeText.mock.calls[1][0])).toEqual(getDiagnosticSnapshot());
    },
  );

  it.each(["resolve", "reject"] as const)(
    "ignores late copy %s across unmount/reopen",
    async (result) => {
      const stale = deferred();
      const current = deferred();
      const writeText = vi
        .fn()
        .mockImplementationOnce(() => stale.promise)
        .mockImplementationOnce(() => current.promise);
      installClipboard(writeText);
      logDiagnostic("api_network_failed");
      const old = render(<SettingsDiagnostics />);
      copy();
      old.unmount();
      expect(auth.listeners.size).toBe(0);
      render(<SettingsDiagnostics />);
      copy();
      await settle(stale, result);
      expect(screen.getByRole("status")).toHaveTextContent(t.copying);
      await settle(current, "resolve");
      expect(screen.getByRole("status")).toHaveTextContent(t.copied);
    },
  );

  it.each(["resolve", "reject"] as const)(
    "invalidates copy %s and visible feedback on auth revision change with a mounted UI",
    async (result) => {
      const stale = deferred();
      installClipboard(vi.fn().mockReturnValue(stale.promise));
      logDiagnostic("api_network_failed");
      render(<SettingsDiagnostics />);
      copy();
      act(() => {
        auth.revision += 1;
        for (const listener of Array.from(auth.listeners)) listener();
      });
      expect(screen.getByRole("textbox", { name: t.preview })).toHaveValue("");
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
      await settle(stale, result);
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
      act(() => {
        logDiagnostic("agent_dispatch_failed");
      });
      installClipboard(vi.fn().mockResolvedValue(undefined));
      await act(async () => {
        copy();
      });
      expect(screen.getByRole("status")).toHaveTextContent(t.copied);
    },
  );

  it.each(["resolve", "reject"] as const)(
    "keeps a newer copy result when an earlier copy %s arrives late",
    async (result) => {
      const stale = deferred();
      const current = deferred();
      installClipboard(
        vi
          .fn()
          .mockImplementationOnce(() => stale.promise)
          .mockImplementationOnce(() => current.promise),
      );
      logDiagnostic("api_network_failed");
      render(<SettingsDiagnostics />);
      copy();
      copy();
      await settle(current, "resolve");
      await settle(stale, result);
      expect(screen.getByRole("status")).toHaveTextContent(t.copied);
    },
  );

  it("invalidates old feedback when the shared account cleanup runs without an auth event", () => {
    logDiagnostic("api_network_failed");
    render(<SettingsDiagnostics />);
    installClipboard();
    copy();
    expect(screen.getByRole("status")).toHaveTextContent(t.unsupported);
    act(() => {
      clearDiagnosticBuffer();
    });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.getByRole("textbox", { name: t.preview })).toHaveValue("");
  });

  it("discards clear feedback after a subscriber synchronously changes auth generation", async () => {
    logDiagnostic("api_network_failed");
    installClipboard(vi.fn().mockResolvedValue(undefined));
    render(<SettingsDiagnostics />);
    let changeOnce = true;
    const stop = subscribeDiagnosticBuffer(() => {
      if (!changeOnce) return;
      changeOnce = false;
      auth.revision += 1;
      for (const listener of Array.from(auth.listeners)) listener();
      logDiagnostic("agent_dispatch_failed");
    });
    try {
      fireEvent.click(screen.getByRole("button", { name: t.clear }));
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
      expect(getDiagnosticSnapshot().map((record) => record.event)).toEqual([
        "agent_dispatch_failed",
      ]);
      await act(async () => {
        copy();
      });
      expect(screen.getByRole("status")).toHaveTextContent(t.copied);
    } finally {
      stop();
    }
  });

  it("cleans subscriptions in StrictMode and does not replay a copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    installClipboard(writeText);
    logDiagnostic("api_network_failed");
    const { unmount } = render(
      <StrictMode>
        <SettingsDiagnostics />
      </StrictMode>,
    );
    expect(auth.listeners.size).toBe(1);
    expect(writeText).not.toHaveBeenCalled();
    await act(async () => {
      copy();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    unmount();
    expect(auth.listeners.size).toBe(0);
  });
});
