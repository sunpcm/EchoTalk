import React, { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { ActiveSessions } from "./ActiveSessions";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";
import { zhCN } from "@/i18n/zh-CN";

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

      // 验证无恢复、接管或结束按钮
      expect(screen.queryByRole("button", { name: /恢复|接管|结束|开始/ })).not.toBeInTheDocument();
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

    describe("Read-only contract invariants", () => {
      it("strictly performs read-only discovery without rendering or triggering any session mutating controls", async () => {
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
            name: /创建|接管|恢复|结束|开始|claim|heartbeat|dispatch/i,
          }),
        ).not.toBeInTheDocument();
      });
    });
  });
});
