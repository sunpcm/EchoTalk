import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, getBaseUrl, getRecommendedCurriculum } from "./api";
import { _resetAuthForTesting, setAccessTokenProvider } from "./auth";

interface GoalBindingInput {
  readonly material_id: string;
  readonly material_version: number;
  readonly goals?: unknown;
  readonly user_id?: unknown;
}

interface GoalSessionOptions {
  readonly signal?: AbortSignal | null;
  readonly goalBinding?: GoalBindingInput;
}

type CreateGoalSession = (
  mode: string,
  docContext: undefined,
  options: GoalSessionOptions,
) => Promise<{ readonly id: string }>;

interface CurriculumWithGoals {
  readonly recommendations: Array<Record<string, unknown>>;
}

type GetCurriculumWithGoals = (options?: {
  readonly signal?: AbortSignal | null;
}) => Promise<CurriculumWithGoals>;

const createGoalSession = createSession as unknown as CreateGoalSession;
const getCurriculumWithGoals = getRecommendedCurriculum as unknown as GetCurriculumWithGoals;

describe("G-WIRE API serialization", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    _resetAuthForTesting();
    globalThis.fetch = vi.fn();
    setAccessTokenProvider(() => "goal-binding-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const fetchMock = () => vi.mocked(globalThis.fetch);

  it("curriculum requests explicit goal opt-in and preserves AbortSignal", async () => {
    fetchMock().mockResolvedValue({
      ok: true,
      json: async () => ({ recommendations: [] }),
    } as Response);
    const controller = new AbortController();

    await getCurriculumWithGoals({ signal: controller.signal });

    expect(fetchMock()).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock().mock.calls[0];
    expect(url).toBe(getBaseUrl() + "/curriculum/next?include_goals=true");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer goal-binding-token");
  });

  it("session POST sends only the frozen material identifier and version", async () => {
    fetchMock().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "session-1" }),
    } as Response);
    const controller = new AbortController();
    const malicious = {
      material_id: "mat_biz_greet_b1",
      material_version: 1,
      goals: [{ goal_id: "client-authored-goal" }],
      user_id: "attacker-controlled-user",
    };

    await createGoalSession("scenario", undefined, {
      goalBinding: malicious,
      signal: controller.signal,
    });

    expect(fetchMock()).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock().mock.calls[0];
    expect(url).toBe(getBaseUrl() + "/sessions");
    expect(options?.method).toBe("POST");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(options?.body))).toEqual({
      mode: "scenario",
      goal_binding: {
        material_id: "mat_biz_greet_b1",
        material_version: 1,
      },
    });
  });

  it("legacy createSession without a binding keeps the exact old JSON bytes", async () => {
    fetchMock().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "session-legacy" }),
    } as Response);

    await createSession("scenario");

    const [, options] = fetchMock().mock.calls[0];
    expect(String(options?.body)).toBe('{"mode":"scenario"}');
  });

  it("an already-aborted signal prevents a binding POST from reaching fetch", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      createGoalSession("scenario", undefined, {
        goalBinding: {
          material_id: "mat_hotel_checkin_b1",
          material_version: 1,
        },
        signal: controller.signal,
      }),
    ).rejects.toBeTruthy();
    expect(fetchMock()).not.toHaveBeenCalled();
  });
});
