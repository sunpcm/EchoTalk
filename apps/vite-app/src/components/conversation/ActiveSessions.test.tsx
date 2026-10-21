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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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
});
