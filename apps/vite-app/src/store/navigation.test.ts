import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "./appStore";
import { useNavigationStore } from "./appStore";
import type { AppStore } from "./appStore";
import { useConversationStore, _setLifecycleOptionsForTesting } from "./conversation";
import type { ConversationStore } from "./conversation";
import * as api from "@/lib/api";
import * as auth from "@/lib/auth";

vi.mock("@/lib/api", async (importOriginal) => {
  const { ApiError, isValidUuid } = await importOriginal<typeof import("@/lib/api")>();
  return {
    ApiError,
    isValidUuid,
    getCallCapabilities: vi.fn(),
    checkHealthReady: vi.fn(),
    createSession: vi.fn(),
    getSessionDetail: vi.fn(),
    getSessionToken: vi.fn(),
    endSession: vi.fn(),
  };
});

vi.mock("@/lib/auth", () => ({
  getAuthSnapshot: vi.fn(),
  getAuthRevision: vi.fn(),
  arePrincipalsEqual: vi.fn(
    (a: unknown, b: unknown) =>
      a === b ||
      (!!a &&
        !!b &&
        (a as { issuer: string }).issuer === (b as { issuer: string }).issuer &&
        (a as { subject: string }).subject === (b as { subject: string }).subject),
  ),
  subscribeAuthSnapshot: vi.fn(() => () => {}),
}));

const conversationSources = import.meta.glob<string>("./conversation.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** 从完整 AppStore 状态剥离三个非 ConversationSlice 键，得到窄类型替换体。 */
const stripShell = (state: AppStore): ConversationStore => {
  const {
    appView: appViewShell,
    goHome: goHomeShell,
    openDocChatSetup: openDocChatSetupShell,
    ...conversation
  } = state;
  void appViewShell;
  void goHomeShell;
  void openDocChatSetupShell;
  return conversation;
};

describe("navigation slice", () => {
  beforeEach(() => {
    useAppStore.getState().goHome();
    vi.clearAllMocks();
    _setLifecycleOptionsForTesting(null);
    vi.mocked(auth.getAuthSnapshot).mockReturnValue({
      state: "authenticated",
      principal: { issuer: "https://auth.example.com", subject: "user-1" },
    });
    vi.mocked(auth.getAuthRevision).mockReturnValue(1);
    vi.mocked(api.getCallCapabilities).mockResolvedValue({
      protocol_version: 1,
      call_lease_mode: "disabled",
    });
  });

  afterEach(() => {
    _setLifecycleOptionsForTesting(null);
    vi.restoreAllMocks();
  });

  it("keeps page state and the home action out of the conversation module", () => {
    const source = conversationSources["./conversation.ts"];

    expect(source).not.toContain("appView");
    expect(source).not.toContain("AppView");
    expect(source).not.toContain("goHome");
  });

  it("reset preserves navigation and selected scenario while goHome clears both", () => {
    const scenario = {
      scenario_name: "Coffee Shop",
      difficulty_cefr: "A2",
      category: "daily",
      focus_skills: ["listening"],
      system_prompt_template: "Prompt",
    };
    useNavigationStore.setState({ appView: "session" });
    useAppStore.setState((state) => ({
      ...state,
      connectionState: "active",
      sessionId: "sess-navigation-reset",
      token: "tok-navigation-reset",
      wsUrl: "wss://lk.test",
      selectedScenario: scenario,
    }));

    useAppStore.getState().reset();

    expect(useAppStore.getState()).toMatchObject({
      connectionState: "idle",
      sessionId: null,
      token: null,
      wsUrl: null,
      appView: "session",
      selectedScenario: scenario,
    });

    useAppStore.getState().goHome();

    expect(useAppStore.getState()).toMatchObject({
      connectionState: "idle",
      sessionId: null,
      token: null,
      wsUrl: null,
      appView: "dashboard",
      selectedScenario: null,
    });
  });

  it("publishes resumed credentials and session navigation in one synchronous update", async () => {
    const sessionId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    vi.mocked(api.getSessionDetail).mockResolvedValue({
      id: sessionId,
      user_id: "user-1",
      mode: "free_talk",
      status: "active",
      started_at: "2026-11-12T00:00:00Z",
      ended_at: null,
      transcripts: [],
    });
    vi.mocked(api.checkHealthReady).mockResolvedValue({ status: "ready" });
    let resolveToken!: (value: { token: string; ws_url: string }) => void;
    vi.mocked(api.getSessionToken).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveToken = resolve;
        }),
    );
    const observations: Array<{
      sessionId: string | null;
      token: string | null;
      wsUrl: string | null;
      connectionState: string;
      appView: string;
    }> = [];
    const unsubscribe = useAppStore.subscribe((state) => {
      observations.push({
        sessionId: state.sessionId,
        token: state.token,
        wsUrl: state.wsUrl,
        connectionState: state.connectionState,
        appView: state.appView,
      });
    });

    try {
      const resume = useAppStore.getState().resumeSession(sessionId, {
        principal: { issuer: "https://auth.example.com", subject: "user-1" },
        revision: 1,
      });
      await vi.waitFor(() => expect(api.getSessionToken).toHaveBeenCalledWith(sessionId));
      expect(useAppStore.getState()).toMatchObject({
        sessionId: null,
        token: null,
        wsUrl: null,
        connectionState: "checking_health",
        appView: "dashboard",
      });

      resolveToken({ token: "resumed-token", ws_url: "wss://lk.test" });
      await expect(resume).resolves.toBe(true);
    } finally {
      unsubscribe();
    }

    expect(useAppStore.getState()).toMatchObject({
      sessionId,
      token: "resumed-token",
      wsUrl: "wss://lk.test",
      connectionState: "connecting",
      appView: "session",
    });
    expect(
      observations.filter(
        (observation) => observation.sessionId !== null && observation.appView !== "session",
      ),
    ).toEqual([]);
    expect(observations.at(-1)).toEqual({
      sessionId,
      token: "resumed-token",
      wsUrl: "wss://lk.test",
      connectionState: "connecting",
      appView: "session",
    });
  });

  it("narrow facade replace=true keeps navigation/shell keys and publishes once (object)", () => {
    useNavigationStore.setState({ appView: "session" });
    useAppStore.setState((state) => ({
      ...state,
      connectionState: "active",
      sessionId: "sess-replace-obj",
      token: "tok-replace-obj",
      wsUrl: "wss://lk.test",
    }));

    const goHome = useAppStore.getState().goHome;
    const openDocChatSetup = useAppStore.getState().openDocChatSetup;
    const conversationOnly = stripShell(useAppStore.getState());

    let notifications = 0;
    const unsubscribe = useAppStore.subscribe(() => {
      notifications += 1;
    });
    try {
      useConversationStore.setState(conversationOnly, true);
    } finally {
      unsubscribe();
    }

    const state = useAppStore.getState();
    expect(notifications).toBe(1);
    expect(state.appView).toBe("session");
    expect(state.goHome).toBe(goHome);
    expect(state.openDocChatSetup).toBe(openDocChatSetup);
    expect(state).toMatchObject({
      sessionId: "sess-replace-obj",
      token: "tok-replace-obj",
      wsUrl: "wss://lk.test",
      connectionState: "active",
    });
  });

  it("narrow facade replace=true keeps navigation/shell keys and publishes once (function)", () => {
    useNavigationStore.setState({ appView: "session" });
    useAppStore.setState((state) => ({
      ...state,
      connectionState: "active",
      sessionId: "sess-replace-fn",
      token: "tok-replace-fn",
      wsUrl: "wss://lk.test",
    }));

    const goHome = useAppStore.getState().goHome;
    const openDocChatSetup = useAppStore.getState().openDocChatSetup;

    let notifications = 0;
    const unsubscribe = useAppStore.subscribe(() => {
      notifications += 1;
    });
    try {
      useConversationStore.setState((state) => stripShell(state as AppStore), true);
    } finally {
      unsubscribe();
    }

    const state = useAppStore.getState();
    expect(notifications).toBe(1);
    expect(state.appView).toBe("session");
    expect(state.goHome).toBe(goHome);
    expect(state.openDocChatSetup).toBe(openDocChatSetup);
    expect(state).toMatchObject({
      sessionId: "sess-replace-fn",
      token: "tok-replace-fn",
      wsUrl: "wss://lk.test",
      connectionState: "active",
    });
  });
});
