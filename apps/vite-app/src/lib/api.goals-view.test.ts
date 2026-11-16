import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetAuthForTesting, setAccessTokenProvider } from "./auth";
import { getBaseUrl } from "./api";

type GoalStatus = "achieved" | "not_achieved" | "unknown" | "not_assessed";

interface GoalDefinition {
  goal_id: string;
  goal_version: number;
  description_en: string;
  description_zh: string;
  criteria: string[];
  evidence_types: string[];
}

interface SessionGoalsResponse {
  session_id: string;
  configured: boolean;
  material_id: string | null;
  material_version: number | null;
  goals: Array<GoalDefinition & { result: GoalStatus | null }>;
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

interface ViewGoalsApi {
  getSessionGoals: (
    sessionId: string,
    options?: { signal?: AbortSignal | null },
  ) => Promise<SessionGoalsResponse>;
  parseSessionGoalsResponse: (data: unknown, expectedSessionId: string) => SessionGoalsResponse;
}

const SESSION_ID = "78100000-0000-4000-8000-000000000101";

function goal(index: number): GoalDefinition {
  return {
    goal_id: `mat_synthetic_goals:goal_${index}`,
    goal_version: 1,
    description_en: `Synthetic goal ${index}.`,
    description_zh: `合成目标 ${index}。`,
    criteria: [`Complete synthetic goal ${index}.`],
    evidence_types: ["transcript"],
  };
}

const terminalResponse: SessionGoalsResponse = {
  session_id: SESSION_ID,
  configured: true,
  material_id: "mat_synthetic_goals",
  material_version: 1,
  goals: [
    { ...goal(1), result: "achieved" },
    { ...goal(2), result: "not_achieved" },
    { ...goal(3), result: "unknown" },
    { ...goal(4), result: "not_assessed" },
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

const pendingResponse: SessionGoalsResponse = {
  ...terminalResponse,
  goals: terminalResponse.goals.map((item) => ({ ...item, result: null })),
  execution: {
    status: "pending",
    revision: 1,
    evaluator_version: "rules-v1",
  },
  summary: null,
};

const unconfiguredResponse: SessionGoalsResponse = {
  session_id: SESSION_ID,
  configured: false,
  material_id: null,
  material_version: null,
  goals: [],
  execution: null,
  summary: null,
};

async function requireViewGoalsApi(): Promise<ViewGoalsApi> {
  const api = await import("./api");
  expect(
    (api as unknown as Partial<ViewGoalsApi>).getSessionGoals,
    "runtime RED: add getSessionGoals to src/lib/api.ts after G-EVAL publishes",
  ).toBeTypeOf("function");
  expect(
    (api as unknown as Partial<ViewGoalsApi>).parseSessionGoalsResponse,
    "runtime RED: add strict parseSessionGoalsResponse to src/lib/api.ts after G-EVAL publishes",
  ).toBeTypeOf("function");
  return api as unknown as ViewGoalsApi;
}

describe("G-VIEW session goals API contract", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    _resetAuthForTesting();
    globalThis.fetch = vi.fn();
    setAccessTokenProvider(() => "goals-view-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("GETs the exact session endpoint, preserves AbortSignal, and parses terminal results", async () => {
    const { getSessionGoals } = await requireViewGoalsApi();
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => structuredClone(terminalResponse),
    } as Response);
    const abort = new AbortController();

    await expect(getSessionGoals(SESSION_ID, { signal: abort.signal })).resolves.toEqual(
      terminalResponse,
    );

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe(`${getBaseUrl()}/sessions/${SESSION_ID}/goals`);
    expect(options?.method ?? "GET").toBe("GET");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer goals-view-token");
  });

  it("accepts unconfigured, progress, and both terminal execution shapes", async () => {
    const { parseSessionGoalsResponse } = await requireViewGoalsApi();

    expect(parseSessionGoalsResponse(unconfiguredResponse, SESSION_ID)).toEqual(
      unconfiguredResponse,
    );
    for (const status of ["pending", "running"] as const) {
      const response: SessionGoalsResponse = {
        ...pendingResponse,
        execution: { ...pendingResponse.execution!, status },
      };
      const parsed = parseSessionGoalsResponse(response, SESSION_ID);
      expect(parsed.summary).toBeNull();
      expect(parsed.goals.every((item) => item.result === null)).toBe(true);
    }
    for (const status of ["succeeded", "failed"] as const) {
      const response: SessionGoalsResponse = {
        ...structuredClone(terminalResponse),
        execution: {
          ...terminalResponse.execution!,
          status,
        },
      };
      expect(parseSessionGoalsResponse(response, SESSION_ID)).toEqual(response);
    }
  });

  it("accepts a snapshot without a run as derived not_assessed without materializing a run", async () => {
    const { parseSessionGoalsResponse } = await requireViewGoalsApi();
    const noRunResponse: SessionGoalsResponse = {
      ...structuredClone(terminalResponse),
      goals: terminalResponse.goals.map((item) => ({ ...item, result: "not_assessed" })),
      execution: null,
      summary: {
        total: 4,
        achieved: 0,
        not_achieved: 0,
        assessed: 0,
        unknown: 0,
        not_assessed: 4,
      },
    };

    expect(parseSessionGoalsResponse(noRunResponse, SESSION_ID)).toEqual(noRunResponse);
    expect(noRunResponse.execution).toBeNull();
    expect(noRunResponse.goals.every((item) => item.result === "not_assessed")).toBe(true);
  });

  it.each([
    [
      "session_id does not match the requested session",
      (value: SessionGoalsResponse) => {
        value.session_id = "78100000-0000-4000-8000-000000000102";
      },
    ],
    [
      "unconfigured response contains snapshot data",
      (value: SessionGoalsResponse) => {
        value.configured = false;
        value.material_id = null;
        value.material_version = null;
        value.goals = [];
        value.execution = null;
        value.summary = null;
        value.material_id = "mat_leak";
      },
    ],
    [
      "unconfigured response manufactures a goal row",
      (value: SessionGoalsResponse) => {
        value.configured = false;
        value.material_id = null;
        value.material_version = null;
        value.goals = [];
        value.execution = null;
        value.summary = null;
        value.goals = [structuredClone(terminalResponse.goals[3])];
      },
    ],
    [
      "pending response manufactures a summary",
      (value: SessionGoalsResponse) => {
        value.execution!.status = "pending";
        value.goals = value.goals.map((item) => ({ ...item, result: null }));
        value.summary = null;
        value.summary = structuredClone(terminalResponse.summary);
      },
    ],
    [
      "pending response manufactures a per-goal result",
      (value: SessionGoalsResponse) => {
        value.execution!.status = "pending";
        value.goals = value.goals.map((item) => ({ ...item, result: null }));
        value.summary = null;
        value.goals[0].result = "achieved";
      },
    ],
    [
      "pending response omits evaluator_version",
      (value: SessionGoalsResponse) => {
        delete (value.execution as Partial<NonNullable<SessionGoalsResponse["execution"]>>)
          .evaluator_version;
      },
    ],
    [
      "terminal response omits summary",
      (value: SessionGoalsResponse) => {
        value.summary = null;
      },
    ],
    [
      "terminal response leaves a result null",
      (value: SessionGoalsResponse) => {
        value.goals[0].result = null;
      },
    ],
    [
      "snapshot without a run fabricates a non-not_assessed result",
      (value: SessionGoalsResponse) => {
        value.execution = null;
        value.goals = value.goals.map((item) => ({ ...item, result: "not_assessed" }));
        value.summary = {
          total: 4,
          achieved: 1,
          not_achieved: 0,
          assessed: 1,
          unknown: 0,
          not_assessed: 3,
        };
        value.goals[0].result = "achieved";
      },
    ],
    [
      "terminal response omits a goal definition field",
      (value: SessionGoalsResponse) => {
        delete (value.goals[0] as Partial<SessionGoalsResponse["goals"][number]>).criteria;
      },
    ],
    [
      "response has an unknown execution enum",
      (value: SessionGoalsResponse) => {
        (value.execution as { status: string }).status = "timed_out";
      },
    ],
    [
      "response has an unknown goal result enum",
      (value: SessionGoalsResponse) => {
        (value.goals[0] as { result: string }).result = "partially_achieved";
      },
    ],
    [
      "response duplicates a goal_id",
      (value: SessionGoalsResponse) => {
        value.goals[1].goal_id = value.goals[0].goal_id;
      },
    ],
    [
      "summary does not equal its goal rows",
      (value: SessionGoalsResponse) => {
        value.summary!.achieved = 2;
        value.summary!.assessed = 2;
      },
    ],
    [
      "summary does not equal unknown and not_assessed rows",
      (value: SessionGoalsResponse) => {
        value.summary!.unknown = 0;
        value.summary!.not_assessed = 2;
      },
    ],
    [
      "achieved exceeds assessed",
      (value: SessionGoalsResponse) => {
        value.summary!.achieved = 3;
      },
    ],
    [
      "assessed exceeds total",
      (value: SessionGoalsResponse) => {
        value.summary!.assessed = 5;
      },
    ],
    [
      "root adds an undeclared field",
      (value: SessionGoalsResponse) => {
        (value as SessionGoalsResponse & { percent: number }).percent = 25;
      },
    ],
    [
      "execution adds an undeclared field",
      (value: SessionGoalsResponse) => {
        (value.execution as SessionGoalsResponse["execution"] & { percent: number })!.percent = 50;
      },
    ],
    [
      "goal result adds an undeclared percentage",
      (value: SessionGoalsResponse) => {
        (value.goals[0] as SessionGoalsResponse["goals"][number] & { percent: number }).percent =
          100;
      },
    ],
  ])("rejects malformed protocol: %s", async (_label, mutate) => {
    const { parseSessionGoalsResponse } = await requireViewGoalsApi();
    const malformed = structuredClone(terminalResponse);
    mutate(malformed);

    expect(() => parseSessionGoalsResponse(malformed, SESSION_ID)).toThrow();
  });

  it("does not downgrade a source 404 to configured=false", async () => {
    const { getSessionGoals } = await requireViewGoalsApi();
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: "Not found" }),
    } as Response);

    await expect(getSessionGoals(SESSION_ID)).rejects.toMatchObject({ status: 404 });
  });
});
