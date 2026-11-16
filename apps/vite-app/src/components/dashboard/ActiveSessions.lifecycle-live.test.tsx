/**
 * R2-LIVE 生命周期实时门禁回归测试（黑盒）。
 *
 * 这些测试验证事件到达时从同一个 conversation store 真实 getState() 读取当前启动状态，
 * 而不是继续使用挂载时的 isStartingAtMountRef 快照：
 * - 正向：挂载 busy → idle 后，resume 与 connectivity 各自发生一次真实 HTTP GET 并渲染服务端行。
 * - 反向：idle → busy 时事件不读；退出在途本身不补发；下一个合格事件才读一次。
 *
 * 使用真实 store 公共动作 + fake fetch/Response 走真实 GET 解析 + 真实平台事件（pageshow / online），
 * 以 data-testid / 模式标签识别记录，不断言当前 UUID 可见文字，也不以内部 list.fetch 次数替代行为。
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { ActiveSessions } from "./ActiveSessions";
import * as auth from "@/lib/auth";
import { useAppStore } from "@/store/appStore";
import { isStartingConversationSession } from "@/store/conversationState";
import { zhCN } from "@/i18n/zh-CN";

const t = zhCN.activeSessions;

const PRINCIPAL: auth.AuthPrincipal = {
  issuer: "https://auth.example.com",
  subject: "user-1",
};

const START_SESSION_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const FIRST_ROW_ID = "4fa85f64-5717-4562-b3fc-2c963f66afa7";
const SECOND_ROW_ID = "5fa85f64-5717-4562-b3fc-2c963f66afa8";
const STARTED_AT = "2026-10-21T10:00:00Z";

interface SessionListRow {
  id: string;
  mode: string;
  status: string;
  started_at: string;
  ended_at: string | null;
}

function row(id: string, mode: string): SessionListRow {
  return { id, mode, status: "active", started_at: STARTED_AT, ended_at: null };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface FetchRouterOptions {
  capsDeferred: ReturnType<typeof createDeferred<Response>>;
  activeItems: () => SessionListRow[];
}

function capabilitiesResponse(): Response {
  return jsonResponse({ protocol_version: 1, call_lease_mode: "disabled" });
}

function installFetchRouter({ capsDeferred, activeItems }: FetchRouterOptions) {
  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/sessions/active")) {
      return jsonResponse({ items: activeItems(), next_cursor: null });
    }
    if (url.includes("/call-capabilities")) {
      return capsDeferred.promise;
    }
    if (url.includes("/health/ready")) {
      return jsonResponse({ status: "ready" });
    }
    if (method === "POST" && url.endsWith("/sessions")) {
      return jsonResponse({
        id: START_SESSION_ID,
        user_id: PRINCIPAL.subject,
        mode: "free_talk",
        status: "active",
        started_at: STARTED_AT,
        ended_at: null,
      });
    }
    if (url.includes(`/sessions/${START_SESSION_ID}/token`)) {
      return jsonResponse({ token: "test-token", ws_url: "wss://lk.test" });
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function activeListCalls(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes("/sessions/active"))
    .length;
}

describe("R2-LIVE 生命周期实时门禁", () => {
  let currentSnapshot: auth.AuthSnapshot = {
    state: "authenticated",
    principal: PRINCIPAL,
  };
  let currentRevision = 1;
  let originalFetch: typeof globalThis.fetch;
  let originalVisibilityDescriptor: PropertyDescriptor | undefined;
  let originalOnlineDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    currentSnapshot = { state: "authenticated", principal: PRINCIPAL };
    currentRevision = 1;
    originalFetch = globalThis.fetch;
    originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    originalOnlineDescriptor = Object.getOwnPropertyDescriptor(navigator, "onLine");

    auth._resetAuthForTesting();
    auth.setAccessTokenProvider(() => "test-access-token");

    vi.spyOn(auth, "getAuthSnapshot").mockImplementation(() => currentSnapshot);
    vi.spyOn(auth, "getAuthRevision").mockImplementation(() => currentRevision);
    vi.spyOn(auth, "subscribeAuthSnapshot").mockImplementation((cb) => {
      return () => {
        void cb;
      };
    });
    vi.spyOn(auth, "arePrincipalsEqual").mockImplementation((a, b) => {
      if (a === b) return true;
      if (!a || !b) return false;
      return a.issuer === b.issuer && a.subject === b.subject;
    });

    useAppStore.getState().goHome();

    setDocumentVisibility("visible");
    setNavigatorOnline(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    restoreOwnProperty(document, "visibilityState", originalVisibilityDescriptor);
    restoreOwnProperty(navigator, "onLine", originalOnlineDescriptor);
  });

  function setDocumentVisibility(state: string | undefined) {
    Object.defineProperty(document, "visibilityState", {
      value: state,
      configurable: true,
      writable: true,
    });
  }

  function setNavigatorOnline(online: boolean | undefined) {
    Object.defineProperty(navigator, "onLine", {
      value: online,
      configurable: true,
      writable: true,
    });
  }

  function restoreOwnProperty(
    target: object,
    property: PropertyKey,
    descriptor: PropertyDescriptor | undefined,
  ) {
    if (descriptor) {
      Object.defineProperty(target, property, descriptor);
    } else {
      Reflect.deleteProperty(target, property);
    }
  }

  function dispatchOnline() {
    setNavigatorOnline(true);
    window.dispatchEvent(new Event("online"));
  }

  function dispatchPageShow() {
    window.dispatchEvent(new Event("pageshow"));
  }

  const releaseStart = async (
    capsDeferred: ReturnType<typeof createDeferred<Response>>,
    startPromise: Promise<void>,
  ) => {
    await act(async () => {
      capsDeferred.resolve(capabilitiesResponse());
      await startPromise.catch(() => {});
    });
  };

  it("R2-LIVE resume: 挂载 busy 后 idle，pageshow resume 读取并渲染服务端行", async () => {
    const capsDeferred = createDeferred<Response>();
    const activeRows = [row(FIRST_ROW_ID, "scenario")];
    const fetchMock = installFetchRouter({ capsDeferred, activeItems: () => activeRows });

    let rendered: ReturnType<typeof render> | null = null;
    let startPromise: Promise<void> | null = null;
    try {
      await act(async () => {
        startPromise = useAppStore.getState().startSession("free_talk");
      });
      expect(isStartingConversationSession(useAppStore.getState())).toBe(true);
      await waitFor(() => {
        expect(
          fetchMock.mock.calls.some(([input]) => String(input).includes("/call-capabilities")),
        ).toBe(true);
      });

      rendered = render(<ActiveSessions />);
      expect(activeListCalls(fetchMock)).toBe(0);

      await act(async () => {
        useAppStore.getState().goHome();
        expect(isStartingConversationSession(useAppStore.getState())).toBe(false);
        expect(activeListCalls(fetchMock)).toBe(0);
        dispatchPageShow();
      });

      await waitFor(() => {
        expect(screen.getByTestId(`active-session-item-${FIRST_ROW_ID}`)).toBeInTheDocument();
      });
      expect(activeListCalls(fetchMock)).toBe(1);
      expect(screen.getByTestId(`session-mode-${FIRST_ROW_ID}`)).toHaveTextContent(
        t.modes.scenario,
      );
    } finally {
      rendered?.unmount();
      useAppStore.getState().goHome();
      if (startPromise) {
        await releaseStart(capsDeferred, startPromise);
      }
    }
  });

  it("R2-LIVE connectivity: 挂载 busy 后 idle，online connectivity 读取并渲染服务端行", async () => {
    const capsDeferred = createDeferred<Response>();
    const activeRows = [row(FIRST_ROW_ID, "pronunciation")];
    const fetchMock = installFetchRouter({ capsDeferred, activeItems: () => activeRows });

    let rendered: ReturnType<typeof render> | null = null;
    let startPromise: Promise<void> | null = null;
    try {
      await act(async () => {
        startPromise = useAppStore.getState().startSession("free_talk");
      });
      expect(isStartingConversationSession(useAppStore.getState())).toBe(true);
      await waitFor(() => {
        expect(
          fetchMock.mock.calls.some(([input]) => String(input).includes("/call-capabilities")),
        ).toBe(true);
      });

      // 只改 navigator.onLine 属性、不派发 offline 事件，避免取消 pending 启动；
      // 组件适配器在挂载时读取该离线快照，随后 online 事件才能触发 connectivity。
      setNavigatorOnline(false);

      rendered = render(<ActiveSessions />);
      expect(activeListCalls(fetchMock)).toBe(0);

      await act(async () => {
        useAppStore.getState().goHome();
        expect(isStartingConversationSession(useAppStore.getState())).toBe(false);
        expect(activeListCalls(fetchMock)).toBe(0);
        dispatchOnline();
      });

      await waitFor(() => {
        expect(screen.getByTestId(`active-session-item-${FIRST_ROW_ID}`)).toBeInTheDocument();
      });
      expect(activeListCalls(fetchMock)).toBe(1);
      expect(screen.getByTestId(`session-mode-${FIRST_ROW_ID}`)).toHaveTextContent(
        t.modes.pronunciation,
      );
    } finally {
      rendered?.unmount();
      useAppStore.getState().goHome();
      if (startPromise) {
        await releaseStart(capsDeferred, startPromise);
      }
    }
  });

  it("R2-LIVE reverse: idle→busy 不读、退出在途不补发、下一合格事件才读一次", async () => {
    const capsDeferred = createDeferred<Response>();
    const activeRows: SessionListRow[] = [row(FIRST_ROW_ID, "free_talk")];
    const fetchMock = installFetchRouter({ capsDeferred, activeItems: () => activeRows });

    let rendered: ReturnType<typeof render> | null = null;
    let startPromise: Promise<void> | null = null;
    try {
      rendered = render(<ActiveSessions />);
      await waitFor(() => {
        expect(screen.getByTestId(`active-session-item-${FIRST_ROW_ID}`)).toBeInTheDocument();
      });
      expect(activeListCalls(fetchMock)).toBe(1);

      await act(async () => {
        startPromise = useAppStore.getState().startSession("free_talk");
      });
      expect(isStartingConversationSession(useAppStore.getState())).toBe(true);
      await waitFor(() => {
        expect(
          fetchMock.mock.calls.some(([input]) => String(input).includes("/call-capabilities")),
        ).toBe(true);
      });

      await act(async () => {
        dispatchPageShow();
      });
      expect(activeListCalls(fetchMock)).toBe(1);

      activeRows.push(row(SECOND_ROW_ID, "scenario"));
      await act(async () => {
        useAppStore.getState().goHome();
      });
      expect(isStartingConversationSession(useAppStore.getState())).toBe(false);
      expect(activeListCalls(fetchMock)).toBe(1);

      await act(async () => {
        dispatchPageShow();
      });

      await waitFor(() => {
        expect(screen.getByTestId(`active-session-item-${SECOND_ROW_ID}`)).toBeInTheDocument();
      });
      expect(activeListCalls(fetchMock)).toBe(2);
      expect(screen.getByTestId(`session-mode-${SECOND_ROW_ID}`)).toHaveTextContent(
        t.modes.scenario,
      );
    } finally {
      rendered?.unmount();
      useAppStore.getState().goHome();
      if (startPromise) {
        await releaseStart(capsDeferred, startPromise);
      }
    }
  });
});
