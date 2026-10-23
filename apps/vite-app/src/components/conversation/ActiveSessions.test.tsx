import React, { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { ActiveSessions } from "./ActiveSessions";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";
import { useConversationStore } from "@/store/conversation";
import { zhCN } from "@/i18n/zh-CN";

const fakeAppListeners = new Set<(state: { isActive: boolean }) => void>();
let fakeAppGetState = vi.fn().mockImplementation(() => Promise.resolve({ isActive: true }));
let fakeAppAddListener = vi
  .fn()
  .mockImplementation((_event: string, listener: (state: { isActive: boolean }) => void) => {
    fakeAppListeners.add(listener);
    return Promise.resolve({
      remove: vi.fn().mockImplementation(() => {
        fakeAppListeners.delete(listener);
        return Promise.resolve();
      }),
    });
  });

vi.mock("@capacitor/app", () => ({
  App: {
    getState: (...args: unknown[]) => fakeAppGetState(...args),
    addListener: (...args: unknown[]) => fakeAppAddListener(...args),
  },
}));

const t = zhCN.activeSessions;

function createDeferred<T>() {
  let resolve!: (val: T) => void;
  let reject!: (err: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ActiveSessions Component", () => {
  let listeners: Array<(snap: auth.AuthSnapshot) => void> = [];
  let currentSnapshot: auth.AuthSnapshot = {
    state: "authenticated",
    principal: { issuer: "https://auth.example.com", subject: "user-1" },
  };
  let currentRevision = 1;

  beforeEach(() => {
    listeners = [];
    currentSnapshot = {
      state: "authenticated",
      principal: { issuer: "https://auth.example.com", subject: "user-1" },
    };
    currentRevision = 1;
    useConversationStore.getState().goHome();

    vi.spyOn(auth, "getAuthSnapshot").mockImplementation(() => currentSnapshot);
    vi.spyOn(auth, "getAuthRevision").mockImplementation(() => currentRevision);
    vi.spyOn(auth, "subscribeAuthSnapshot").mockImplementation((cb) => {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter((l) => l !== cb);
      };
    });
    vi.spyOn(auth, "arePrincipalsEqual").mockImplementation((a, b) => {
      if (a === b) return true;
      if (!a || !b) return false;
      return a.issuer === b.issuer && a.subject === b.subject;
    });

    setDocumentVisibility("visible");
    setNavigatorOnline(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setDocumentVisibility("visible");
    setNavigatorOnline(true);
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

  function dispatchVisibilityChange(state?: "visible" | "hidden") {
    if (state !== undefined) {
      setDocumentVisibility(state);
    }
    document.dispatchEvent(new Event("visibilitychange"));
  }

  function dispatchOnline() {
    setNavigatorOnline(true);
    window.dispatchEvent(new Event("online"));
  }

  function dispatchOffline() {
    setNavigatorOnline(false);
    window.dispatchEvent(new Event("offline"));
  }

  function dispatchPageShow() {
    window.dispatchEvent(new Event("pageshow"));
  }

  function dispatchPageHide() {
    window.dispatchEvent(new Event("pagehide"));
  }

  const emitAuthSnapshot = (snap: auth.AuthSnapshot, bumpRevision = true) => {
    currentSnapshot = snap;
    if (bumpRevision) {
      currentRevision += 1;
    }
    listeners.forEach((cb) => cb(snap));
  };

  describe("Basic rendering & modes", () => {
    it("renders loading initially, disclaimer, title, and then active sessions list", async () => {
      const deferred = createDeferred<api.SessionListItem[]>();
      vi.spyOn(api, "listActiveSessions").mockReturnValue(deferred.promise);

      render(<ActiveSessions />);

      expect(screen.getByText(t.title)).toBeInTheDocument();
      expect(screen.getByText(t.disclaimer)).toBeInTheDocument();
      expect(screen.getByText(t.loading)).toBeInTheDocument();

      const mockData: api.SessionListItem[] = [
        {
          id: "session-abc-123",
          mode: "free_talk",
          status: "active",
          started_at: "2026-10-21T10:00:00Z",
          ended_at: null,
        },
      ];

      await act(async () => {
        deferred.resolve(mockData);
      });

      expect(screen.queryByText(t.loading)).not.toBeInTheDocument();
      expect(screen.getByTestId("session-id-session-abc-123")).toHaveTextContent("session-abc-123");
      expect(screen.getByTestId("session-mode-session-abc-123")).toHaveTextContent(
        t.modes.free_talk,
      );
      expect(screen.getByTestId("session-started-at-session-abc-123")).toBeInTheDocument();

      // 验证提供本地化“恢复练习”与“结束记录”，无接管或开始按钮
      expect(screen.queryByRole("button", { name: /接管|开始/ })).not.toBeInTheDocument();
      expect(screen.getByTestId("resume-session-button-session-abc-123")).toHaveTextContent(
        t.resumeRecord,
      );
      expect(screen.getByTestId("end-session-button-session-abc-123")).toHaveTextContent(
        t.endRecord,
      );
    });

    it("renders empty state when session list is empty", async () => {
      vi.spyOn(api, "listActiveSessions").mockResolvedValue([]);

      render(<ActiveSessions />);

      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByText(t.empty)).toBeInTheDocument();
      expect(screen.queryByTestId("active-sessions-list")).not.toBeInTheDocument();
    });

    it("renders generic label for unknown modes", async () => {
      const mockData: api.SessionListItem[] = [
        {
          id: "sess-unknown",
          mode: "custom_unsupported_mode",
          status: "active",
          started_at: "2026-10-21T10:00:00Z",
          ended_at: null,
        },
      ];
      vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockData);

      render(<ActiveSessions />);

      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByTestId("session-mode-sess-unknown")).toHaveTextContent(t.unknownMode);
    });

    it.each(["constructor", "toString", "__proto__", "valueOf", "isPrototypeOf"])(
      "safely renders generic unknownMode label when session mode matches Object prototype property '%s'",
      async (specialMode) => {
        const mockData: api.SessionListItem[] = [
          {
            id: `sess-${specialMode}`,
            mode: specialMode,
            status: "active",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: null,
          },
        ];
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockData);

        render(<ActiveSessions />);

        await act(async () => {
          await Promise.resolve();
        });

        const badge = screen.getByTestId(`session-mode-sess-${specialMode}`);
        expect(badge).toHaveTextContent(t.unknownMode);
      },
    );

    it.each([
      ["free_talk", t.modes.free_talk],
      ["doc_chat", t.modes.doc_chat],
      ["pronunciation", t.modes.pronunciation],
      ["conversation", t.modes.conversation],
      ["scenario", t.modes.scenario],
      ["exam_prep", t.modes.exam_prep],
    ])("renders correct localized label for known mode '%s'", async (mode, expectedLabel) => {
      const mockData: api.SessionListItem[] = [
        {
          id: `sess-${mode}`,
          mode,
          status: "active",
          started_at: "2026-10-21T10:00:00Z",
          ended_at: null,
        },
      ];
      vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockData);

      render(<ActiveSessions />);

      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByTestId(`session-mode-sess-${mode}`)).toHaveTextContent(expectedLabel);
    });

    it("preserves backend order in rendering", async () => {
      const mockData: api.SessionListItem[] = [
        {
          id: "sess-2",
          mode: "doc_chat",
          status: "active",
          started_at: "2026-10-21T11:00:00Z",
          ended_at: null,
        },
        {
          id: "sess-1",
          mode: "scenario",
          status: "active",
          started_at: "2026-10-21T09:00:00Z",
          ended_at: null,
        },
      ];
      vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockData);

      render(<ActiveSessions />);

      await act(async () => {
        await Promise.resolve();
      });

      const items = screen.getAllByRole("listitem");
      expect(items[0]).toHaveTextContent("sess-2");
      expect(items[1]).toHaveTextContent("sess-1");
    });
  });

  describe("Error handling and retry", () => {
    it("shows generic error message without leaking server error details and supports retry", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions");
      const deferred1 = createDeferred<api.SessionListItem[]>();
      listSpy.mockReturnValueOnce(deferred1.promise);

      render(<ActiveSessions />);

      await act(async () => {
        deferred1.reject(new Error("Database connection leak detail on internal port 5432"));
      });

      // 显示通用错误
      expect(screen.getByText(t.loadError)).toBeInTheDocument();
      // 绝不回显服务端报错详情
      expect(screen.queryByText(/Database connection leak/)).not.toBeInTheDocument();

      // 重试按钮可用
      const retryBtn = screen.getByRole("button", { name: t.retry });
      expect(retryBtn).toBeInTheDocument();
      expect(retryBtn).not.toBeDisabled();

      // 点击重试
      const deferred2 = createDeferred<api.SessionListItem[]>();
      listSpy.mockReturnValueOnce(deferred2.promise);

      fireEvent.click(retryBtn);
      expect(listSpy).toHaveBeenCalledTimes(2);

      await act(async () => {
        deferred2.resolve([
          {
            id: "sess-recovered",
            mode: "free_talk",
            status: "active",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: null,
          },
        ]);
      });

      expect(screen.queryByText(t.loadError)).not.toBeInTheDocument();
      expect(screen.getByText("sess-recovered")).toBeInTheDocument();
    });

    it("prevents duplicate requests during retry in-flight", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions");
      listSpy.mockRejectedValueOnce(new Error("fail"));

      render(<ActiveSessions />);

      await act(async () => {
        await Promise.resolve();
      });

      const retryBtn = screen.getByRole("button", { name: t.retry });
      const deferred = createDeferred<api.SessionListItem[]>();
      listSpy.mockReturnValueOnce(deferred.promise);

      fireEvent.click(retryBtn);
      // 在途状态下再次点击
      fireEvent.click(retryBtn);
      fireEvent.click(retryBtn);

      expect(listSpy).toHaveBeenCalledTimes(2); // 初次 + 单次重试

      await act(async () => {
        deferred.resolve([]);
      });
    });
  });

  describe("Auth state boundaries and isolation", () => {
    it.each(["loading", "anonymous", "misconfigured"] as const)(
      "does not send list request and renders nothing when auth state is %s",
      async (state) => {
        currentSnapshot = { state, principal: null };
        const listSpy = vi.spyOn(api, "listActiveSessions");

        const { container } = render(<ActiveSessions />);

        await act(async () => {
          await Promise.resolve();
        });

        expect(listSpy).not.toHaveBeenCalled();
        expect(container).toBeEmptyDOMElement();
      },
    );

    it("clears data immediately upon logout and ignores stale in-flight response", async () => {
      const deferred = createDeferred<api.SessionListItem[]>();
      vi.spyOn(api, "listActiveSessions").mockReturnValue(deferred.promise);

      const { container } = render(<ActiveSessions />);

      expect(screen.getByText(t.loading)).toBeInTheDocument();

      // 在请求在途期间发生退出
      await act(async () => {
        emitAuthSnapshot({ state: "anonymous", principal: null });
      });

      // 退出立即清空 UI
      expect(container).toBeEmptyDOMElement();

      // 旧请求迟到成功
      await act(async () => {
        deferred.resolve([
          {
            id: "stale-session-id",
            mode: "free_talk",
            status: "active",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: null,
          },
        ]);
      });

      // 依然为空，不被旧数据回填污染
      expect(container).toBeEmptyDOMElement();
      expect(screen.queryByText("stale-session-id")).not.toBeInTheDocument();
    });

    it("clears data upon account switch and fetches for the new account", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions");
      const deferred1 = createDeferred<api.SessionListItem[]>();
      listSpy.mockReturnValueOnce(deferred1.promise);

      render(<ActiveSessions />);

      // 换号到 user-2
      const deferred2 = createDeferred<api.SessionListItem[]>();
      listSpy.mockReturnValueOnce(deferred2.promise);

      await act(async () => {
        emitAuthSnapshot({
          state: "authenticated",
          principal: { issuer: "https://auth.example.com", subject: "user-2" },
        });
      });

      expect(listSpy).toHaveBeenCalledTimes(2);

      // 旧 user-1 的请求迟到返回
      await act(async () => {
        deferred1.resolve([
          {
            id: "user-1-session",
            mode: "free_talk",
            status: "active",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: null,
          },
        ]);
      });

      // 不应展示 user-1 的数据
      expect(screen.queryByText("user-1-session")).not.toBeInTheDocument();

      // 新 user-2 请求返回
      await act(async () => {
        deferred2.resolve([
          {
            id: "user-2-session",
            mode: "doc_chat",
            status: "active",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: null,
          },
        ]);
      });

      expect(screen.getByText("user-2-session")).toBeInTheDocument();
      expect(screen.queryByText("user-1-session")).not.toBeInTheDocument();
    });

    it("ignores old request when same principal logs out and logs in again with new revision", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions");
      const deferred1 = createDeferred<api.SessionListItem[]>();
      listSpy.mockReturnValueOnce(deferred1.promise);

      render(<ActiveSessions />);

      // 同账号登出再登入，生成新 revision
      const deferred2 = createDeferred<api.SessionListItem[]>();
      listSpy.mockReturnValueOnce(deferred2.promise);

      await act(async () => {
        // 登出
        emitAuthSnapshot({ state: "anonymous", principal: null }, true);
      });

      await act(async () => {
        // 同 principal 重新登入，revision 再次递增
        emitAuthSnapshot(
          {
            state: "authenticated",
            principal: { issuer: "https://auth.example.com", subject: "user-1" },
          },
          true,
        );
      });

      expect(listSpy).toHaveBeenCalledTimes(2);

      // 第一次请求迟到返回错误
      await act(async () => {
        deferred1.reject(new Error("Old request failed"));
      });

      // 绝不能把旧错误覆盖到新请求上
      expect(screen.queryByText(t.loadError)).not.toBeInTheDocument();

      // 第二次请求成功返回
      await act(async () => {
        deferred2.resolve([
          {
            id: "relogin-fresh-session",
            mode: "free_talk",
            status: "active",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: null,
          },
        ]);
      });

      expect(screen.getByText("relogin-fresh-session")).toBeInTheDocument();
    });
  });

  describe("Deferred timing, race conditions & StrictMode", () => {
    it("handles out-of-order responses by discarding older request", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions");
      const deferred1 = createDeferred<api.SessionListItem[]>();
      listSpy.mockReturnValueOnce(deferred1.promise);

      render(<ActiveSessions />);

      // 触发新请求（例如 revision 更新）
      const deferred2 = createDeferred<api.SessionListItem[]>();
      listSpy.mockReturnValueOnce(deferred2.promise);

      await act(async () => {
        emitAuthSnapshot(
          {
            state: "authenticated",
            principal: { issuer: "https://auth.example.com", subject: "user-1" },
          },
          true,
        );
      });

      // 第二个请求先返回
      await act(async () => {
        deferred2.resolve([
          {
            id: "newer-session-data",
            mode: "free_talk",
            status: "active",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: null,
          },
        ]);
      });

      expect(screen.getByText("newer-session-data")).toBeInTheDocument();

      // 第一个请求迟到返回
      await act(async () => {
        deferred1.resolve([
          {
            id: "older-stale-session-data",
            mode: "doc_chat",
            status: "active",
            started_at: "2026-10-21T09:00:00Z",
            ended_at: null,
          },
        ]);
      });

      // 页面应依然展示 newer-session-data，绝不被旧数据冲掉
      expect(screen.getByText("newer-session-data")).toBeInTheDocument();
      expect(screen.queryByText("older-stale-session-data")).not.toBeInTheDocument();
    });

    it("safely unmounts without writing state when in-flight request resolves or rejects", async () => {
      const deferred = createDeferred<api.SessionListItem[]>();
      vi.spyOn(api, "listActiveSessions").mockReturnValue(deferred.promise);

      const { unmount } = render(<ActiveSessions />);
      unmount();

      // 卸载后解析，不抛出异常或更新已卸载组件状态
      await act(async () => {
        deferred.resolve([
          {
            id: "sess-after-unmount",
            mode: "free_talk",
            status: "active",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: null,
          },
        ]);
      });
    });

    it("operates normally under React StrictMode", async () => {
      const deferred = createDeferred<api.SessionListItem[]>();
      vi.spyOn(api, "listActiveSessions").mockReturnValue(deferred.promise);

      render(
        <StrictMode>
          <ActiveSessions />
        </StrictMode>,
      );

      await act(async () => {
        deferred.resolve([
          {
            id: "strict-mode-session",
            mode: "free_talk",
            status: "active",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: null,
          },
        ]);
      });

      expect(screen.getByText("strict-mode-session")).toBeInTheDocument();
    });
  });

  describe("Cross-platform lifecycle driving dashboard discovery", () => {
    describe("Initial mount and auth change lifecycle gates", () => {
      it("does not fetch list when initially mounted in hidden visibilityState", async () => {
        setDocumentVisibility("hidden");
        const listSpy = vi.spyOn(api, "listActiveSessions");

        render(<ActiveSessions />);

        await act(async () => {
          await Promise.resolve();
        });

        expect(listSpy).not.toHaveBeenCalled();
        expect(screen.queryByText(t.loading)).not.toBeInTheDocument();
      });

      it("does not fetch list when initially mounted offline (navigator.onLine = false)", async () => {
        setNavigatorOnline(false);
        const listSpy = vi.spyOn(api, "listActiveSessions");

        render(<ActiveSessions />);

        await act(async () => {
          await Promise.resolve();
        });

        expect(listSpy).not.toHaveBeenCalled();
        expect(screen.queryByText(t.loading)).not.toBeInTheDocument();
      });

      it("allows discovery on initial mount when visibility is unknown or online is null", async () => {
        const listSpy = vi.spyOn(api, "listActiveSessions");
        listSpy.mockResolvedValueOnce([]);

        setDocumentVisibility(undefined);
        setNavigatorOnline(undefined);

        render(<ActiveSessions />);

        await act(async () => {
          await Promise.resolve();
        });

        expect(listSpy).toHaveBeenCalledTimes(1);
      });

      it("when account changes while backgrounded or offline, previous account data is cleared immediately and new account discovery is deferred until eligible lifecycle event", async () => {
        const listSpy = vi.spyOn(api, "listActiveSessions");
        const initialData: api.SessionListItem[] = [
          {
            id: "user-1-initial-session",
            mode: "free_talk",
            status: "active",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: null,
          },
        ];
        listSpy.mockResolvedValueOnce(initialData);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });
        expect(screen.getByText("user-1-initial-session")).toBeInTheDocument();
        expect(listSpy).toHaveBeenCalledTimes(1);

        // 1. 进入后台
        await act(async () => {
          dispatchVisibilityChange("hidden");
        });

        // 2. 在后台期间，账号切换为 user-2
        await act(async () => {
          emitAuthSnapshot({
            state: "authenticated",
            principal: { issuer: "https://auth.example.com", subject: "user-2" },
          });
        });

        // 旧账号数据已立即清空
        expect(screen.queryByText("user-1-initial-session")).not.toBeInTheDocument();
        // 处于后台，门禁阻止发起网络请求
        expect(listSpy).toHaveBeenCalledTimes(1);

        // 3. 切回前台
        const user2Data: api.SessionListItem[] = [
          {
            id: "user-2-resumed-session",
            mode: "doc_chat",
            status: "active",
            started_at: "2026-10-21T11:00:00Z",
            ended_at: null,
          },
        ];
        listSpy.mockResolvedValueOnce(user2Data);

        await act(async () => {
          dispatchVisibilityChange("visible");
        });

        // 恢复前台后，读取当前 user-2 身份发起请求
        expect(listSpy).toHaveBeenCalledTimes(2);
        await act(async () => {
          await Promise.resolve();
        });
        expect(screen.getByText("user-2-resumed-session")).toBeInTheDocument();
      });
    });

    describe("Resume & connectivity gating and deduplication", () => {
      it("fetches active sessions on resume event when visible and online", async () => {
        setDocumentVisibility("hidden");
        const listSpy = vi.spyOn(api, "listActiveSessions");
        listSpy.mockResolvedValueOnce([
          {
            id: "resumed-session-1",
            mode: "free_talk",
            status: "active",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: null,
          },
        ]);

        render(<ActiveSessions />);
        expect(listSpy).not.toHaveBeenCalled();

        await act(async () => {
          dispatchVisibilityChange("visible");
        });

        expect(listSpy).toHaveBeenCalledTimes(1);
        await act(async () => {
          await Promise.resolve();
        });
        expect(screen.getByText("resumed-session-1")).toBeInTheDocument();
      });

      it("does not fetch on resume event if offline (online = false)", async () => {
        setDocumentVisibility("hidden");
        setNavigatorOnline(false);
        const listSpy = vi.spyOn(api, "listActiveSessions");

        render(<ActiveSessions />);
        expect(listSpy).not.toHaveBeenCalled();

        await act(async () => {
          dispatchVisibilityChange("visible");
        });

        // 虽恢复 visible，但仍为 offline，不发请求
        expect(listSpy).not.toHaveBeenCalled();
      });

      it("fetches active sessions on connectivity event when online=true and visible", async () => {
        setNavigatorOnline(false);
        const listSpy = vi.spyOn(api, "listActiveSessions");
        listSpy.mockResolvedValueOnce([
          {
            id: "online-session-1",
            mode: "pronunciation",
            status: "active",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: null,
          },
        ]);

        render(<ActiveSessions />);
        expect(listSpy).not.toHaveBeenCalled();

        await act(async () => {
          dispatchOnline();
        });

        expect(listSpy).toHaveBeenCalledTimes(1);
        await act(async () => {
          await Promise.resolve();
        });
        expect(screen.getByText("online-session-1")).toBeInTheDocument();
      });

      it("does not fetch on connectivity event if in background (visibility = hidden), but fetches when resumed", async () => {
        setDocumentVisibility("hidden");
        setNavigatorOnline(false);
        const listSpy = vi.spyOn(api, "listActiveSessions");

        render(<ActiveSessions />);
        expect(listSpy).not.toHaveBeenCalled();

        // 在后台连上网
        await act(async () => {
          dispatchOnline();
        });
        // 后台门禁阻止网络请求
        expect(listSpy).not.toHaveBeenCalled();

        // 随后回到前台
        listSpy.mockResolvedValueOnce([
          {
            id: "resumed-after-connectivity",
            mode: "scenario",
            status: "active",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: null,
          },
        ]);
        await act(async () => {
          dispatchVisibilityChange("visible");
        });

        expect(listSpy).toHaveBeenCalledTimes(1);
        await act(async () => {
          await Promise.resolve();
        });
        expect(screen.getByText("resumed-after-connectivity")).toBeInTheDocument();
      });

      it("merges and deduplicates duplicate resume and connectivity events while request is in-flight", async () => {
        const listSpy = vi.spyOn(api, "listActiveSessions");
        const deferred = createDeferred<api.SessionListItem[]>();
        listSpy.mockReturnValueOnce(deferred.promise);

        render(<ActiveSessions />);
        expect(listSpy).toHaveBeenCalledTimes(1);

        // 在请求在途期间连续触发多次 resume / connectivity
        await act(async () => {
          dispatchPageShow();
          dispatchVisibilityChange("visible");
          dispatchOnline();
          dispatchOnline();
        });

        // 合并去重，不排队不自动重放
        expect(listSpy).toHaveBeenCalledTimes(1);

        await act(async () => {
          deferred.resolve([]);
        });
      });
    });

    describe("Suspend & offline request cancellation and state preservation", () => {
      it("aborts in-flight request, clears inFlight slot, exits loading, keeps existing sessions, and does not show error on suspend event", async () => {
        const listSpy = vi.spyOn(api, "listActiveSessions");
        const initialData: api.SessionListItem[] = [
          {
            id: "kept-session-1",
            mode: "free_talk",
            status: "active",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: null,
          },
        ];
        listSpy.mockResolvedValueOnce(initialData);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });
        expect(screen.getByText("kept-session-1")).toBeInTheDocument();

        // 发起第二轮请求并在途
        const deferred = createDeferred<api.SessionListItem[]>();
        listSpy.mockReturnValueOnce(deferred.promise);

        // 触发 resume 发起刷新
        await act(async () => {
          dispatchPageShow();
        });
        expect(listSpy).toHaveBeenCalledTimes(2);

        // 进入后台挂起
        await act(async () => {
          dispatchVisibilityChange("hidden");
        });

        // 立即退出 loading、保留已有 session、不新增错误提示
        expect(screen.queryByText(t.loading)).not.toBeInTheDocument();
        expect(screen.getByText("kept-session-1")).toBeInTheDocument();
        expect(screen.queryByText(t.loadError)).not.toBeInTheDocument();

        // 迟到的旧请求 resolve，被废弃且不污染
        await act(async () => {
          deferred.resolve([
            {
              id: "stale-session-ignored",
              mode: "doc_chat",
              status: "active",
              started_at: "2026-10-21T11:00:00Z",
              ended_at: null,
            },
          ]);
        });
        expect(screen.getByText("kept-session-1")).toBeInTheDocument();
        expect(screen.queryByText("stale-session-ignored")).not.toBeInTheDocument();
      });

      it("aborts in-flight request, clears inFlight slot, exits loading, keeps existing sessions, and does not show error on offline event", async () => {
        const listSpy = vi.spyOn(api, "listActiveSessions");
        const deferred = createDeferred<api.SessionListItem[]>();
        listSpy.mockReturnValueOnce(deferred.promise);

        render(<ActiveSessions />);
        expect(listSpy).toHaveBeenCalledTimes(1);
        expect(screen.getByText(t.loading)).toBeInTheDocument();

        // 突然离线
        await act(async () => {
          dispatchOffline();
        });

        // 退出 loading、不展示错误
        expect(screen.queryByText(t.loading)).not.toBeInTheDocument();
        expect(screen.queryByText(t.loadError)).not.toBeInTheDocument();

        // 迟到的旧请求 reject，被废弃且不设置错误
        await act(async () => {
          deferred.reject(new Error("Network connection lost"));
        });
        expect(screen.queryByText(t.loadError)).not.toBeInTheDocument();
      });

      it("aborts in-flight request on pagehide event as suspend", async () => {
        const listSpy = vi.spyOn(api, "listActiveSessions");
        const deferred = createDeferred<api.SessionListItem[]>();
        listSpy.mockReturnValueOnce(deferred.promise);

        render(<ActiveSessions />);
        expect(listSpy).toHaveBeenCalledTimes(1);
        expect(screen.getByText(t.loading)).toBeInTheDocument();

        // 派发 pagehide 事件
        await act(async () => {
          dispatchPageHide();
        });

        // 退出 loading、释放槽位
        expect(screen.queryByText(t.loading)).not.toBeInTheDocument();
        expect(screen.queryByText(t.loadError)).not.toBeInTheDocument();

        // 迟到请求 resolve 不污染
        await act(async () => {
          deferred.resolve([]);
        });
      });
    });

    describe("Stale in-flight request vs resumed/new request isolation", () => {
      it("when old request is still pending and lifecycle suspends then resumes, new request is issued and succeeds; stale old resolve does not pollute data", async () => {
        const listSpy = vi.spyOn(api, "listActiveSessions");
        const deferredOld = createDeferred<api.SessionListItem[]>();
        const deferredNew = createDeferred<api.SessionListItem[]>();

        listSpy.mockReturnValueOnce(deferredOld.promise);
        render(<ActiveSessions />);
        expect(listSpy).toHaveBeenCalledTimes(1);
        expect(screen.getByText(t.loading)).toBeInTheDocument();

        // 切后台 suspend
        await act(async () => {
          dispatchVisibilityChange("hidden");
        });
        expect(screen.queryByText(t.loading)).not.toBeInTheDocument();

        // 切回前台 resume，应立即发起新请求
        listSpy.mockReturnValueOnce(deferredNew.promise);
        await act(async () => {
          dispatchVisibilityChange("visible");
        });
        expect(listSpy).toHaveBeenCalledTimes(2);
        expect(screen.getByText(t.loading)).toBeInTheDocument();

        // 新请求成功解析
        await act(async () => {
          deferredNew.resolve([
            {
              id: "fresh-session-after-resume",
              mode: "free_talk",
              status: "active",
              started_at: "2026-10-21T10:00:00Z",
              ended_at: null,
            },
          ]);
        });
        expect(screen.getByText("fresh-session-after-resume")).toBeInTheDocument();
        expect(screen.queryByText(t.loading)).not.toBeInTheDocument();

        // 旧请求迟到 resolve
        await act(async () => {
          deferredOld.resolve([
            {
              id: "stale-session-before-suspend",
              mode: "doc_chat",
              status: "active",
              started_at: "2026-10-21T09:00:00Z",
              ended_at: null,
            },
          ]);
        });

        // 验证展示的依然是新请求数据，旧数据被安全废弃
        expect(screen.getByText("fresh-session-after-resume")).toBeInTheDocument();
        expect(screen.queryByText("stale-session-before-suspend")).not.toBeInTheDocument();
      });

      it("when old request is still pending and lifecycle suspends then resumes, stale old reject does not set error", async () => {
        const listSpy = vi.spyOn(api, "listActiveSessions");
        const deferredOld = createDeferred<api.SessionListItem[]>();
        const deferredNew = createDeferred<api.SessionListItem[]>();

        listSpy.mockReturnValueOnce(deferredOld.promise);
        render(<ActiveSessions />);
        expect(listSpy).toHaveBeenCalledTimes(1);

        // 切后台 suspend
        await act(async () => {
          dispatchVisibilityChange("hidden");
        });

        // 切回前台 resume
        listSpy.mockReturnValueOnce(deferredNew.promise);
        await act(async () => {
          dispatchVisibilityChange("visible");
        });
        expect(listSpy).toHaveBeenCalledTimes(2);

        // 旧请求失败
        await act(async () => {
          deferredOld.reject(new Error("Old abort failure"));
        });

        // 不应把旧错误展示出来
        expect(screen.queryByText(t.loadError)).not.toBeInTheDocument();

        // 新请求成功
        await act(async () => {
          deferredNew.resolve([
            {
              id: "new-session-ok",
              mode: "free_talk",
              status: "active",
              started_at: "2026-10-21T10:00:00Z",
              ended_at: null,
            },
          ]);
        });
        expect(screen.getByText("new-session-ok")).toBeInTheDocument();
        expect(screen.queryByText(t.loadError)).not.toBeInTheDocument();
      });

      it("when old request is still pending and lifecycle suspends then resumes, stale old finally does not clear loading of active new request", async () => {
        const listSpy = vi.spyOn(api, "listActiveSessions");
        const deferredOld = createDeferred<api.SessionListItem[]>();
        const deferredNew = createDeferred<api.SessionListItem[]>();

        listSpy.mockReturnValueOnce(deferredOld.promise);
        render(<ActiveSessions />);
        expect(listSpy).toHaveBeenCalledTimes(1);

        // 切后台 suspend
        await act(async () => {
          dispatchVisibilityChange("hidden");
        });

        // 切回前台 resume
        listSpy.mockReturnValueOnce(deferredNew.promise);
        await act(async () => {
          dispatchVisibilityChange("visible");
        });
        expect(listSpy).toHaveBeenCalledTimes(2);
        expect(screen.getByText(t.loading)).toBeInTheDocument();

        // 旧请求 resolve (触发其 finally 阶段)
        await act(async () => {
          deferredOld.resolve([]);
        });

        // 新请求仍在途，loading 绝对不能被旧请求的 finally 冲掉！
        expect(screen.getByText(t.loading)).toBeInTheDocument();

        // 新请求完成
        await act(async () => {
          deferredNew.resolve([
            {
              id: "session-finally-verified",
              mode: "free_talk",
              status: "active",
              started_at: "2026-10-21T10:00:00Z",
              ended_at: null,
            },
          ]);
        });

        expect(screen.queryByText(t.loading)).not.toBeInTheDocument();
        expect(screen.getByText("session-finally-verified")).toBeInTheDocument();
      });
    });

    describe("Manual retry lifecycle gates", () => {
      it("manual retry button obeys lifecycle gates (blocked when hidden or offline)", async () => {
        const listSpy = vi.spyOn(api, "listActiveSessions");
        listSpy.mockRejectedValueOnce(new Error("Initial load failure"));

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        expect(screen.getByText(t.loadError)).toBeInTheDocument();
        const retryBtn = screen.getByRole("button", { name: t.retry });
        expect(retryBtn).toBeInTheDocument();
        expect(listSpy).toHaveBeenCalledTimes(1);

        // 1. 切换为 hidden，点击重试受生命周期门禁拦截
        await act(async () => {
          dispatchVisibilityChange("hidden");
        });
        fireEvent.click(retryBtn);
        expect(listSpy).toHaveBeenCalledTimes(1);

        // 2. 离线后切回 visible，由于 offline 门禁，resume 不刷新且点击重试受拦截
        await act(async () => {
          dispatchOffline();
        });
        await act(async () => {
          dispatchVisibilityChange("visible");
        });
        expect(listSpy).toHaveBeenCalledTimes(1);

        fireEvent.click(retryBtn);
        expect(listSpy).toHaveBeenCalledTimes(1);

        // 3. 恢复 online，connectivity 事件合格触发刷新并恢复成功
        listSpy.mockResolvedValueOnce([
          {
            id: "session-retry-success",
            mode: "free_talk",
            status: "active",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: null,
          },
        ]);
        await act(async () => {
          dispatchOnline();
        });
        expect(listSpy).toHaveBeenCalledTimes(2);

        expect(screen.getByText("session-retry-success")).toBeInTheDocument();
        expect(screen.queryByText(t.loadError)).not.toBeInTheDocument();
      });
    });

    describe("StrictMode, disposal & cleanup", () => {
      it("disposes adapter and detaches all listeners on unmount so subsequent DOM events do not trigger fetch", async () => {
        const listSpy = vi.spyOn(api, "listActiveSessions");
        listSpy.mockResolvedValueOnce([]);

        const { unmount } = render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });
        expect(listSpy).toHaveBeenCalledTimes(1);

        unmount();

        // 卸载后再触发各种生命周期 DOM 事件
        await act(async () => {
          dispatchVisibilityChange("hidden");
          dispatchVisibilityChange("visible");
          dispatchOnline();
          dispatchPageShow();
        });

        // 绝不触发新的网络请求
        expect(listSpy).toHaveBeenCalledTimes(1);
      });

      it("operates normally with lifecycle under React StrictMode", async () => {
        const deferred = createDeferred<api.SessionListItem[]>();
        vi.spyOn(api, "listActiveSessions").mockReturnValue(deferred.promise);

        render(
          <StrictMode>
            <ActiveSessions />
          </StrictMode>,
        );

        await act(async () => {
          deferred.resolve([
            {
              id: "strict-mode-lifecycle-session",
              mode: "exam_prep",
              status: "active",
              started_at: "2026-10-21T10:00:00Z",
              ended_at: null,
            },
          ]);
        });

        expect(screen.getByText("strict-mode-lifecycle-session")).toBeInTheDocument();
      });
    });

    describe("Read-only contract invariants & end capability", () => {
      it("strictly performs discovery with explicit end capability but no resume or takeover controls", async () => {
        const listSpy = vi.spyOn(api, "listActiveSessions");
        listSpy.mockResolvedValueOnce([
          {
            id: "session-readonly-invariants",
            mode: "free_talk",
            status: "active",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: null,
          },
        ]);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        expect(screen.getByText("session-readonly-invariants")).toBeInTheDocument();
        expect(
          screen.queryByRole("button", {
            name: /创建|接管|开始|claim|heartbeat|dispatch/i,
          }),
        ).not.toBeInTheDocument();
        expect(
          screen.getByTestId("resume-session-button-session-readonly-invariants"),
        ).toHaveTextContent(t.resumeRecord);
        expect(
          screen.getByTestId("end-session-button-session-readonly-invariants"),
        ).toHaveTextContent(t.endRecord);
      });
    });

    describe("Explicit End Active Session (CP-02 §2)", () => {
      const mockSessions: api.SessionListItem[] = [
        {
          id: "sess-end-1",
          mode: "free_talk",
          status: "active",
          started_at: "2026-10-21T10:00:00Z",
          ended_at: null,
        },
        {
          id: "sess-end-2",
          mode: "doc_chat",
          status: "active",
          started_at: "2026-10-21T11:00:00Z",
          ended_at: null,
        },
      ];

      it("displays inline confirmation without window.confirm and allows cancellation without network request", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const endSpy = vi.spyOn(api, "endSession");
        const confirmSpy = vi.spyOn(window, "confirm");

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        // 初始状态下无内联确认
        expect(screen.queryByTestId("end-confirm-panel-sess-end-1")).not.toBeInTheDocument();

        // 点击“结束记录”
        const endBtn1 = screen.getByTestId("end-session-button-sess-end-1");
        fireEvent.click(endBtn1);

        // 验证内联确认面板、目标ID标签与文案提示
        expect(screen.getByTestId("end-confirm-panel-sess-end-1")).toBeInTheDocument();
        expect(screen.getByText(t.targetIdLabel)).toBeInTheDocument();
        expect(screen.getByTestId("confirm-session-id-sess-end-1")).toHaveTextContent("sess-end-1");
        expect(screen.getByText(t.endConfirmDisclaimer)).toBeInTheDocument();
        expect(confirmSpy).not.toHaveBeenCalled();

        // 验证确认和取消按钮存在
        const confirmBtn = screen.getByTestId("confirm-end-button-sess-end-1");
        const cancelBtn = screen.getByTestId("cancel-end-button-sess-end-1");
        expect(confirmBtn).toHaveTextContent(t.confirmEnd);
        expect(cancelBtn).toHaveTextContent(t.cancelEnd);

        // 点击“取消”
        fireEvent.click(cancelBtn);

        // 确认面板关闭，无网络请求
        expect(screen.queryByTestId("end-confirm-panel-sess-end-1")).not.toBeInTheDocument();
        expect(endSpy).not.toHaveBeenCalled();
      });

      it("blocks end request (zero POST) when principal changes between start confirm and confirm click before auth event broadcast (END-01)", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const endSpy = vi.spyOn(api, "endSession");

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        // 1. 在当前 user-1 身份下点击结束记录，展开确认
        fireEvent.click(screen.getByTestId("end-session-button-sess-end-1"));
        expect(screen.getByTestId("end-confirm-panel-sess-end-1")).toBeInTheDocument();

        // 2. 模拟受控时序：外部 getAuthSnapshot 先变更为 user-2，但暂未发布订阅通知
        currentSnapshot = {
          state: "authenticated",
          principal: { issuer: "https://auth.example.com", subject: "user-2" },
        };

        // 3. 点击旧确认按钮
        fireEvent.click(screen.getByTestId("confirm-end-button-sess-end-1"));

        // 4. 契约校验：确认意图绑定选择时的认证代际，绝不能将旧目标升级为新账号请求，必须零 POST！
        expect(endSpy).not.toHaveBeenCalled();
      });

      it("blocks end request (zero POST) when revision increments between start confirm and confirm click before auth event broadcast (END-01)", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const endSpy = vi.spyOn(api, "endSession");

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        // 1. 在当前 revision 下点击结束记录，展开确认
        fireEvent.click(screen.getByTestId("end-session-button-sess-end-1"));
        expect(screen.getByTestId("end-confirm-panel-sess-end-1")).toBeInTheDocument();

        // 2. 模拟受控时序：外部 getAuthRevision 先递增，但暂未发布订阅通知
        currentRevision += 1;

        // 3. 点击旧确认按钮
        fireEvent.click(screen.getByTestId("confirm-end-button-sess-end-1"));

        // 4. 契约校验：revision 不匹配时拦截，必须零 POST！
        expect(endSpy).not.toHaveBeenCalled();
      });

      it("successfully ends session with exact ID and status=completed, removing target and retaining others", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const endSpy = vi.spyOn(api, "endSession");
        const deferred = createDeferred<api.Session>();
        endSpy.mockReturnValueOnce(deferred.promise);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        // 展开 sess-end-1 确认
        fireEvent.click(screen.getByTestId("end-session-button-sess-end-1"));
        const confirmBtn = screen.getByTestId("confirm-end-button-sess-end-1");

        // 点击确认结束
        fireEvent.click(confirmBtn);

        expect(endSpy).toHaveBeenCalledTimes(1);
        expect(endSpy).toHaveBeenCalledWith("sess-end-1");

        // 正在结束文案
        expect(screen.getByTestId("confirm-end-button-sess-end-1")).toHaveTextContent(t.ending);
        expect(screen.getByTestId("confirm-end-button-sess-end-1")).toBeDisabled();

        // 成功响应 (status=completed)
        await act(async () => {
          deferred.resolve({
            id: "sess-end-1",
            user_id: "user-1",
            mode: "free_talk",
            status: "completed",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: "2026-10-21T10:15:00Z",
            transcripts: [],
          });
        });

        // sess-end-1 被移除，sess-end-2 保留
        expect(screen.queryByTestId("active-session-item-sess-end-1")).not.toBeInTheDocument();
        expect(screen.getByTestId("active-session-item-sess-end-2")).toBeInTheDocument();
      });

      it("treats abnormal response (status not completed or id mismatch) as failure", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const endSpy = vi.spyOn(api, "endSession");
        const deferred = createDeferred<api.Session>();
        endSpy.mockReturnValueOnce(deferred.promise);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        fireEvent.click(screen.getByTestId("end-session-button-sess-end-1"));
        fireEvent.click(screen.getByTestId("confirm-end-button-sess-end-1"));

        // 服务端返回 status 仍为 active
        await act(async () => {
          deferred.resolve({
            id: "sess-end-1",
            user_id: "user-1",
            mode: "free_talk",
            status: "active",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: null,
            transcripts: [],
          });
        });

        // 判定为失败，展示安全本地化错误，会话项未被移除
        expect(screen.getByTestId("end-error-sess-end-1")).toHaveTextContent(t.endError);
        expect(screen.getByTestId("active-session-item-sess-end-1")).toBeInTheDocument();
        expect(screen.getByTestId("retry-end-button-sess-end-1")).toHaveTextContent(t.retryEnd);
      });

      it("deduplicates requests on repeated clicks while in-flight", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const endSpy = vi.spyOn(api, "endSession");
        const deferred = createDeferred<api.Session>();
        endSpy.mockReturnValueOnce(deferred.promise);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        fireEvent.click(screen.getByTestId("end-session-button-sess-end-1"));
        const confirmBtn = screen.getByTestId("confirm-end-button-sess-end-1");

        // 连续多次点击
        fireEvent.click(confirmBtn);
        fireEvent.click(confirmBtn);
        fireEvent.click(confirmBtn);

        // 仅发一次请求
        expect(endSpy).toHaveBeenCalledTimes(1);

        await act(async () => {
          deferred.resolve({
            id: "sess-end-1",
            user_id: "user-1",
            mode: "free_talk",
            status: "completed",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: "2026-10-21T10:15:00Z",
            transcripts: [],
          });
        });
      });

      it("disables other rows and prevents replacing in-flight target while ending is in-flight", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const endSpy = vi.spyOn(api, "endSession");
        const deferred = createDeferred<api.Session>();
        endSpy.mockReturnValueOnce(deferred.promise);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        fireEvent.click(screen.getByTestId("end-session-button-sess-end-1"));
        fireEvent.click(screen.getByTestId("confirm-end-button-sess-end-1"));

        // sess-end-2 的按钮此时应处于 disabled 状态
        const endBtn2 = screen.getByTestId("end-session-button-sess-end-2");
        expect(endBtn2).toBeDisabled();

        // 点击 sess-end-2 不起作用，不能替换在途目标
        fireEvent.click(endBtn2);
        expect(screen.queryByTestId("end-confirm-panel-sess-end-2")).not.toBeInTheDocument();
        expect(endSpy).toHaveBeenCalledTimes(1);

        await act(async () => {
          deferred.resolve({
            id: "sess-end-1",
            user_id: "user-1",
            mode: "free_talk",
            status: "completed",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: "2026-10-21T10:15:00Z",
            transcripts: [],
          });
        });

        // 结束完成后，sess-end-2 恢复可用
        expect(screen.getByTestId("end-session-button-sess-end-2")).not.toBeDisabled();
      });

      it("retains target on failure, hides sensitive server error text, supports retry with same ID, and allows cancel to exit confirmation", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const endSpy = vi.spyOn(api, "endSession");
        const deferred1 = createDeferred<api.Session>();
        endSpy.mockReturnValueOnce(deferred1.promise);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        fireEvent.click(screen.getByTestId("end-session-button-sess-end-1"));
        fireEvent.click(screen.getByTestId("confirm-end-button-sess-end-1"));

        // 模拟带内部网络/敏感信息的服务端异常
        await act(async () => {
          deferred1.reject(new Error("Internal Postgres 5432 deadlock at session end endpoint"));
        });

        // 绝不回显服务端敏感异常正文
        expect(screen.queryByText(/Postgres 5432/)).not.toBeInTheDocument();
        // 展示安全本地化错误
        expect(screen.getByTestId("end-error-sess-end-1")).toHaveTextContent(t.endError);
        // 目标ID保持
        expect(screen.getByTestId("confirm-session-id-sess-end-1")).toHaveTextContent("sess-end-1");

        // 重试按钮可用
        const retryBtn = screen.getByTestId("retry-end-button-sess-end-1");
        expect(retryBtn).toHaveTextContent(t.retryEnd);

        // 点击重试，相同 ID 再次发起
        const deferred2 = createDeferred<api.Session>();
        endSpy.mockReturnValueOnce(deferred2.promise);

        fireEvent.click(retryBtn);
        expect(endSpy).toHaveBeenCalledTimes(2);
        expect(endSpy).toHaveBeenLastCalledWith("sess-end-1");

        // 再次失败
        await act(async () => {
          deferred2.reject(new Error("Another failure"));
        });

        // 依然可以点击取消按钮退出确认
        const cancelBtn = screen.getByTestId("cancel-end-button-sess-end-1");
        fireEvent.click(cancelBtn);

        // 退出内联确认面板
        expect(screen.queryByTestId("end-confirm-panel-sess-end-1")).not.toBeInTheDocument();
      });

      it("blocks end confirmation when visibility is hidden or offline, and allows when visible and online", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const endSpy = vi.spyOn(api, "endSession");

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        fireEvent.click(screen.getByTestId("end-session-button-sess-end-1"));
        const confirmBtn = screen.getByTestId("confirm-end-button-sess-end-1");

        // 1. 切后台 hidden
        await act(async () => {
          dispatchVisibilityChange("hidden");
        });
        fireEvent.click(confirmBtn);
        // 门禁拦截，不发送网络请求
        expect(endSpy).not.toHaveBeenCalled();

        // 2. 切回 visible 但 offline
        await act(async () => {
          dispatchOffline();
        });
        await act(async () => {
          dispatchVisibilityChange("visible");
        });
        fireEvent.click(confirmBtn);
        expect(endSpy).not.toHaveBeenCalled();

        // 3. 恢复 online 且 visible
        await act(async () => {
          dispatchOnline();
        });

        const deferred = createDeferred<api.Session>();
        endSpy.mockReturnValueOnce(deferred.promise);

        fireEvent.click(confirmBtn);
        expect(endSpy).toHaveBeenCalledTimes(1);
        expect(endSpy).toHaveBeenCalledWith("sess-end-1");

        await act(async () => {
          deferred.resolve({
            id: "sess-end-1",
            user_id: "user-1",
            mode: "free_talk",
            status: "completed",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: "2026-10-21T10:15:00Z",
            transcripts: [],
          });
        });
      });

      it("cancels in-flight list request when issuing end request", async () => {
        const listSpy = vi.spyOn(api, "listActiveSessions");
        const listDeferred1 = createDeferred<api.SessionListItem[]>();
        listSpy.mockReturnValueOnce(listDeferred1.promise);

        render(<ActiveSessions />);
        // 列表请求在途
        expect(screen.getByText(t.loading)).toBeInTheDocument();

        await act(async () => {
          listDeferred1.resolve(mockSessions);
        });

        // 发起第二轮列表刷新
        const listDeferred2 = createDeferred<api.SessionListItem[]>();
        listSpy.mockReturnValueOnce(listDeferred2.promise);

        await act(async () => {
          dispatchPageShow();
        });
        expect(listSpy).toHaveBeenCalledTimes(2);

        // 此时用户开始操作结束
        const endSpy = vi.spyOn(api, "endSession");
        const endDeferred = createDeferred<api.Session>();
        endSpy.mockReturnValueOnce(endDeferred.promise);

        fireEvent.click(screen.getByTestId("end-session-button-sess-end-1"));
        fireEvent.click(screen.getByTestId("confirm-end-button-sess-end-1"));

        // 确认结束前，在途列表请求被作废且退出 loading
        expect(screen.queryByText(t.loading)).not.toBeInTheDocument();

        // 旧列表请求迟到 resolve
        await act(async () => {
          listDeferred2.resolve([
            {
              id: "stale-polluted-list-session",
              mode: "scenario",
              status: "active",
              started_at: "2026-10-21T12:00:00Z",
              ended_at: null,
            },
          ]);
        });
        // 不污染界面
        expect(screen.queryByText("stale-polluted-list-session")).not.toBeInTheDocument();

        // 结束请求完成
        await act(async () => {
          endDeferred.resolve({
            id: "sess-end-1",
            user_id: "user-1",
            mode: "free_talk",
            status: "completed",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: "2026-10-21T10:15:00Z",
            transcripts: [],
          });
        });

        expect(screen.queryByTestId("active-session-item-sess-end-1")).not.toBeInTheDocument();
      });

      it("pauses list refresh without queueing while ending is in-flight", async () => {
        const listSpy = vi.spyOn(api, "listActiveSessions");
        listSpy.mockResolvedValueOnce(mockSessions);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });
        expect(listSpy).toHaveBeenCalledTimes(1);

        const endSpy = vi.spyOn(api, "endSession");
        const endDeferred = createDeferred<api.Session>();
        endSpy.mockReturnValueOnce(endDeferred.promise);

        fireEvent.click(screen.getByTestId("end-session-button-sess-end-1"));
        fireEvent.click(screen.getByTestId("confirm-end-button-sess-end-1"));
        expect(endSpy).toHaveBeenCalledTimes(1);

        // 结束在途期间触发各种生命周期事件
        await act(async () => {
          dispatchPageShow();
          dispatchVisibilityChange("visible");
          dispatchOnline();
        });

        // 列表刷新被暂停且不排队，listActiveSessions 调用次数依然为 1
        expect(listSpy).toHaveBeenCalledTimes(1);

        await act(async () => {
          endDeferred.resolve({
            id: "sess-end-1",
            user_id: "user-1",
            mode: "free_talk",
            status: "completed",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: "2026-10-21T10:15:00Z",
            transcripts: [],
          });
        });
      });

      it("does not release end slot or replay end on suspend or offline", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const endSpy = vi.spyOn(api, "endSession");
        const endDeferred = createDeferred<api.Session>();
        endSpy.mockReturnValueOnce(endDeferred.promise);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        fireEvent.click(screen.getByTestId("end-session-button-sess-end-1"));
        fireEvent.click(screen.getByTestId("confirm-end-button-sess-end-1"));
        expect(endSpy).toHaveBeenCalledTimes(1);

        // 挂起 suspend / 离线 offline
        await act(async () => {
          dispatchVisibilityChange("hidden");
          dispatchOffline();
        });

        // 结束操作的在途状态依然保持，不能被误释放
        expect(screen.getByTestId("confirm-end-button-sess-end-1")).toBeDisabled();

        // 恢复 resume / online，只读发现不能重放结束请求
        await act(async () => {
          dispatchOnline();
          dispatchVisibilityChange("visible");
        });

        // endSpy 依然仅被调用 1 次，绝不自动重发
        expect(endSpy).toHaveBeenCalledTimes(1);

        await act(async () => {
          endDeferred.resolve({
            id: "sess-end-1",
            user_id: "user-1",
            mode: "free_talk",
            status: "completed",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: "2026-10-21T10:15:00Z",
            transcripts: [],
          });
        });
      });

      it("prevents stale list responses or subsequent discoveries from resurrecting completed session", async () => {
        const listSpy = vi.spyOn(api, "listActiveSessions");
        listSpy.mockResolvedValueOnce(mockSessions);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        const endSpy = vi.spyOn(api, "endSession");
        endSpy.mockResolvedValueOnce({
          id: "sess-end-1",
          user_id: "user-1",
          mode: "free_talk",
          status: "completed",
          started_at: "2026-10-21T10:00:00Z",
          ended_at: "2026-10-21T10:15:00Z",
          transcripts: [],
        });

        fireEvent.click(screen.getByTestId("end-session-button-sess-end-1"));
        fireEvent.click(screen.getByTestId("confirm-end-button-sess-end-1"));

        await act(async () => {
          await Promise.resolve();
        });
        expect(screen.queryByTestId("active-session-item-sess-end-1")).not.toBeInTheDocument();

        // 之后触发列表刷新，假设后端列表仍包含旧的 sess-end-1（例如缓存或慢写入）
        listSpy.mockResolvedValueOnce(mockSessions);
        await act(async () => {
          dispatchPageShow();
        });

        // sess-end-1 绝不被复活
        expect(screen.queryByTestId("active-session-item-sess-end-1")).not.toBeInTheDocument();
        expect(screen.getByTestId("active-session-item-sess-end-2")).toBeInTheDocument();
      });

      it("clears confirmation and error immediately upon logout / account switch / revision bump, discarding old response", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const endSpy = vi.spyOn(api, "endSession");
        const deferredOld = createDeferred<api.Session>();
        endSpy.mockReturnValueOnce(deferredOld.promise);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        fireEvent.click(screen.getByTestId("end-session-button-sess-end-1"));
        fireEvent.click(screen.getByTestId("confirm-end-button-sess-end-1"));

        // 换号到 user-2
        vi.spyOn(api, "listActiveSessions").mockResolvedValueOnce([
          {
            id: "user-2-session",
            mode: "scenario",
            status: "active",
            started_at: "2026-10-21T12:00:00Z",
            ended_at: null,
          },
        ]);

        await act(async () => {
          emitAuthSnapshot({
            state: "authenticated",
            principal: { issuer: "https://auth.example.com", subject: "user-2" },
          });
        });

        // 确认面板和旧会话立即清空
        expect(screen.queryByTestId("end-confirm-panel-sess-end-1")).not.toBeInTheDocument();
        expect(screen.queryByTestId("active-session-item-sess-end-1")).not.toBeInTheDocument();
        expect(screen.getByTestId("active-session-item-user-2-session")).toBeInTheDocument();

        // user-2 下的新结束操作可以正常发起
        const deferredNew = createDeferred<api.Session>();
        endSpy.mockReturnValueOnce(deferredNew.promise);

        fireEvent.click(screen.getByTestId("end-session-button-user-2-session"));
        fireEvent.click(screen.getByTestId("confirm-end-button-user-2-session"));

        // 旧 user-1 的结束请求此时 resolve 或 reject
        await act(async () => {
          deferredOld.reject(new Error("Old request aborted"));
        });

        // 绝不污染 user-2 的界面或给 user-2 报错
        expect(screen.queryByTestId("end-error-user-2-session")).not.toBeInTheDocument();

        // 新请求正常成功
        await act(async () => {
          deferredNew.resolve({
            id: "user-2-session",
            user_id: "user-2",
            mode: "scenario",
            status: "completed",
            started_at: "2026-10-21T12:00:00Z",
            ended_at: "2026-10-21T12:10:00Z",
            transcripts: [],
          });
        });

        expect(screen.queryByTestId("active-session-item-user-2-session")).not.toBeInTheDocument();
      });

      it("safely ignores in-flight end response on unmount", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const endSpy = vi.spyOn(api, "endSession");
        const deferred = createDeferred<api.Session>();
        endSpy.mockReturnValueOnce(deferred.promise);

        const { unmount } = render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        fireEvent.click(screen.getByTestId("end-session-button-sess-end-1"));
        fireEvent.click(screen.getByTestId("confirm-end-button-sess-end-1"));

        unmount();

        // 卸载后结束请求返回，不抛出异常
        await act(async () => {
          deferred.resolve({
            id: "sess-end-1",
            user_id: "user-1",
            mode: "free_talk",
            status: "completed",
            started_at: "2026-10-21T10:00:00Z",
            ended_at: "2026-10-21T10:15:00Z",
            transcripts: [],
          });
        });
      });

      it("operates normally with end session under React StrictMode", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const endSpy = vi.spyOn(api, "endSession");
        endSpy.mockResolvedValueOnce({
          id: "sess-end-1",
          user_id: "user-1",
          mode: "free_talk",
          status: "completed",
          started_at: "2026-10-21T10:00:00Z",
          ended_at: "2026-10-21T10:15:00Z",
          transcripts: [],
        });

        render(
          <StrictMode>
            <ActiveSessions />
          </StrictMode>,
        );
        await act(async () => {
          await Promise.resolve();
        });

        fireEvent.click(screen.getByTestId("end-session-button-sess-end-1"));
        fireEvent.click(screen.getByTestId("confirm-end-button-sess-end-1"));

        await act(async () => {
          await Promise.resolve();
        });

        expect(screen.queryByTestId("active-session-item-sess-end-1")).not.toBeInTheDocument();
      });
    });

    describe("Explicit Resume Active Session (CP-02 §3)", () => {
      const mockSessions: api.SessionListItem[] = [
        {
          id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
          mode: "free_talk",
          status: "active",
          started_at: "2026-10-21T10:00:00Z",
          ended_at: null,
        },
        {
          id: "4fa85f64-5717-4562-b3fc-2c963f66afa7",
          mode: "doc_chat",
          status: "active",
          started_at: "2026-10-21T11:00:00Z",
          ended_at: null,
        },
      ];

      it("displays inline resume confirmation without window.confirm and allows cancellation without store call or network request", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const resumeSpy = vi.spyOn(useConversationStore.getState(), "resumeSession");
        const confirmSpy = vi.spyOn(window, "confirm");

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        const targetId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        expect(screen.queryByTestId(`resume-confirm-panel-${targetId}`)).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId(`resume-session-button-${targetId}`));

        expect(screen.getByTestId(`resume-confirm-panel-${targetId}`)).toBeInTheDocument();
        expect(screen.getByTestId(`confirm-resume-session-id-${targetId}`)).toHaveTextContent(
          targetId,
        );
        expect(screen.getByText(t.resumeConfirmDisclaimer)).toBeInTheDocument();
        expect(confirmSpy).not.toHaveBeenCalled();

        const cancelBtn = screen.getByTestId(`cancel-resume-button-${targetId}`);
        const confirmBtn = screen.getByTestId(`confirm-resume-button-${targetId}`);
        expect(confirmBtn).toHaveTextContent(t.confirmResume);
        expect(cancelBtn).toHaveTextContent(t.cancelResume);

        fireEvent.click(cancelBtn);

        expect(screen.queryByTestId(`resume-confirm-panel-${targetId}`)).not.toBeInTheDocument();
        expect(resumeSpy).not.toHaveBeenCalled();
      });

      it("ensures mutual exclusion between end confirmation and resume confirmation", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        const id1 = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        // 开启结束确认
        fireEvent.click(screen.getByTestId(`end-session-button-${id1}`));
        expect(screen.getByTestId(`end-confirm-panel-${id1}`)).toBeInTheDocument();
        expect(screen.queryByTestId(`resume-confirm-panel-${id1}`)).not.toBeInTheDocument();

        // 切换为开启恢复确认（另一行）
        const id2 = "4fa85f64-5717-4562-b3fc-2c963f66afa7";
        fireEvent.click(screen.getByTestId(`resume-session-button-${id2}`));
        expect(screen.queryByTestId(`end-confirm-panel-${id1}`)).not.toBeInTheDocument();
        expect(screen.getByTestId(`resume-confirm-panel-${id2}`)).toBeInTheDocument();
      });

      it("blocks resume request (zero store call) when principal changes between start confirm and confirm click before auth event broadcast (RESUME-01)", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const resumeSpy = vi.spyOn(useConversationStore.getState(), "resumeSession");

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        fireEvent.click(screen.getByTestId(`resume-session-button-${id}`));
        expect(screen.getByTestId(`resume-confirm-panel-${id}`)).toBeInTheDocument();

        // 模拟外部 principal 变动，但未广播
        currentSnapshot = {
          state: "authenticated",
          principal: { issuer: "https://auth.example.com", subject: "user-2" },
        };

        fireEvent.click(screen.getByTestId(`confirm-resume-button-${id}`));
        expect(resumeSpy).not.toHaveBeenCalled();
      });

      it("blocks resume request (zero store call) when revision increments between start confirm and confirm click before auth event broadcast (RESUME-01)", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const resumeSpy = vi.spyOn(useConversationStore.getState(), "resumeSession");

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        fireEvent.click(screen.getByTestId(`resume-session-button-${id}`));
        expect(screen.getByTestId(`resume-confirm-panel-${id}`)).toBeInTheDocument();

        // 模拟 revision 递增，但未广播
        currentRevision += 1;

        fireEvent.click(screen.getByTestId(`confirm-resume-button-${id}`));
        expect(resumeSpy).not.toHaveBeenCalled();
      });

      it("blocks resume confirmation when visibility is hidden or offline, and allows when visible and online", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const resumeSpy = vi
          .spyOn(useConversationStore.getState(), "resumeSession")
          .mockResolvedValue(true);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        fireEvent.click(screen.getByTestId(`resume-session-button-${id}`));
        const confirmBtn = screen.getByTestId(`confirm-resume-button-${id}`);

        // 1. 切后台 hidden
        await act(async () => {
          dispatchVisibilityChange("hidden");
        });
        fireEvent.click(confirmBtn);
        expect(resumeSpy).not.toHaveBeenCalled();

        // 2. 切回 visible 但 offline
        await act(async () => {
          dispatchOffline();
        });
        await act(async () => {
          dispatchVisibilityChange("visible");
        });
        fireEvent.click(confirmBtn);
        expect(resumeSpy).not.toHaveBeenCalled();

        // 3. 恢复 online 且 visible
        await act(async () => {
          dispatchOnline();
        });
        fireEvent.click(confirmBtn);
        expect(resumeSpy).toHaveBeenCalledTimes(1);
        expect(resumeSpy).toHaveBeenCalledWith(id, {
          principal: { issuer: "https://auth.example.com", subject: "user-1" },
          revision: 1,
        });
      });

      it("cancels in-flight list request when issuing resume request", async () => {
        const listSpy = vi.spyOn(api, "listActiveSessions");
        const listDeferred1 = createDeferred<api.SessionListItem[]>();
        listSpy.mockReturnValueOnce(listDeferred1.promise);

        render(<ActiveSessions />);
        expect(screen.getByText(t.loading)).toBeInTheDocument();

        await act(async () => {
          listDeferred1.resolve(mockSessions);
        });

        const listDeferred2 = createDeferred<api.SessionListItem[]>();
        listSpy.mockReturnValueOnce(listDeferred2.promise);

        await act(async () => {
          dispatchPageShow();
        });
        expect(listSpy).toHaveBeenCalledTimes(2);

        const resumeDeferred = createDeferred<boolean>();
        vi.spyOn(useConversationStore.getState(), "resumeSession").mockReturnValueOnce(
          resumeDeferred.promise,
        );

        const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        fireEvent.click(screen.getByTestId(`resume-session-button-${id}`));
        fireEvent.click(screen.getByTestId(`confirm-resume-button-${id}`));

        // 列表在途请求被作废且退出 loading
        expect(screen.queryByText(t.loading)).not.toBeInTheDocument();

        await act(async () => {
          listDeferred2.resolve([
            {
              id: "5fa85f64-5717-4562-b3fc-2c963f66afa8",
              mode: "scenario",
              status: "active",
              started_at: "2026-10-21T12:00:00Z",
              ended_at: null,
            },
          ]);
        });
        expect(screen.queryByText("5fa85f64-5717-4562-b3fc-2c963f66afa8")).not.toBeInTheDocument();

        await act(async () => {
          resumeDeferred.resolve(true);
        });
      });

      it("pauses list refresh without queueing while resume is in-flight", async () => {
        const listSpy = vi.spyOn(api, "listActiveSessions");
        listSpy.mockResolvedValueOnce(mockSessions);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });
        expect(listSpy).toHaveBeenCalledTimes(1);

        const resumeDeferred = createDeferred<boolean>();
        vi.spyOn(useConversationStore.getState(), "resumeSession").mockReturnValueOnce(
          resumeDeferred.promise,
        );

        const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        fireEvent.click(screen.getByTestId(`resume-session-button-${id}`));
        fireEvent.click(screen.getByTestId(`confirm-resume-button-${id}`));

        await act(async () => {
          dispatchPageShow();
          dispatchVisibilityChange("visible");
          dispatchOnline();
        });

        // 列表刷新被暂停且不排队
        expect(listSpy).toHaveBeenCalledTimes(1);

        await act(async () => {
          resumeDeferred.resolve(true);
        });
      });

      it("disables other rows and prevents replacing in-flight target while resume is in-flight", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const resumeDeferred = createDeferred<boolean>();
        vi.spyOn(useConversationStore.getState(), "resumeSession").mockReturnValueOnce(
          resumeDeferred.promise,
        );

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        const id1 = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        const id2 = "4fa85f64-5717-4562-b3fc-2c963f66afa7";

        fireEvent.click(screen.getByTestId(`resume-session-button-${id1}`));
        fireEvent.click(screen.getByTestId(`confirm-resume-button-${id1}`));

        // id2 按钮处于 disabled
        expect(screen.getByTestId(`resume-session-button-${id2}`)).toBeDisabled();
        expect(screen.getByTestId(`end-session-button-${id2}`)).toBeDisabled();

        fireEvent.click(screen.getByTestId(`resume-session-button-${id2}`));
        expect(screen.queryByTestId(`resume-confirm-panel-${id2}`)).not.toBeInTheDocument();

        await act(async () => {
          resumeDeferred.resolve(true);
        });
      });

      it("retains target on resume failure, shows localized safe error, allows retry with same ID, and allows cancel", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const resumeSpy = vi.spyOn(useConversationStore.getState(), "resumeSession");
        const deferred1 = createDeferred<boolean>();
        resumeSpy.mockReturnValueOnce(deferred1.promise);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        fireEvent.click(screen.getByTestId(`resume-session-button-${id}`));
        fireEvent.click(screen.getByTestId(`confirm-resume-button-${id}`));

        // 模拟恢复失败
        await act(async () => {
          deferred1.reject(new Error("Sensitive backend token issue"));
        });

        // 不回显敏感报错，显示本地化安全错误
        expect(screen.queryByText(/Sensitive backend token issue/)).not.toBeInTheDocument();
        expect(screen.getByTestId(`resume-error-${id}`)).toHaveTextContent(t.resumeError);
        expect(screen.getByTestId(`confirm-resume-session-id-${id}`)).toHaveTextContent(id);

        const retryBtn = screen.getByTestId(`retry-resume-button-${id}`);
        expect(retryBtn).toHaveTextContent(t.retryResume);

        const deferred2 = createDeferred<boolean>();
        resumeSpy.mockReturnValueOnce(deferred2.promise);

        fireEvent.click(retryBtn);
        expect(resumeSpy).toHaveBeenCalledTimes(2);
        expect(resumeSpy).toHaveBeenLastCalledWith(id, {
          principal: { issuer: "https://auth.example.com", subject: "user-1" },
          revision: 1,
        });

        await act(async () => {
          deferred2.reject(new Error("Another failure"));
        });

        fireEvent.click(screen.getByTestId(`cancel-resume-button-${id}`));
        expect(screen.queryByTestId(`resume-confirm-panel-${id}`)).not.toBeInTheDocument();
      });

      it("clears resume confirmation and error immediately upon logout / account switch / revision bump", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const resumeSpy = vi.spyOn(useConversationStore.getState(), "resumeSession");
        const deferredOld = createDeferred<boolean>();
        resumeSpy.mockReturnValueOnce(deferredOld.promise);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        fireEvent.click(screen.getByTestId(`resume-session-button-${id}`));
        fireEvent.click(screen.getByTestId(`confirm-resume-button-${id}`));

        // 换号
        vi.spyOn(api, "listActiveSessions").mockResolvedValueOnce([
          {
            id: "5fa85f64-5717-4562-b3fc-2c963f66afa9",
            mode: "scenario",
            status: "active",
            started_at: "2026-10-21T12:00:00Z",
            ended_at: null,
          },
        ]);

        await act(async () => {
          emitAuthSnapshot({
            state: "authenticated",
            principal: { issuer: "https://auth.example.com", subject: "user-2" },
          });
        });

        expect(screen.queryByTestId(`resume-confirm-panel-${id}`)).not.toBeInTheDocument();
        expect(screen.queryByTestId(`active-session-item-${id}`)).not.toBeInTheDocument();
        expect(
          screen.getByTestId("active-session-item-5fa85f64-5717-4562-b3fc-2c963f66afa9"),
        ).toBeInTheDocument();

        await act(async () => {
          deferredOld.reject(new Error("Old resume abort"));
        });

        expect(
          screen.queryByTestId("resume-error-5fa85f64-5717-4562-b3fc-2c963f66afa9"),
        ).not.toBeInTheDocument();
      });

      it("operates normally with resume session under React StrictMode", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const resumeSpy = vi
          .spyOn(useConversationStore.getState(), "resumeSession")
          .mockResolvedValue(true);

        render(
          <StrictMode>
            <ActiveSessions />
          </StrictMode>,
        );
        await act(async () => {
          await Promise.resolve();
        });

        const id = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        fireEvent.click(screen.getByTestId(`resume-session-button-${id}`));
        fireEvent.click(screen.getByTestId(`confirm-resume-button-${id}`));

        await act(async () => {
          await Promise.resolve();
        });

        expect(resumeSpy).toHaveBeenCalledTimes(1);
        expect(resumeSpy).toHaveBeenCalledWith(id, {
          principal: { issuer: "https://auth.example.com", subject: "user-1" },
          revision: 1,
        });
      });

      it("preserves new in-flight resume when old resume finishes late after revision bump (same principal)", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const resumeSpy = vi.spyOn(useConversationStore.getState(), "resumeSession");
        const deferredOld = createDeferred<boolean>();
        const deferredNew = createDeferred<boolean>();
        resumeSpy.mockReturnValueOnce(deferredOld.promise).mockReturnValueOnce(deferredNew.promise);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        const id1 = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        const id2 = "4fa85f64-5717-4562-b3fc-2c963f66afa7";

        // 1. 用户确认恢复 id1
        fireEvent.click(screen.getByTestId(`resume-session-button-${id1}`));
        fireEvent.click(screen.getByTestId(`confirm-resume-button-${id1}`));

        expect(resumeSpy).toHaveBeenCalledTimes(1);
        expect(resumeSpy).toHaveBeenLastCalledWith(id1, {
          principal: { issuer: "https://auth.example.com", subject: "user-1" },
          revision: 1,
        });

        // 2. 此时同 principal 的 revision 递增（模拟同账号重新签发或重登）
        await act(async () => {
          emitAuthSnapshot(
            {
              state: "authenticated",
              principal: { issuer: "https://auth.example.com", subject: "user-1" },
            },
            true, // revision bump to 2
          );
        });

        // 旧的确认面板被作废清除
        expect(screen.queryByTestId(`resume-confirm-panel-${id1}`)).not.toBeInTheDocument();

        // 3. 用户在新 revision 下发起第二个会话 id2 的恢复
        fireEvent.click(screen.getByTestId(`resume-session-button-${id2}`));
        fireEvent.click(screen.getByTestId(`confirm-resume-button-${id2}`));

        expect(resumeSpy).toHaveBeenCalledTimes(2);
        expect(resumeSpy).toHaveBeenLastCalledWith(id2, {
          principal: { issuer: "https://auth.example.com", subject: "user-1" },
          revision: 2,
        });

        // id2 处于确认中且恢复在途
        expect(screen.getByTestId(`resume-confirm-panel-${id2}`)).toBeInTheDocument();
        expect(screen.getByTestId(`confirm-resume-button-${id2}`)).toHaveTextContent(t.resuming);
        expect(screen.getByTestId(`confirm-resume-button-${id2}`)).toBeDisabled();

        // 4. 此时旧的 deferredOld 完成（无论是 true、false 还是抛错）
        await act(async () => {
          deferredOld.resolve(true);
        });

        // 验证：旧的回调绝不得清掉新在途操作的确认面板、在途状态或报假错误
        expect(screen.getByTestId(`resume-confirm-panel-${id2}`)).toBeInTheDocument();
        expect(screen.getByTestId(`confirm-resume-button-${id2}`)).toHaveTextContent(t.resuming);
        expect(screen.getByTestId(`confirm-resume-button-${id2}`)).toBeDisabled();
        expect(screen.queryByTestId(`resume-error-${id2}`)).not.toBeInTheDocument();

        // 5. 新的 deferredNew 成功完成
        await act(async () => {
          deferredNew.resolve(true);
        });

        // id2 恢复确认面板顺利正常关闭
        expect(screen.queryByTestId(`resume-confirm-panel-${id2}`)).not.toBeInTheDocument();
      });

      it("preserves new in-flight resume when old resume finishes late after principal switch", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const resumeSpy = vi.spyOn(useConversationStore.getState(), "resumeSession");
        const deferredOld = createDeferred<boolean>();
        const deferredNew = createDeferred<boolean>();
        resumeSpy.mockReturnValueOnce(deferredOld.promise).mockReturnValueOnce(deferredNew.promise);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        const id1 = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        const idNew = "5fa85f64-5717-4562-b3fc-2c963f66afa9";

        // 1. user-1 确认恢复 id1
        fireEvent.click(screen.getByTestId(`resume-session-button-${id1}`));
        fireEvent.click(screen.getByTestId(`confirm-resume-button-${id1}`));

        expect(resumeSpy).toHaveBeenCalledTimes(1);

        // 2. 账号切换到 user-2
        vi.spyOn(api, "listActiveSessions").mockResolvedValueOnce([
          {
            id: idNew,
            mode: "scenario",
            status: "active",
            started_at: "2026-10-21T12:00:00Z",
            ended_at: null,
          },
        ]);

        await act(async () => {
          emitAuthSnapshot({
            state: "authenticated",
            principal: { issuer: "https://auth.example.com", subject: "user-2" },
          });
        });

        // 3. user-2 确认恢复 idNew
        fireEvent.click(screen.getByTestId(`resume-session-button-${idNew}`));
        fireEvent.click(screen.getByTestId(`confirm-resume-button-${idNew}`));

        expect(resumeSpy).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId(`resume-confirm-panel-${idNew}`)).toBeInTheDocument();
        expect(screen.getByTestId(`confirm-resume-button-${idNew}`)).toHaveTextContent(t.resuming);

        // 4. 旧 user-1 的 deferredOld 发生异常拒绝
        await act(async () => {
          deferredOld.reject(new Error("Old abort"));
        });

        // 验证：新用户的在途状态依然完好，不被旧 user-1 迟到回调篡改
        expect(screen.getByTestId(`resume-confirm-panel-${idNew}`)).toBeInTheDocument();
        expect(screen.getByTestId(`confirm-resume-button-${idNew}`)).toHaveTextContent(t.resuming);
        expect(screen.queryByTestId(`resume-error-${idNew}`)).not.toBeInTheDocument();

        // 5. 新用户的恢复完成
        await act(async () => {
          deferredNew.resolve(true);
        });

        expect(screen.queryByTestId(`resume-confirm-panel-${idNew}`)).not.toBeInTheDocument();
      });

      it("releases UI resume slot and enables cancel / new recovery when cancelled by pagehide", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const resumeSpy = vi.spyOn(useConversationStore.getState(), "resumeSession");
        const deferredOld = createDeferred<boolean>();
        const deferredNew = createDeferred<boolean>();
        resumeSpy.mockReturnValueOnce(deferredOld.promise).mockReturnValueOnce(deferredNew.promise);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        const id1 = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        const id2 = "4fa85f64-5717-4562-b3fc-2c963f66afa7";

        fireEvent.click(screen.getByTestId(`resume-session-button-${id1}`));
        fireEvent.click(screen.getByTestId(`confirm-resume-button-${id1}`));

        expect(screen.getByTestId(`cancel-resume-button-${id1}`)).toBeDisabled();
        expect(screen.getByTestId(`confirm-resume-button-${id1}`)).toBeDisabled();

        // 触发 pagehide
        await act(async () => {
          dispatchPageHide();
        });

        // 恢复到前台
        await act(async () => {
          dispatchPageShow();
          dispatchVisibilityChange("visible");
        });

        // 控件重新可用：取消按钮可用
        const cancelBtn = screen.getByTestId(`cancel-resume-button-${id1}`);
        expect(cancelBtn).not.toBeDisabled();

        // 用户点击取消，面板关闭
        fireEvent.click(cancelBtn);
        expect(screen.queryByTestId(`resume-confirm-panel-${id1}`)).not.toBeInTheDocument();

        // 新恢复入口可用：选择并确认 id2
        fireEvent.click(screen.getByTestId(`resume-session-button-${id2}`));
        fireEvent.click(screen.getByTestId(`confirm-resume-button-${id2}`));

        expect(resumeSpy).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId(`resume-confirm-panel-${id2}`)).toBeInTheDocument();
        expect(screen.getByTestId(`confirm-resume-button-${id2}`)).toHaveTextContent(t.resuming);

        // 迟到完成的旧请求不污染新请求
        await act(async () => {
          deferredOld.resolve(true);
        });

        expect(screen.getByTestId(`resume-confirm-panel-${id2}`)).toBeInTheDocument();
        expect(screen.getByTestId(`confirm-resume-button-${id2}`)).toHaveTextContent(t.resuming);

        await act(async () => {
          deferredNew.resolve(true);
        });

        expect(screen.queryByTestId(`resume-confirm-panel-${id2}`)).not.toBeInTheDocument();
      });

      it("releases UI resume slot and enables controls when cancelled by offline", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const resumeSpy = vi.spyOn(useConversationStore.getState(), "resumeSession");
        const deferredOld = createDeferred<boolean>();
        const deferredNew = createDeferred<boolean>();
        resumeSpy.mockReturnValueOnce(deferredOld.promise).mockReturnValueOnce(deferredNew.promise);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        const id1 = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        const id2 = "4fa85f64-5717-4562-b3fc-2c963f66afa7";

        fireEvent.click(screen.getByTestId(`resume-session-button-${id1}`));
        fireEvent.click(screen.getByTestId(`confirm-resume-button-${id1}`));

        expect(screen.getByTestId(`cancel-resume-button-${id1}`)).toBeDisabled();

        // 触发 offline
        await act(async () => {
          dispatchOffline();
        });

        // 恢复 online
        await act(async () => {
          dispatchOnline();
        });

        // 取消按钮可用，点击取消关闭面板
        const cancelBtn = screen.getByTestId(`cancel-resume-button-${id1}`);
        expect(cancelBtn).not.toBeDisabled();
        fireEvent.click(cancelBtn);
        expect(screen.queryByTestId(`resume-confirm-panel-${id1}`)).not.toBeInTheDocument();

        // 选择并确认新恢复 id2
        fireEvent.click(screen.getByTestId(`resume-session-button-${id2}`));
        fireEvent.click(screen.getByTestId(`confirm-resume-button-${id2}`));

        expect(screen.getByTestId(`resume-confirm-panel-${id2}`)).toBeInTheDocument();

        // 旧请求迟到拒绝不污染
        await act(async () => {
          deferredOld.reject(new Error("offline abort"));
        });

        expect(screen.getByTestId(`resume-confirm-panel-${id2}`)).toBeInTheDocument();
        expect(screen.queryByTestId(`resume-error-${id2}`)).not.toBeInTheDocument();

        await act(async () => {
          deferredNew.resolve(true);
        });

        expect(screen.queryByTestId(`resume-confirm-panel-${id2}`)).not.toBeInTheDocument();
      });

      it("releases UI resume slot when store.reset is called during pending resume", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const resumeSpy = vi.spyOn(useConversationStore.getState(), "resumeSession");
        const deferredOld = createDeferred<boolean>();
        const deferredNew = createDeferred<boolean>();
        resumeSpy.mockReturnValueOnce(deferredOld.promise).mockReturnValueOnce(deferredNew.promise);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        const id1 = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        const id2 = "4fa85f64-5717-4562-b3fc-2c963f66afa7";

        fireEvent.click(screen.getByTestId(`resume-session-button-${id1}`));
        fireEvent.click(screen.getByTestId(`confirm-resume-button-${id1}`));

        expect(screen.getByTestId(`cancel-resume-button-${id1}`)).toBeDisabled();

        // 触发 store.reset()
        act(() => {
          useConversationStore.getState().reset();
        });

        // 控件可用：取消按钮恢复可点击
        const cancelBtn = screen.getByTestId(`cancel-resume-button-${id1}`);
        expect(cancelBtn).not.toBeDisabled();
        fireEvent.click(cancelBtn);
        expect(screen.queryByTestId(`resume-confirm-panel-${id1}`)).not.toBeInTheDocument();

        // 新恢复推进
        fireEvent.click(screen.getByTestId(`resume-session-button-${id2}`));
        fireEvent.click(screen.getByTestId(`confirm-resume-button-${id2}`));

        expect(screen.getByTestId(`resume-confirm-panel-${id2}`)).toBeInTheDocument();

        await act(async () => {
          deferredOld.resolve(true);
        });

        expect(screen.getByTestId(`resume-confirm-panel-${id2}`)).toBeInTheDocument();

        await act(async () => {
          deferredNew.resolve(true);
        });

        expect(screen.queryByTestId(`resume-confirm-panel-${id2}`)).not.toBeInTheDocument();
      });

      it("releases UI resume slot when store.goHome is called during pending resume", async () => {
        vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
        const resumeSpy = vi.spyOn(useConversationStore.getState(), "resumeSession");
        const deferredOld = createDeferred<boolean>();
        const deferredNew = createDeferred<boolean>();
        resumeSpy.mockReturnValueOnce(deferredOld.promise).mockReturnValueOnce(deferredNew.promise);

        render(<ActiveSessions />);
        await act(async () => {
          await Promise.resolve();
        });

        const id1 = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        const id2 = "4fa85f64-5717-4562-b3fc-2c963f66afa7";

        fireEvent.click(screen.getByTestId(`resume-session-button-${id1}`));
        fireEvent.click(screen.getByTestId(`confirm-resume-button-${id1}`));

        expect(screen.getByTestId(`cancel-resume-button-${id1}`)).toBeDisabled();

        // 触发 store.goHome()
        act(() => {
          useConversationStore.getState().goHome();
        });

        // 控件可用：取消按钮可点击
        const cancelBtn = screen.getByTestId(`cancel-resume-button-${id1}`);
        expect(cancelBtn).not.toBeDisabled();
        fireEvent.click(cancelBtn);
        expect(screen.queryByTestId(`resume-confirm-panel-${id1}`)).not.toBeInTheDocument();

        // 新恢复可推进
        fireEvent.click(screen.getByTestId(`resume-session-button-${id2}`));
        fireEvent.click(screen.getByTestId(`confirm-resume-button-${id2}`));

        expect(screen.getByTestId(`resume-confirm-panel-${id2}`)).toBeInTheDocument();

        await act(async () => {
          deferredOld.resolve(true);
        });

        expect(screen.getByTestId(`resume-confirm-panel-${id2}`)).toBeInTheDocument();

        await act(async () => {
          deferredNew.resolve(true);
        });

        expect(screen.queryByTestId(`resume-confirm-panel-${id2}`)).not.toBeInTheDocument();
      });
    });
  });

  describe("Native iOS Lifecycle Consumer (CP-05)", () => {
    const mockSessions: api.SessionListItem[] = [
      {
        id: "sess-native-1",
        mode: "free_talk",
        status: "active",
        started_at: "2026-10-23T10:00:00Z",
        ended_at: null,
      },
    ];

    beforeEach(() => {
      fakeAppListeners.clear();
      fakeAppGetState = vi.fn().mockImplementation(() => Promise.resolve({ isActive: true }));
      fakeAppAddListener = vi
        .fn()
        .mockImplementation((_event: string, listener: (state: { isActive: boolean }) => void) => {
          fakeAppListeners.add(listener);
          return Promise.resolve({
            remove: vi.fn().mockImplementation(() => {
              fakeAppListeners.delete(listener);
              return Promise.resolve();
            }),
          });
        });

      (window as unknown as { Capacitor?: unknown }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };
    });

    afterEach(() => {
      delete (window as unknown as { Capacitor?: unknown }).Capacitor;
      fakeAppListeners.clear();
    });

    it("initial native pending does not trigger GET until registered and active, with exactly one query", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);

      const addListenerDeferred = createDeferred<{ remove(): Promise<void> }>();
      const getStateDeferred = createDeferred<{ isActive: boolean }>();
      let capturedListener: ((state: { isActive: boolean }) => void) | null = null;

      fakeAppAddListener.mockImplementationOnce(
        (_event: string, listener: (state: { isActive: boolean }) => void) => {
          capturedListener = listener;
          fakeAppListeners.add(listener);
          return addListenerDeferred.promise;
        },
      );
      fakeAppGetState.mockImplementationOnce(() => getStateDeferred.promise);

      render(<ActiveSessions />);

      // 在注册 pending 期间：不发起 GET
      await act(async () => {
        await Promise.resolve();
      });
      expect(listSpy).not.toHaveBeenCalled();
      expect(screen.queryByText(t.empty)).not.toBeInTheDocument();
      expect(screen.getByText(t.unqueried)).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(t.unqueried);

      // addListener resolve
      await act(async () => {
        addListenerDeferred.resolve({
          remove: async () => {
            if (capturedListener) fakeAppListeners.delete(capturedListener);
          },
        });
        await Promise.resolve();
      });
      // getState 仍在 pending，依旧不触发 GET
      expect(listSpy).not.toHaveBeenCalled();

      // getState resolve active
      await act(async () => {
        getStateDeferred.resolve({ isActive: true });
        await Promise.resolve();
      });

      // 成功 active 且 Web visible 后，只触发一次 GET 查询（不与 whenReady 重复发起）
      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("session-id-sess-native-1")).toHaveTextContent("sess-native-1");
    });

    it("initial native getState returning inactive does not trigger GET", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
      fakeAppGetState.mockImplementationOnce(() => Promise.resolve({ isActive: false }));

      render(<ActiveSessions />);

      await act(async () => {
        await Promise.resolve();
      });

      expect(listSpy).not.toHaveBeenCalled();
      expect(screen.queryByTestId("active-sessions-list")).not.toBeInTheDocument();
      expect(screen.queryByText(t.empty)).not.toBeInTheDocument();
      expect(screen.getByText(t.unqueried)).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(t.unqueried);
    });

    it("initial native registration failure does not trigger GET", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
      fakeAppAddListener.mockImplementationOnce(() =>
        Promise.reject(new Error("Bridge not ready")),
      );

      render(<ActiveSessions />);

      await act(async () => {
        await Promise.resolve();
      });

      expect(listSpy).not.toHaveBeenCalled();
      expect(screen.queryByText(t.empty)).not.toBeInTheDocument();
      expect(screen.getByText(t.unqueried)).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(t.unqueried);
    });

    it("query in flight when native transitions to inactive cancels active cycle and leaves list intact, then recovers on active", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions");
      const deferred1 = createDeferred<api.SessionListItem[]>();
      const deferred2 = createDeferred<api.SessionListItem[]>();
      listSpy.mockReturnValueOnce(deferred1.promise).mockReturnValueOnce(deferred2.promise);

      render(<ActiveSessions />);

      // 初始 active 触发第 1 次 GET
      await act(async () => {
        await Promise.resolve();
      });
      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByText(t.loading)).toBeInTheDocument();

      // 原生切到后台 (inactive)
      await act(async () => {
        fakeAppListeners.forEach((l) => l({ isActive: false }));
        await Promise.resolve();
      });

      // 退出 loading，保留当前空或已有列表，不新增错误
      expect(screen.queryByText(t.loading)).not.toBeInTheDocument();
      expect(screen.queryByText(t.loadError)).not.toBeInTheDocument();

      // 旧请求迟到 resolve：由于周期已作废，被丢弃
      await act(async () => {
        deferred1.resolve(mockSessions);
        await Promise.resolve();
      });
      // 仍然不展示旧数据
      expect(screen.queryByTestId("session-id-sess-native-1")).not.toBeInTheDocument();

      // 原生重新切回前台 (active)
      await act(async () => {
        fakeAppListeners.forEach((l) => l({ isActive: true }));
        await Promise.resolve();
      });

      // 自动发起第 2 次查询
      expect(listSpy).toHaveBeenCalledTimes(2);

      // 新请求成功 resolve
      const updatedSessions: api.SessionListItem[] = [
        {
          id: "sess-native-2",
          mode: "scenario",
          status: "active",
          started_at: "2026-10-23T11:00:00Z",
          ended_at: null,
        },
      ];
      await act(async () => {
        deferred2.resolve(updatedSessions);
        await Promise.resolve();
      });

      expect(screen.getByTestId("session-id-sess-native-2")).toHaveTextContent("sess-native-2");
    });

    it("initial fetch failure can recover on subsequent valid native resume event", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions");
      const deferredFail = createDeferred<api.SessionListItem[]>();
      const deferredSuccess = createDeferred<api.SessionListItem[]>();
      listSpy
        .mockReturnValueOnce(deferredFail.promise)
        .mockReturnValueOnce(deferredSuccess.promise);

      render(<ActiveSessions />);

      await act(async () => {
        await Promise.resolve();
      });
      expect(listSpy).toHaveBeenCalledTimes(1);

      // 首次读取失败 (500)
      await act(async () => {
        deferredFail.reject(new Error("Server 500 error"));
        await Promise.resolve();
      });

      expect(screen.getByText(t.loadError)).toBeInTheDocument();

      // 原生切后台再切前台（触发 resume）
      await act(async () => {
        fakeAppListeners.forEach((l) => l({ isActive: false }));
        await Promise.resolve();
      });
      await act(async () => {
        fakeAppListeners.forEach((l) => l({ isActive: true }));
        await Promise.resolve();
      });

      // 自动重新发起查询
      expect(listSpy).toHaveBeenCalledTimes(2);

      await act(async () => {
        deferredSuccess.resolve(mockSessions);
        await Promise.resolve();
      });

      // 错误状态清除，正常展示列表
      expect(screen.queryByText(t.loadError)).not.toBeInTheDocument();
      expect(screen.getByTestId("session-id-sess-native-1")).toHaveTextContent("sess-native-1");
    });

    it("native inactive overrides DOM visibilitychange and window online/pageshow", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
      fakeAppGetState.mockImplementationOnce(() => Promise.resolve({ isActive: false }));

      render(<ActiveSessions />);

      await act(async () => {
        await Promise.resolve();
      });
      expect(listSpy).not.toHaveBeenCalled();

      // DOM 触发 visibilitychange visible、pageshow、online
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("pageshow"));
        window.dispatchEvent(new Event("online"));
        await Promise.resolve();
      });

      // 因为原生 inactive 处于 hidden，原生覆盖 Web，不发起 GET
      expect(listSpy).not.toHaveBeenCalled();
    });

    it("two consumer instances independently register and unmounting one does not remove the other's listener", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);

      const compA = render(<ActiveSessions />);
      const compB = render(<ActiveSessions />);

      await act(async () => {
        await Promise.resolve();
      });
      expect(fakeAppListeners.size).toBe(2);

      // 卸载组件 A
      compA.unmount();
      expect(fakeAppListeners.size).toBe(1);

      listSpy.mockClear();

      // 原生状态变更触发（后台到前台），仅存的组件 B 正常响应
      await act(async () => {
        fakeAppListeners.forEach((l) => l({ isActive: false }));
        await Promise.resolve();
      });
      await act(async () => {
        fakeAppListeners.forEach((l) => l({ isActive: true }));
        await Promise.resolve();
      });

      expect(listSpy).toHaveBeenCalledTimes(1);

      compB.unmount();
      expect(fakeAppListeners.size).toBe(0);
    });

    it("StrictMode unmount and auth revocation do not leak or perform queries on dead effects", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);

      const { unmount } = render(
        <StrictMode>
          <ActiveSessions />
        </StrictMode>,
      );

      await act(async () => {
        await Promise.resolve();
      });
      expect(listSpy).toHaveBeenCalled();

      // 退出认证
      emitAuthSnapshot({ state: "anonymous", principal: null });

      listSpy.mockClear();

      // 原生事件到达
      await act(async () => {
        fakeAppListeners.forEach((l) => l({ isActive: true }));
        await Promise.resolve();
      });

      // 未认证绝不发请求
      expect(listSpy).not.toHaveBeenCalled();

      unmount();
      expect(fakeAppListeners.size).toBe(0);
    });

    it("lifecycle events during pending end/resume operations do not auto-retrigger or disrupt POSTs", async () => {
      vi.spyOn(api, "listActiveSessions").mockResolvedValue(mockSessions);
      const endSpy = vi.spyOn(api, "endSession");
      const deferredEnd = createDeferred<api.Session>();
      endSpy.mockReturnValueOnce(deferredEnd.promise);

      render(<ActiveSessions />);
      await act(async () => {
        await Promise.resolve();
      });

      const sessId = "sess-native-1";
      fireEvent.click(screen.getByTestId(`end-session-button-${sessId}`));
      fireEvent.click(screen.getByTestId(`confirm-end-button-${sessId}`));

      expect(endSpy).toHaveBeenCalledTimes(1);

      // 在 end 请求在途期间发生原生切后台再恢复
      await act(async () => {
        fakeAppListeners.forEach((l) => l({ isActive: false }));
        await Promise.resolve();
      });
      await act(async () => {
        fakeAppListeners.forEach((l) => l({ isActive: true }));
        await Promise.resolve();
      });

      // 不重复重发 endSession，已发 POST 保持进行
      expect(endSpy).toHaveBeenCalledTimes(1);

      await act(async () => {
        deferredEnd.resolve({
          id: sessId,
          user_id: "user-1",
          mode: "free_talk",
          status: "completed",
          started_at: "2026-10-23T10:00:00Z",
          ended_at: "2026-10-23T10:05:00Z",
          transcripts: [],
        });
        await Promise.resolve();
      });

      // 确认结束成功，移除该项
      expect(screen.queryByTestId(`active-session-item-${sessId}`)).not.toBeInTheDocument();
    });
  });

  describe("Query Fact & Lifecycle State (A20 / CROSS_PLATFORM_DISCOVERY_QUERY_STATE)", () => {
    const mockData: api.SessionListItem[] = [
      {
        id: "sess-a20-1",
        mode: "free_talk",
        status: "active",
        started_at: "2026-10-23T10:00:00Z",
        ended_at: null,
      },
    ];

    beforeEach(() => {
      fakeAppListeners.clear();
      fakeAppGetState = vi.fn().mockImplementation(() => Promise.resolve({ isActive: true }));
      fakeAppAddListener = vi
        .fn()
        .mockImplementation((_event: string, listener: (state: { isActive: boolean }) => void) => {
          fakeAppListeners.add(listener);
          return Promise.resolve({
            remove: vi.fn().mockImplementation(() => {
              fakeAppListeners.delete(listener);
              return Promise.resolve();
            }),
          });
        });

      (window as unknown as { Capacitor?: unknown }).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      };
    });

    afterEach(() => {
      delete (window as unknown as { Capacitor?: unknown }).Capacitor;
      fakeAppListeners.clear();
    });

    it("renders unqueried state with status semantics (not empty) on initial native inactive zero-GET", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions").mockResolvedValue([]);
      fakeAppGetState.mockImplementationOnce(() => Promise.resolve({ isActive: false }));

      render(<ActiveSessions />);

      await act(async () => {
        await Promise.resolve();
      });

      expect(listSpy).not.toHaveBeenCalled();
      expect(screen.queryByText(t.empty)).not.toBeInTheDocument();
      expect(screen.getByText(t.unqueried)).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(t.unqueried);
    });

    it("transitions from unqueried to loading, and only renders empty when GET succeeds with empty array []", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions");
      const deferred = createDeferred<api.SessionListItem[]>();
      listSpy.mockReturnValueOnce(deferred.promise);

      render(<ActiveSessions />);

      await act(async () => {
        await Promise.resolve();
      });

      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByText(t.loading)).toBeInTheDocument();
      expect(screen.queryByText(t.unqueried)).not.toBeInTheDocument();
      expect(screen.queryByText(t.empty)).not.toBeInTheDocument();

      await act(async () => {
        deferred.resolve([]);
        await Promise.resolve();
      });

      expect(screen.queryByText(t.loading)).not.toBeInTheDocument();
      expect(screen.queryByText(t.unqueried)).not.toBeInTheDocument();
      expect(screen.getByText(t.empty)).toBeInTheDocument();
    });

    it("transitions from unqueried to loading, and renders active session list on non-empty success", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions");
      const deferred = createDeferred<api.SessionListItem[]>();
      listSpy.mockReturnValueOnce(deferred.promise);

      render(<ActiveSessions />);

      await act(async () => {
        await Promise.resolve();
      });

      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByText(t.loading)).toBeInTheDocument();

      await act(async () => {
        deferred.resolve(mockData);
        await Promise.resolve();
      });

      expect(screen.queryByText(t.loading)).not.toBeInTheDocument();
      expect(screen.queryByText(t.empty)).not.toBeInTheDocument();
      expect(screen.queryByText(t.unqueried)).not.toBeInTheDocument();
      expect(screen.getByTestId("session-id-sess-a20-1")).toHaveTextContent("sess-a20-1");
    });

    it("preserves unqueried state on initial failure and transitions to empty only after retry succeeds with []", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions");
      const deferredFail = createDeferred<api.SessionListItem[]>();
      const deferredSuccess = createDeferred<api.SessionListItem[]>();
      listSpy
        .mockReturnValueOnce(deferredFail.promise)
        .mockReturnValueOnce(deferredSuccess.promise);

      render(<ActiveSessions />);

      await act(async () => {
        await Promise.resolve();
      });
      expect(listSpy).toHaveBeenCalledTimes(1);

      // 初次请求失败
      await act(async () => {
        deferredFail.reject(new Error("Network Error"));
        await Promise.resolve();
      });

      expect(screen.getByText(t.loadError)).toBeInTheDocument();
      expect(screen.queryByText(t.empty)).not.toBeInTheDocument();
      expect(screen.queryByText(t.unqueried)).not.toBeInTheDocument();

      // 点击重试
      const retryBtn = screen.getByRole("button", { name: t.retry });
      fireEvent.click(retryBtn);

      expect(listSpy).toHaveBeenCalledTimes(2);
      expect(screen.getByText(t.loading)).toBeInTheDocument();

      // 重试成功返回空列表
      await act(async () => {
        deferredSuccess.resolve([]);
        await Promise.resolve();
      });

      expect(screen.queryByText(t.loadError)).not.toBeInTheDocument();
      expect(screen.queryByText(t.loading)).not.toBeInTheDocument();
      expect(screen.queryByText(t.unqueried)).not.toBeInTheDocument();
      expect(screen.getByText(t.empty)).toBeInTheDocument();
    });

    it("background cancellation of in-flight GET does not create empty fact when late response arrives, and recovers after active", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions");
      const deferred1 = createDeferred<api.SessionListItem[]>();
      const deferred2 = createDeferred<api.SessionListItem[]>();
      listSpy.mockReturnValueOnce(deferred1.promise).mockReturnValueOnce(deferred2.promise);

      render(<ActiveSessions />);

      await act(async () => {
        await Promise.resolve();
      });
      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByText(t.loading)).toBeInTheDocument();

      // 原生切到后台 (inactive)
      await act(async () => {
        fakeAppListeners.forEach((l) => l({ isActive: false }));
        await Promise.resolve();
      });

      // 退出 loading，由于从未建立成功事实，显示尚未查询，绝不误报空
      expect(screen.queryByText(t.loading)).not.toBeInTheDocument();
      expect(screen.queryByText(t.empty)).not.toBeInTheDocument();
      expect(screen.getByText(t.unqueried)).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(t.unqueried);

      // 旧 GET 迟到 resolve 返回 []，不得新建空事实
      await act(async () => {
        deferred1.resolve([]);
        await Promise.resolve();
      });

      expect(screen.queryByText(t.empty)).not.toBeInTheDocument();
      expect(screen.getByText(t.unqueried)).toBeInTheDocument();

      // 原生重新切回前台 (active)
      await act(async () => {
        fakeAppListeners.forEach((l) => l({ isActive: true }));
        await Promise.resolve();
      });

      expect(listSpy).toHaveBeenCalledTimes(2);
      expect(screen.getByText(t.loading)).toBeInTheDocument();

      // 新请求成功 resolve []
      await act(async () => {
        deferred2.resolve([]);
        await Promise.resolve();
      });

      expect(screen.queryByText(t.loading)).not.toBeInTheDocument();
      expect(screen.queryByText(t.unqueried)).not.toBeInTheDocument();
      expect(screen.getByText(t.empty)).toBeInTheDocument();
    });

    it("preserves confirmed empty or non-empty fact for the same account across backgrounding/suspend without fabricating new success", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions");
      listSpy.mockResolvedValueOnce([]);

      render(<ActiveSessions />);

      await act(async () => {
        await Promise.resolve();
      });

      // 已建立空事实
      expect(screen.getByText(t.empty)).toBeInTheDocument();

      // 切到后台 (inactive)
      await act(async () => {
        fakeAppListeners.forEach((l) => l({ isActive: false }));
        await Promise.resolve();
      });

      // 同账号后台保留此前真实成功事实，不回退为尚未查询
      expect(screen.getByText(t.empty)).toBeInTheDocument();
      expect(screen.queryByText(t.unqueried)).not.toBeInTheDocument();
    });

    it("account switch clears query fact and displays unqueried for new account until new GET succeeds", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions");
      const deferred1 = createDeferred<api.SessionListItem[]>();
      const deferred2 = createDeferred<api.SessionListItem[]>();
      listSpy.mockReturnValueOnce(deferred1.promise).mockReturnValueOnce(deferred2.promise);

      render(<ActiveSessions />);

      await act(async () => {
        await Promise.resolve();
      });
      expect(listSpy).toHaveBeenCalledTimes(1);

      // 换号到 user-2
      await act(async () => {
        emitAuthSnapshot({
          state: "authenticated",
          principal: { issuer: "https://auth.example.com", subject: "user-2" },
        });
        await Promise.resolve();
      });

      expect(listSpy).toHaveBeenCalledTimes(2);

      // 旧 user-1 的请求迟到返回 []
      await act(async () => {
        deferred1.resolve([]);
        await Promise.resolve();
      });

      // user-2 处于 loading，旧 user-1 迟到不产生影响
      expect(screen.getByText(t.loading)).toBeInTheDocument();

      // user-2 请求成功返回空列表
      await act(async () => {
        deferred2.resolve([]);
        await Promise.resolve();
      });

      expect(screen.getByText(t.empty)).toBeInTheDocument();
      expect(screen.queryByText(t.unqueried)).not.toBeInTheDocument();
    });

    it("same principal re-login with bumped revision clears query fact and ignores stale revision response", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions");
      const deferred1 = createDeferred<api.SessionListItem[]>();
      const deferred2 = createDeferred<api.SessionListItem[]>();
      listSpy.mockReturnValueOnce(deferred1.promise).mockReturnValueOnce(deferred2.promise);

      render(<ActiveSessions />);

      await act(async () => {
        await Promise.resolve();
      });
      expect(listSpy).toHaveBeenCalledTimes(1);

      // 同账号登出
      await act(async () => {
        emitAuthSnapshot({ state: "anonymous", principal: null }, true);
      });

      // 再次登入同账号（revision 递增）
      await act(async () => {
        emitAuthSnapshot(
          {
            state: "authenticated",
            principal: { issuer: "https://auth.example.com", subject: "user-1" },
          },
          true,
        );
      });

      expect(listSpy).toHaveBeenCalledTimes(2);

      // 旧 revision 1 请求迟到返回 []
      await act(async () => {
        deferred1.resolve([]);
        await Promise.resolve();
      });

      // 新 revision 仍在 loading
      expect(screen.getByText(t.loading)).toBeInTheDocument();

      // 新 revision 2 请求成功返回 []
      await act(async () => {
        deferred2.resolve([]);
        await Promise.resolve();
      });

      expect(screen.getByText(t.empty)).toBeInTheDocument();
      expect(screen.queryByText(t.unqueried)).not.toBeInTheDocument();
    });

    it("StrictMode does not leak stale query fact or allow dead effects to create empty state", async () => {
      const listSpy = vi.spyOn(api, "listActiveSessions").mockResolvedValue([]);

      render(
        <StrictMode>
          <ActiveSessions />
        </StrictMode>,
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(listSpy).toHaveBeenCalled();
      expect(screen.getByText(t.empty)).toBeInTheDocument();
      expect(screen.queryByText(t.unqueried)).not.toBeInTheDocument();
    });
  });
});
