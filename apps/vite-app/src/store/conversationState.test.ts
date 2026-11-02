import { describe, expect, it } from "vitest";
import {
  conversationSessionStateFromProjection,
  createActiveConversationSessionState,
  createCheckingHealthConversationSessionState,
  createConnectionFailedConversationSessionState,
  createCredentialsReadyConversationSessionState,
  createCreatingSessionConversationSessionState,
  createDispatchFailedConversationSessionState,
  createEndFailedConversationSessionState,
  createEndedConversationSessionState,
  createEndingConversationSessionState,
  createFetchingTokenConversationSessionState,
  createIdleConversationSessionState,
  getRoomConnection,
  isConnectingOrActiveConversationSession,
  isStartingConversationSession,
  projectConversationSessionState,
  reduceConversationSession,
  type ActiveConversationSessionState,
  type ConversationSessionProjection,
  type ConversationSessionState,
  type CredentialsReadyConversationSessionState,
} from "./conversationState";

function requireState<T>(state: T | null): T {
  if (!state) throw new Error("test fixture must be a valid conversation state");
  return state;
}

describe("conversation session model", () => {
  it("constructs every phase with only its valid payload", () => {
    const idle = createIdleConversationSessionState();
    const checking = createCheckingHealthConversationSessionState();
    const creating = createCreatingSessionConversationSessionState();
    const fetching = requireState(createFetchingTokenConversationSessionState("sess-1"));
    const credentialsReady = createCredentialsReadyConversationSessionState({
      sessionId: "sess-1",
      token: "token-1",
      wsUrl: "wss://livekit.test",
    });
    const active = credentialsReady ? createActiveConversationSessionState(credentialsReady) : null;
    const ending = createEndingConversationSessionState("sess-1");
    const endFailed = createEndFailedConversationSessionState("sess-1");
    const endedWithoutSession = createEndedConversationSessionState();
    const endedWithSession = createEndedConversationSessionState("sess-1");
    const dispatchFailed = createDispatchFailedConversationSessionState("sess-1");
    const connectionFailed = createConnectionFailedConversationSessionState("sess-1");

    expect(idle).toEqual({ phase: "idle" });
    expect(checking).toEqual({ phase: "checking_health" });
    expect(creating).toEqual({ phase: "creating_session" });
    expect(fetching).toEqual({ phase: "fetching_token", sessionId: "sess-1" });
    expect(credentialsReady).toEqual({
      phase: "credentials_ready",
      sessionId: "sess-1",
      token: "token-1",
      wsUrl: "wss://livekit.test",
    });
    expect(active).toEqual({
      phase: "active",
      sessionId: "sess-1",
      token: "token-1",
      wsUrl: "wss://livekit.test",
    });
    expect(ending).toEqual({ phase: "ending", sessionId: "sess-1" });
    expect(endFailed).toEqual({ phase: "end_failed", sessionId: "sess-1" });
    expect(endedWithoutSession).toEqual({ phase: "ended" });
    expect(endedWithSession).toEqual({ phase: "ended", sessionId: "sess-1" });
    expect(dispatchFailed).toEqual({ phase: "dispatch_failed", sessionId: "sess-1" });
    expect(connectionFailed).toEqual({ phase: "connection_failed", sessionId: "sess-1" });

    expect("token" in idle).toBe(false);
    expect("wsUrl" in checking).toBe(false);
    expect("sessionId" in creating).toBe(false);
    expect("token" in fetching).toBe(false);
    expect("sessionId" in endedWithoutSession).toBe(false);
  });

  it("projects legacy nullable fields while keeping terminal session ownership", () => {
    const cases: Array<[ConversationSessionState, object]> = [];
    cases.push([createIdleConversationSessionState(), { connectionState: "idle" }]);
    cases.push([
      createCheckingHealthConversationSessionState(),
      { connectionState: "checking_health" },
    ]);
    cases.push([
      createCreatingSessionConversationSessionState(),
      { connectionState: "connecting", sessionId: null, token: null, wsUrl: null },
    ]);
    cases.push([
      requireState(createFetchingTokenConversationSessionState("sess-1")),
      { connectionState: "connecting", sessionId: "sess-1", token: null, wsUrl: null },
    ]);
    cases.push([
      requireState(
        createCredentialsReadyConversationSessionState({
          sessionId: "sess-1",
          token: "token-1",
          wsUrl: "wss://livekit.test",
        }),
      ),
      {
        connectionState: "connecting",
        sessionId: "sess-1",
        token: "token-1",
        wsUrl: "wss://livekit.test",
      },
    ]);
    const credentialsReady = createCredentialsReadyConversationSessionState({
      sessionId: "sess-1",
      token: "token-1",
      wsUrl: "wss://livekit.test",
    });
    if (!credentialsReady) throw new Error("test fixture must be valid");
    cases.push([
      requireState(createActiveConversationSessionState(credentialsReady)),
      {
        connectionState: "active",
        sessionId: "sess-1",
        token: "token-1",
        wsUrl: "wss://livekit.test",
      },
    ]);
    cases.push([
      requireState(createEndingConversationSessionState("sess-1")),
      { connectionState: "ending", sessionId: "sess-1", token: null, wsUrl: null },
    ]);
    cases.push([
      requireState(createEndFailedConversationSessionState("sess-1")),
      { connectionState: "end_failed", sessionId: "sess-1", token: null, wsUrl: null },
    ]);
    cases.push([
      createEndedConversationSessionState(),
      { connectionState: "ended", sessionId: null, token: null, wsUrl: null },
    ]);
    cases.push([
      createEndedConversationSessionState("sess-1"),
      { connectionState: "ended", sessionId: "sess-1", token: null, wsUrl: null },
    ]);
    cases.push([
      createDispatchFailedConversationSessionState("sess-1"),
      { connectionState: "dispatch_failed", sessionId: "sess-1", token: null, wsUrl: null },
    ]);
    cases.push([
      createConnectionFailedConversationSessionState(),
      { connectionState: "connection_failed", sessionId: null, token: null, wsUrl: null },
    ]);

    for (const [state, expected] of cases) {
      expect(projectConversationSessionState(state)).toMatchObject(expected);
    }
  });

  it("rejects empty or missing room credentials without producing a ready phase", () => {
    for (const invalid of ["", "   ", null, undefined]) {
      expect(
        createCredentialsReadyConversationSessionState({
          sessionId: "sess-1",
          token: invalid,
          wsUrl: "wss://livekit.test",
        }),
      ).toBeNull();
      expect(
        createCredentialsReadyConversationSessionState({
          sessionId: "sess-1",
          token: "token-1",
          wsUrl: invalid,
        }),
      ).toBeNull();
      expect(
        createCredentialsReadyConversationSessionState({
          sessionId: invalid,
          token: "token-1",
          wsUrl: "wss://livekit.test",
        }),
      ).toBeNull();
    }

    const normalized = conversationSessionStateFromProjection({
      connectionState: "active",
      sessionId: "sess-1",
      token: "token-1",
      wsUrl: null,
    });
    expect(normalized).toEqual({ phase: "fetching_token", sessionId: "sess-1" });
    expect(getRoomConnection(normalized)).toBeNull();
  });

  it("normalizes legacy connecting fixtures to explicit starting phases", () => {
    expect(
      conversationSessionStateFromProjection({
        connectionState: "connecting",
        sessionId: null,
        token: null,
        wsUrl: null,
      }),
    ).toEqual({ phase: "creating_session" });
    expect(
      conversationSessionStateFromProjection({
        connectionState: "connecting",
        sessionId: "sess-1",
        token: null,
        wsUrl: null,
      }),
    ).toEqual({ phase: "fetching_token", sessionId: "sess-1" });
    expect(
      conversationSessionStateFromProjection({
        connectionState: "connecting",
        sessionId: "sess-1",
        token: "token-1",
        wsUrl: "wss://livekit.test",
      }),
    ).toMatchObject({ phase: "credentials_ready", sessionId: "sess-1" });
  });

  it("identifies only checking, create, and token-wait phases as startup", () => {
    const startupInputs: ConversationSessionProjection[] = [
      { connectionState: "checking_health", sessionId: null, token: null, wsUrl: null },
      { connectionState: "connecting", sessionId: null, token: null, wsUrl: null },
      { connectionState: "connecting", sessionId: "sess-1", token: null, wsUrl: null },
    ];
    expect(startupInputs.every(isStartingConversationSession)).toBe(true);

    const ready: ConversationSessionProjection = {
      connectionState: "connecting",
      sessionId: "sess-1",
      token: "token-1",
      wsUrl: "wss://livekit.test",
    };
    expect(isStartingConversationSession(ready)).toBe(false);
  });

  it("runs the full start, activation, and end transition matrix", () => {
    let state: ConversationSessionState = createIdleConversationSessionState();
    state = reduceConversationSession(state, { type: "begin_checking" });
    expect(state.phase).toBe("checking_health");

    state = reduceConversationSession(state, { type: "begin_connecting" });
    expect(state.phase).toBe("creating_session");
    expect(projectConversationSessionState(state)).toMatchObject({
      connectionState: "connecting",
      token: null,
    });

    state = reduceConversationSession(state, {
      type: "session_created",
      sessionId: "sess-1",
    });
    expect(state).toEqual({ phase: "fetching_token", sessionId: "sess-1" });

    state = reduceConversationSession(state, {
      type: "credentials_ready",
      sessionId: "sess-1",
      token: "token-1",
      wsUrl: "wss://livekit.test",
    });
    expect(state.phase).toBe("credentials_ready");

    state = reduceConversationSession(state, { type: "activate" });
    expect(state).toEqual({
      phase: "active",
      sessionId: "sess-1",
      token: "token-1",
      wsUrl: "wss://livekit.test",
    });

    state = reduceConversationSession(state, { type: "begin_end" });
    expect(state).toEqual({ phase: "ending", sessionId: "sess-1" });
    expect(projectConversationSessionState(state)).toMatchObject({
      token: null,
      wsUrl: null,
      sessionId: "sess-1",
    });

    state = reduceConversationSession(state, { type: "finish_end" });
    expect(state).toEqual({ phase: "ended", sessionId: "sess-1" });
  });

  it("preserves terminal session ownership and clears credentials on failures", () => {
    const ready = reduceConversationSession(
      { phase: "fetching_token", sessionId: "sess-1" },
      {
        type: "credentials_ready",
        sessionId: "sess-1",
        token: "token-1",
        wsUrl: "wss://livekit.test",
      },
    );

    const active = reduceConversationSession(ready, { type: "activate" });
    const dispatchFailed = reduceConversationSession(active, { type: "fail_dispatch" });
    expect(dispatchFailed).toEqual({ phase: "dispatch_failed", sessionId: "sess-1" });
    expect(projectConversationSessionState(dispatchFailed)).toMatchObject({
      token: null,
      wsUrl: null,
      sessionId: "sess-1",
    });

    const connecting = reduceConversationSession(
      { phase: "checking_health" },
      {
        type: "credentials_ready",
        sessionId: "sess-1",
        token: "token-1",
        wsUrl: "wss://livekit.test",
      },
    );
    const connectionFailed = reduceConversationSession(connecting, { type: "fail_connection" });
    expect(connectionFailed).toEqual({ phase: "connection_failed", sessionId: "sess-1" });

    const ending = reduceConversationSession(
      { phase: "ending", sessionId: "sess-1" },
      { type: "fail_end" },
    );
    expect(ending).toEqual({ phase: "end_failed", sessionId: "sess-1" });

    const endedWithIdentity = reduceConversationSession(
      { phase: "active", sessionId: "sess-1", token: "token-1", wsUrl: "wss://livekit.test" },
      { type: "agent_error" },
    );
    expect(endedWithIdentity).toEqual({ phase: "ended", sessionId: "sess-1" });
  });

  it("ends without a session id, preserves idempotent terminal states, and resets to idle", () => {
    const endedWithoutSession = reduceConversationSession(
      { phase: "creating_session" },
      { type: "begin_end" },
    );
    expect(endedWithoutSession).toEqual({ phase: "ended" });
    expect(projectConversationSessionState(endedWithoutSession).sessionId).toBeNull();

    expect(reduceConversationSession(endedWithoutSession, { type: "finish_end" })).toBe(
      endedWithoutSession,
    );

    expect(
      reduceConversationSession(
        {
          phase: "active",
          sessionId: "sess-1",
          token: "token-1",
          wsUrl: "wss://livekit.test",
        },
        { type: "reset" },
      ),
    ).toEqual({ phase: "idle" });
  });

  it("does not activate incomplete or terminal states", () => {
    const directActive = conversationSessionStateFromProjection({
      connectionState: "active",
      sessionId: "sess-1",
      token: null,
      wsUrl: "wss://livekit.test",
    });
    expect(directActive.phase).toBe("fetching_token");
    expect(reduceConversationSession(directActive, { type: "activate" })).toBe(directActive);

    const ended = createEndedConversationSessionState("sess-1");
    expect(reduceConversationSession(ended, { type: "activate" })).toBe(ended);
    expect(isConnectingOrActiveConversationSession(ended)).toBe(false);
  });

  it("does not mutate frozen input and returns independent instances", () => {
    const frozenProjection = Object.freeze({
      connectionState: "connecting" as const,
      sessionId: "sess-1",
      token: "token-1",
      wsUrl: "wss://livekit.test",
    });
    const before = { ...frozenProjection };
    const first = conversationSessionStateFromProjection(frozenProjection);
    const second = conversationSessionStateFromProjection(frozenProjection);

    expect(frozenProjection).toEqual(before);
    expect(first).not.toBe(second);
    expect(Reflect.set(first, "token", "changed")).toBe(true);
    expect(first).toMatchObject({ token: "changed" });
    expect(second).toMatchObject({ token: "token-1" });
  });

  it("enforces ready and active payloads at the type level", () => {
    // @ts-expect-error credentials_ready requires all three room fields
    const missingToken: CredentialsReadyConversationSessionState = {
      phase: "credentials_ready",
      sessionId: "sess-1",
      wsUrl: "wss://livekit.test",
    };

    // @ts-expect-error active requires all three room fields
    const missingUrl: ActiveConversationSessionState = {
      phase: "active",
      sessionId: "sess-1",
      token: "token-1",
    };

    // @ts-expect-error active requires a session id
    const missingSessionId: ActiveConversationSessionState = {
      phase: "active",
      token: "token-1",
      wsUrl: "wss://livekit.test",
    };

    expect(missingToken.phase).toBe("credentials_ready");
    expect(missingUrl.phase).toBe("active");
    expect(missingSessionId.phase).toBe("active");
  });
});
