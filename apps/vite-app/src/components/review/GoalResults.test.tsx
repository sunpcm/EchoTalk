import type { ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";

type GoalStatus = "achieved" | "not_achieved" | "unknown" | "not_assessed";

interface SessionGoalsResponse {
  session_id: string;
  configured: boolean;
  material_id: string | null;
  material_version: number | null;
  goals: Array<{
    goal_id: string;
    goal_version: number;
    description_en: string;
    description_zh: string;
    criteria: string[];
    evidence_types: string[];
    result: GoalStatus | null;
  }>;
  execution: {
    status: "pending" | "running" | "succeeded" | "failed";
    revision: number;
    evaluator_version: string;
  } | null;
  summary: {
    total: number;
    achieved: number;
    not_achieved: number;
    assessed: number;
    unknown: number;
    not_assessed: number;
  } | null;
}

type MockAuthSnapshot =
  | {
      state: "authenticated";
      principal: { issuer: string; subject: string };
    }
  | {
      state: "anonymous";
      principal: null;
    };

interface MockLifecycleSnapshot {
  visibility: "visible" | "hidden";
  online: boolean | null;
}

const authControl = vi.hoisted(() => ({
  snapshot: {
    state: "authenticated",
    principal: { issuer: "https://auth.example", subject: "user-one" },
  } as MockAuthSnapshot,
  revision: 1,
  listeners: new Set<(snapshot: MockAuthSnapshot) => void>(),
}));

const lifecycleControl = vi.hoisted(() => ({
  snapshot: { visibility: "visible", online: true } as MockLifecycleSnapshot,
  listeners: new Set<(event: { type: string; snapshot: MockLifecycleSnapshot }) => void>(),
}));

const getSessionGoalsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    getAuthSnapshot: () => authControl.snapshot,
    getAuthRevision: () => authControl.revision,
    subscribeAuthSnapshot: (listener: (snapshot: MockAuthSnapshot) => void) => {
      authControl.listeners.add(listener);
      return () => authControl.listeners.delete(listener);
    },
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getSessionGoals: getSessionGoalsMock,
  };
});

vi.mock("@/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform")>();
  return {
    ...actual,
    createLifecycleAdapter: () => ({
      capabilities: { webEvents: true, nativeAppState: false },
      getSnapshot: () => lifecycleControl.snapshot,
      subscribe: (listener: (event: { type: string; snapshot: MockLifecycleSnapshot }) => void) => {
        lifecycleControl.listeners.add(listener);
        return () => lifecycleControl.listeners.delete(listener);
      },
      dispose: vi.fn(),
      whenReady: () => Promise.resolve(),
    }),
  };
});

const SESSION_A = "78100000-0000-4000-8000-000000000201";
const SESSION_B = "78100000-0000-4000-8000-000000000202";

function goal(
  id: string,
  descriptionZh: string,
  result: GoalStatus | null,
): SessionGoalsResponse["goals"][number] {
  return {
    goal_id: id,
    goal_version: 1,
    description_en: `English description for ${id}`,
    description_zh: descriptionZh,
    criteria: [`Criterion for ${id}`],
    evidence_types: ["transcript"],
    result,
  };
}

function terminalResponse(sessionId = SESSION_A): SessionGoalsResponse {
  return {
    session_id: sessionId,
    configured: true,
    material_id: "mat_synthetic_goals",
    material_version: 1,
    goals: [
      goal("mat_synthetic_goals:goal_achieved", "达成目标文案", "achieved"),
      goal("mat_synthetic_goals:goal_not_achieved", "未达成目标文案", "not_achieved"),
      goal("mat_synthetic_goals:goal_unknown", "无法判断目标文案", "unknown"),
      goal("mat_synthetic_goals:goal_not_assessed", "未评估目标文案", "not_assessed"),
    ],
    execution: {
      status: "succeeded",
      revision: 1,
      evaluator_version: "rules-v1",
    },
    summary: {
      total: 4,
      achieved: 1,
      not_achieved: 1,
      assessed: 2,
      unknown: 1,
      not_assessed: 1,
    },
  };
}

function singleGoalTerminal(sessionId: string, descriptionZh: string): SessionGoalsResponse {
  return {
    session_id: sessionId,
    configured: true,
    material_id: "mat_synthetic_goals",
    material_version: 1,
    goals: [goal("mat_synthetic_goals:single_goal", descriptionZh, "achieved")],
    execution: {
      status: "succeeded",
      revision: 1,
      evaluator_version: "rules-v1",
    },
    summary: {
      total: 1,
      achieved: 1,
      not_achieved: 0,
      assessed: 1,
      unknown: 0,
      not_assessed: 0,
    },
  };
}

function progressResponse(
  sessionId: string,
  status: "pending" | "running",
  description = status === "pending" ? "等待评估目标" : "正在评估目标",
): SessionGoalsResponse {
  return {
    session_id: sessionId,
    configured: true,
    material_id: "mat_synthetic_goals",
    material_version: 1,
    goals: [goal(`mat_synthetic_goals:goal_${status}`, description, null)],
    execution: {
      status,
      revision: 1,
      evaluator_version: "rules-v1",
    },
    summary: null,
  };
}

const unconfiguredResponse: SessionGoalsResponse = {
  session_id: SESSION_A,
  configured: false,
  material_id: null,
  material_version: null,
  goals: [],
  execution: null,
  summary: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

const goalResultsModuleLoaders = import.meta.glob("./GoalResults.tsx");

async function loadGoalResults(): Promise<ComponentType<{ sessionId: string | null }>> {
  const loadModule = goalResultsModuleLoaders["./GoalResults.tsx"];
  expect(
    loadModule,
    "runtime RED: add src/components/review/GoalResults.tsx after G-EVAL publishes",
  ).toBeTypeOf("function");
  if (!loadModule) throw new Error("runtime RED: GoalResults module is unavailable");

  const module = await loadModule();
  const GoalResults = (module as { GoalResults?: ComponentType<{ sessionId: string | null }> })
    .GoalResults;
  expect(
    GoalResults,
    "runtime RED: export GoalResults({ sessionId }) from src/components/review/GoalResults.tsx",
  ).toBeTypeOf("function");
  return GoalResults!;
}

async function renderGoalResults(sessionId: string | null) {
  const GoalResults = await loadGoalResults();
  const result = render(<GoalResults sessionId={sessionId} />);
  await flush();
  return result;
}

describe("G-VIEW GoalResults", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    getSessionGoalsMock.mockReset();
    authControl.snapshot = {
      state: "authenticated",
      principal: { issuer: "https://auth.example", subject: "user-one" },
    };
    authControl.revision = 1;
    authControl.listeners.clear();
    lifecycleControl.snapshot = { visibility: "visible", online: true };
    lifecycleControl.listeners.clear();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("renders terminal summary and all result meanings without percentages", async () => {
    getSessionGoalsMock.mockResolvedValue(terminalResponse());

    await renderGoalResults(SESSION_A);

    expect(screen.getByRole("heading", { name: "会话目标" })).toBeInTheDocument();
    const summary = screen.getByTestId("goal-summary");
    expect(summary).toHaveTextContent("已达成 1 / 已明确判定 2 / 目标总数 4");
    expect(summary).toHaveTextContent("无法判断 1");
    expect(summary).toHaveTextContent("未评估 1");
    expect(summary.textContent).not.toContain("%");

    const rows = screen.getAllByTestId("goal-result");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText("已达成")).toBeInTheDocument();
    expect(within(rows[1]).getByText("未达成")).toBeInTheDocument();
    expect(within(rows[2]).getByText("无法判断")).toBeInTheDocument();
    expect(within(rows[3]).getByText("未评估")).toBeInTheDocument();
    expect(screen.getByText("达成目标文案")).toBeInTheDocument();
    expect(screen.getByText("无法判断目标文案")).toBeInTheDocument();
  });

  it("renders a failed execution summary instead of converting it into not_assessed", async () => {
    const failed = terminalResponse();
    failed.execution = {
      status: "failed",
      revision: 1,
      evaluator_version: "rules-v1",
    };
    getSessionGoalsMock.mockResolvedValue(failed);

    await renderGoalResults(SESSION_A);

    expect(screen.getByTestId("goal-summary")).toHaveTextContent(
      "已达成 1 / 已明确判定 2 / 目标总数 4",
    );
    expect(screen.getByTestId("goal-summary")).toHaveTextContent("无法判断 1");
    expect(screen.getByTestId("goal-summary")).toHaveTextContent("未评估 1");
    expect(screen.queryByText("目标结果读取失败")).not.toBeInTheDocument();
  });

  it("renders a snapshot without a run as derived not_assessed, not as unconfigured", async () => {
    const noRun = singleGoalTerminal(SESSION_A, "未运行判定目标");
    noRun.goals[0].result = "not_assessed";
    noRun.execution = null;
    noRun.summary = {
      total: 1,
      achieved: 0,
      not_achieved: 0,
      assessed: 0,
      unknown: 0,
      not_assessed: 1,
    };
    getSessionGoalsMock.mockResolvedValue(noRun);

    await renderGoalResults(SESSION_A);

    expect(screen.getByTestId("goal-summary")).toHaveTextContent(
      "已达成 0 / 已明确判定 0 / 目标总数 1",
    );
    expect(screen.getByTestId("goal-summary")).toHaveTextContent("未评估 1");
    expect(screen.getByText("未运行判定目标")).toBeInTheDocument();
    expect(screen.getByText("未评估")).toBeInTheDocument();
    expect(screen.queryByText("本会话未配置课程目标")).not.toBeInTheDocument();
    expect(screen.queryByText("目标评估中")).not.toBeInTheDocument();
  });

  it("distinguishes null session, configured=false, and endpoint 404", async () => {
    await renderGoalResults(null);
    expect(getSessionGoalsMock).not.toHaveBeenCalled();
    cleanup();

    authControl.snapshot = { state: "anonymous", principal: null };
    await renderGoalResults(SESSION_A);
    expect(getSessionGoalsMock).not.toHaveBeenCalled();
    cleanup();

    authControl.snapshot = {
      state: "authenticated",
      principal: { issuer: "https://auth.example", subject: "user-one" },
    };
    getSessionGoalsMock.mockResolvedValueOnce(unconfiguredResponse);
    await renderGoalResults(SESSION_A);
    expect(screen.getByText("本会话未配置课程目标")).toBeInTheDocument();
    expect(screen.queryByText("目标结果暂不可用")).not.toBeInTheDocument();
    expect(screen.queryByText("0 / 0")).not.toBeInTheDocument();
    expect(screen.queryByText(/0%|100%/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("goal-result")).not.toBeInTheDocument();
    cleanup();

    getSessionGoalsMock.mockRejectedValueOnce(new ApiError(404, "Not found"));
    await renderGoalResults(SESSION_A);
    expect(screen.getByText("目标结果暂不可用")).toBeInTheDocument();
    expect(screen.queryByText("本会话未配置课程目标")).not.toBeInTheDocument();
  });

  it("keeps pending/running at 1s/2s/5s beyond 60s without a business timeout, then stops", async () => {
    let terminal = false;
    let call = 0;
    getSessionGoalsMock.mockImplementation(async () => {
      call += 1;
      return terminal
        ? terminalResponse()
        : progressResponse(SESSION_A, call === 1 ? "pending" : "running");
    });

    await renderGoalResults(SESSION_A);
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("目标评估中")).toBeInTheDocument();
    expect(screen.queryByTestId("goal-summary")).not.toBeInTheDocument();
    expect(screen.queryByText("未评估")).not.toBeInTheDocument();
    expect(screen.queryByText("目标结果读取失败")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await flush();
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("目标评估中")).toBeInTheDocument();
    expect(screen.queryByTestId("goal-summary")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await flush();
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(3);
    expect(screen.queryByTestId("goal-summary")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999);
    });
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await flush();
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(4);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getSessionGoalsMock.mock.calls.length).toBeGreaterThan(4);
    expect(screen.getByText("目标评估中")).toBeInTheDocument();
    expect(screen.queryByTestId("goal-summary")).not.toBeInTheDocument();
    expect(screen.queryByText("目标结果读取失败")).not.toBeInTheDocument();
    expect(screen.queryByText("未评估")).not.toBeInTheDocument();

    terminal = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await flush();
    expect(screen.getByTestId("goal-summary")).toHaveTextContent(
      "已达成 1 / 已明确判定 2 / 目标总数 4",
    );
    const terminalCalls = getSessionGoalsMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(terminalCalls);
  });

  it("stops automatic reads after a pending read error; explicit retry is safe", async () => {
    getSessionGoalsMock
      .mockResolvedValueOnce(progressResponse(SESSION_A, "pending"))
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(terminalResponse());

    await renderGoalResults(SESSION_A);
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("目标评估中")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await flush();
    expect(screen.getByText("目标结果读取失败")).toBeInTheDocument();
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "重新读取" }));
    await flush();
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("goal-summary")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新分析" })).not.toBeInTheDocument();
  });

  it("never overlaps a scheduled refresh with an in-flight request", async () => {
    const secondRequest = deferred<SessionGoalsResponse>();
    getSessionGoalsMock
      .mockResolvedValueOnce(progressResponse(SESSION_A, "pending"))
      .mockReturnValueOnce(secondRequest.promise);

    await renderGoalResults(SESSION_A);
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(2);

    secondRequest.resolve(progressResponse(SESSION_A, "running"));
    await flush();
    expect(screen.getByText("目标评估中")).toBeInTheDocument();
  });

  it("stops while hidden or offline and performs one eligible read on recovery", async () => {
    getSessionGoalsMock.mockImplementation(async (sessionId: string) =>
      progressResponse(sessionId, "pending"),
    );

    await renderGoalResults(SESSION_A);
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(1);

    lifecycleControl.snapshot = { visibility: "hidden", online: true };
    act(() => {
      lifecycleControl.listeners.forEach((listener) =>
        listener({ type: "suspend", snapshot: lifecycleControl.snapshot }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(1);

    lifecycleControl.snapshot = { visibility: "visible", online: true };
    act(() => {
      lifecycleControl.listeners.forEach((listener) =>
        listener({ type: "resume", snapshot: lifecycleControl.snapshot }),
      );
    });
    await flush();
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(2);

    lifecycleControl.snapshot = { visibility: "visible", online: false };
    act(() => {
      lifecycleControl.listeners.forEach((listener) =>
        listener({ type: "connectivity", snapshot: lifecycleControl.snapshot }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(2);

    lifecycleControl.snapshot = { visibility: "visible", online: true };
    act(() => {
      lifecycleControl.listeners.forEach((listener) =>
        listener({ type: "connectivity", snapshot: lifecycleControl.snapshot }),
      );
    });
    await flush();
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(3);
  });

  it("clears a pending refresh timer on unmount", async () => {
    getSessionGoalsMock.mockImplementation(async (sessionId: string) =>
      progressResponse(sessionId, "pending"),
    );

    const { unmount } = await renderGoalResults(SESSION_A);
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(1);
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(1);
  });

  it("drops a late response after sessionId changes", async () => {
    const oldRequest = deferred<SessionGoalsResponse>();
    const newRequest = deferred<SessionGoalsResponse>();
    getSessionGoalsMock.mockImplementation((sessionId: string) =>
      sessionId === SESSION_A ? oldRequest.promise : newRequest.promise,
    );

    const GoalResults = await loadGoalResults();
    const view = render(<GoalResults sessionId={SESSION_A} />);
    await flush();
    expect(getSessionGoalsMock.mock.calls.at(-1)?.[0]).toBe(SESSION_A);

    view.rerender(<GoalResults sessionId={SESSION_B} />);
    await flush();
    expect(getSessionGoalsMock.mock.calls.at(-1)?.[0]).toBe(SESSION_B);

    oldRequest.resolve(singleGoalTerminal(SESSION_A, "旧 session 结果"));
    await flush();
    expect(screen.queryByText("旧 session 结果")).not.toBeInTheDocument();

    newRequest.resolve(singleGoalTerminal(SESSION_B, "新 session 结果"));
    await flush();
    expect(screen.getByText("新 session 结果")).toBeInTheDocument();
    expect(screen.queryByText("旧 session 结果")).not.toBeInTheDocument();
  });

  it("clears the previous session result before the new session response settles", async () => {
    const newRequest = deferred<SessionGoalsResponse>();
    getSessionGoalsMock
      .mockResolvedValueOnce(singleGoalTerminal(SESSION_A, "旧 session 已展示"))
      .mockReturnValueOnce(newRequest.promise);

    const GoalResults = await loadGoalResults();
    const view = render(<GoalResults sessionId={SESSION_A} />);
    await flush();
    expect(screen.getByText("旧 session 已展示")).toBeInTheDocument();

    view.rerender(<GoalResults sessionId={SESSION_B} />);
    await flush();
    expect(getSessionGoalsMock.mock.calls.at(-1)?.[0]).toBe(SESSION_B);
    expect(screen.queryByText("旧 session 已展示")).not.toBeInTheDocument();
    expect(screen.queryByTestId("goal-summary")).not.toBeInTheDocument();

    newRequest.resolve(singleGoalTerminal(SESSION_B, "新 session 已展示"));
    await flush();
    expect(screen.getByText("新 session 已展示")).toBeInTheDocument();
  });

  it.each([
    [
      "principal",
      () => {
        authControl.snapshot = {
          state: "authenticated",
          principal: { issuer: "https://auth.example", subject: "user-two" },
        };
      },
    ],
    [
      "auth revision",
      () => {
        authControl.revision = 2;
      },
    ],
  ] as const)("drops a late response after the %s changes", async (_change, mutateAuth) => {
    const oldRequest = deferred<SessionGoalsResponse>();
    const newRequest = deferred<SessionGoalsResponse>();
    getSessionGoalsMock
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);

    await renderGoalResults(SESSION_A);
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(1);

    mutateAuth();
    act(() => {
      authControl.listeners.forEach((listener) => listener(authControl.snapshot));
    });
    await flush();
    expect(getSessionGoalsMock).toHaveBeenCalledTimes(2);

    oldRequest.resolve(singleGoalTerminal(SESSION_A, "旧账号目标"));
    await flush();
    expect(screen.queryByText("旧账号目标")).not.toBeInTheDocument();

    newRequest.resolve(singleGoalTerminal(SESSION_A, "新账号目标"));
    await flush();
    expect(screen.getByText("新账号目标")).toBeInTheDocument();
  });
});
