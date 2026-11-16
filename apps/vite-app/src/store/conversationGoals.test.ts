import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import {
  createConversationSlice,
  type ConversationSlice,
  type ConversationSliceCoordinator,
} from "./conversationSlice";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";
import { detectPlatform } from "@/platform";

vi.mock("@/lib/api", async (importOriginal) => {
  const { ApiError } = await importOriginal<typeof import("@/lib/api")>();
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return {
    ApiError,
    getCallCapabilities: vi.fn(),
    checkHealthReady: vi.fn(),
    createSession: vi.fn(),
    getSessionDetail: vi.fn(),
    getSessionToken: vi.fn(),
    endSession: vi.fn(),
    isValidUuid: vi.fn(
      (value: unknown): value is string => typeof value === "string" && UUID_REGEX.test(value),
    ),
  };
});

vi.mock("@/lib/auth", () => ({
  getAuthSnapshot: vi.fn(),
  getAuthRevision: vi.fn(),
  arePrincipalsEqual: vi.fn(
    (left: auth.AuthPrincipal, right: auth.AuthPrincipal) =>
      left === right ||
      (left && right && left.issuer === right.issuer && left.subject === right.subject),
  ),
  subscribeAuthSnapshot: vi.fn(() => () => {}),
}));

vi.mock("@/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/platform")>();
  return {
    ...actual,
    detectPlatform: vi.fn(() => "web"),
    createLifecycleAdapter: vi.fn(() => ({
      capabilities: { webEvents: true, nativeAppState: false },
      getSnapshot: () => ({ visibility: "visible", online: true }),
      subscribe: () => () => {},
      dispose: () => {},
      whenReady: () => Promise.resolve(),
    })),
  };
});

interface GoalBindingForTest {
  material_id: string;
  material_version: number;
  goals?: unknown;
}

type ScenarioWithGoals = api.CurriculumRecommendation & {
  goal_binding?: GoalBindingForTest;
};

const coordinator: ConversationSliceCoordinator<ConversationSlice> = {
  beginConnectingPatch: () => ({}),
  credentialsReadyPatch: () => ({}),
  startupClosedPatch: () => ({}),
  isRoomOwningState: () => true,
};

function createTestStore(): UseBoundStore<StoreApi<ConversationSlice>> {
  return create<ConversationSlice>((set, get) => ({
    ...createConversationSlice(
      set as unknown as (partial: object | ((state: ConversationSlice) => object)) => void,
      get,
      coordinator,
    ),
  }));
}

const principal = { issuer: "https://auth.example.com", subject: "user-1" };
const sessionId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function makeScenario(scenarioName: string, goalBinding?: GoalBindingForTest): ScenarioWithGoals {
  return {
    scenario_name: scenarioName,
    difficulty_cefr: "B1",
    category: "conversation",
    focus_skills: ["word_stress"],
    system_prompt_template: "Practice a short professional conversation.",
    ...(goalBinding ? { goal_binding: goalBinding } : {}),
  } as unknown as ScenarioWithGoals;
}

function makeSession(): api.Session {
  return {
    id: sessionId,
    user_id: "bd0cd0c7-8f48-4619-bc09-bf7bd2cb100f",
    mode: "scenario",
    status: "active",
    started_at: "2026-11-16T08:00:00Z",
    ended_at: null,
    transcripts: [],
  };
}

describe("G-WIRE conversation slice goal binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectPlatform).mockReturnValue("web");
    vi.mocked(auth.getAuthSnapshot).mockReturnValue({
      state: "authenticated",
      principal,
    });
    vi.mocked(auth.getAuthRevision).mockReturnValue(1);
    vi.mocked(api.getCallCapabilities).mockResolvedValue({
      protocol_version: 1,
      call_lease_mode: "disabled",
    });
    vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ready" });
    vi.mocked(api.createSession).mockResolvedValue(makeSession());
    vi.mocked(api.getSessionToken).mockResolvedValue({
      token: "goal-test-token",
      ws_url: "wss://media.example.invalid",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("freezes material id/version before the first await", async () => {
    const store = createTestStore();
    const selected = makeScenario("Business greeting", {
      material_id: "mat_biz_greet_b1",
      material_version: 1,
      goals: [{ goal_id: "client-preview-only" }],
    });
    store.getState().setSelectedScenario(selected);

    const pending = store.getState().startSession("scenario");
    selected.goal_binding!.material_id = "mat_changed_before_await";
    selected.goal_binding!.material_version = 99;
    store.getState().setSelectedScenario(
      makeScenario("Late selection", {
        material_id: "mat_hotel_checkin_b1",
        material_version: 1,
      }),
    );
    await pending;

    expect(api.createSession).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.createSession).mock.calls[0]).toEqual([
      "scenario",
      undefined,
      {
        goalBinding: {
          material_id: "mat_biz_greet_b1",
          material_version: 1,
        },
      },
    ]);
  });

  it("free talk never forwards a residual scenario binding", async () => {
    const store = createTestStore();
    store.getState().setSelectedScenario(
      makeScenario("Hotel", {
        material_id: "mat_hotel_checkin_b1",
        material_version: 1,
      }),
    );

    await store.getState().startSession("free_talk");

    expect(vi.mocked(api.createSession).mock.calls[0]).toEqual(["free_talk", undefined]);
  });

  it("legacy scenario without goal_binding keeps the original two-argument contract", async () => {
    const store = createTestStore();
    store.getState().setSelectedScenario(makeScenario("Legacy scenario"));

    await store.getState().startSession("scenario");

    expect(vi.mocked(api.createSession).mock.calls[0]).toEqual(["scenario", undefined]);
  });
});
