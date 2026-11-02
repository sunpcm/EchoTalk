/**
 * Conversation session state model.
 *
 * The existing store exposes flat nullable fields for compatibility. Internally,
 * transitions operate on the discriminated union in this module and then project
 * the resulting model back to the flat shape in one Zustand update.
 */

export type ConnectionState =
  | "idle"
  | "checking_health"
  | "connecting"
  | "active"
  | "ending"
  | "end_failed"
  | "ended"
  | "dispatch_failed"
  | "connection_failed";

export interface ConversationSessionProjection {
  readonly connectionState: ConnectionState;
  readonly sessionId: string | null;
  readonly token: string | null;
  readonly wsUrl: string | null;
}

export interface RoomConnection {
  readonly sessionId: string;
  readonly token: string;
  readonly wsUrl: string;
}

export interface IdleConversationSessionState {
  readonly phase: "idle";
}

export interface CheckingHealthConversationSessionState {
  readonly phase: "checking_health";
}

export interface CreatingSessionConversationSessionState {
  readonly phase: "creating_session";
}

export interface FetchingTokenConversationSessionState {
  readonly phase: "fetching_token";
  readonly sessionId: string;
}

export interface CredentialsReadyConversationSessionState extends RoomConnection {
  readonly phase: "credentials_ready";
}

export interface ActiveConversationSessionState extends RoomConnection {
  readonly phase: "active";
}

export interface EndingConversationSessionState {
  readonly phase: "ending";
  readonly sessionId: string;
}

export interface EndFailedConversationSessionState {
  readonly phase: "end_failed";
  readonly sessionId: string;
}

export interface EndedConversationSessionState {
  readonly phase: "ended";
  readonly sessionId?: string;
}

export interface DispatchFailedConversationSessionState {
  readonly phase: "dispatch_failed";
  readonly sessionId?: string;
}

export interface ConnectionFailedConversationSessionState {
  readonly phase: "connection_failed";
  readonly sessionId?: string;
}

export type ConversationSessionState =
  | IdleConversationSessionState
  | CheckingHealthConversationSessionState
  | CreatingSessionConversationSessionState
  | FetchingTokenConversationSessionState
  | CredentialsReadyConversationSessionState
  | ActiveConversationSessionState
  | EndingConversationSessionState
  | EndFailedConversationSessionState
  | EndedConversationSessionState
  | DispatchFailedConversationSessionState
  | ConnectionFailedConversationSessionState;

export type RoomSessionState =
  | CredentialsReadyConversationSessionState
  | ActiveConversationSessionState;

type SessionStateInput =
  | ConversationSessionState
  | ConversationSessionProjection
  | { readonly _sessionState: ConversationSessionState };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isRoomConnection(value: {
  sessionId: unknown;
  token: unknown;
  wsUrl: unknown;
}): value is RoomConnection {
  return (
    isNonEmptyString(value.sessionId) &&
    isNonEmptyString(value.token) &&
    isNonEmptyString(value.wsUrl)
  );
}

export function createIdleConversationSessionState(): IdleConversationSessionState {
  return { phase: "idle" };
}

export function createCheckingHealthConversationSessionState(): CheckingHealthConversationSessionState {
  return { phase: "checking_health" };
}

export function createCreatingSessionConversationSessionState(): CreatingSessionConversationSessionState {
  return { phase: "creating_session" };
}

export function createFetchingTokenConversationSessionState(
  sessionId: unknown,
): FetchingTokenConversationSessionState | null {
  if (!isNonEmptyString(sessionId)) return null;
  return { phase: "fetching_token", sessionId };
}

export function createCredentialsReadyConversationSessionState(input: {
  sessionId: unknown;
  token: unknown;
  wsUrl: unknown;
}): CredentialsReadyConversationSessionState | null {
  if (!isRoomConnection(input)) return null;
  return {
    phase: "credentials_ready",
    sessionId: input.sessionId,
    token: input.token,
    wsUrl: input.wsUrl,
  };
}

export function createActiveConversationSessionState(input: {
  sessionId: unknown;
  token: unknown;
  wsUrl: unknown;
}): ActiveConversationSessionState | null {
  if (!isRoomConnection(input)) return null;
  return {
    phase: "active",
    sessionId: input.sessionId,
    token: input.token,
    wsUrl: input.wsUrl,
  };
}

export function createEndingConversationSessionState(
  sessionId: unknown,
): EndingConversationSessionState | null {
  if (!isNonEmptyString(sessionId)) return null;
  return { phase: "ending", sessionId };
}

export function createEndFailedConversationSessionState(
  sessionId: unknown,
): EndFailedConversationSessionState | null {
  if (!isNonEmptyString(sessionId)) return null;
  return { phase: "end_failed", sessionId };
}

export function createEndedConversationSessionState(
  sessionId?: string | null,
): EndedConversationSessionState {
  return isNonEmptyString(sessionId) ? { phase: "ended", sessionId } : { phase: "ended" };
}

export function createDispatchFailedConversationSessionState(
  sessionId?: string | null,
): DispatchFailedConversationSessionState {
  return isNonEmptyString(sessionId)
    ? { phase: "dispatch_failed", sessionId }
    : { phase: "dispatch_failed" };
}

export function createConnectionFailedConversationSessionState(
  sessionId?: string | null,
): ConnectionFailedConversationSessionState {
  return isNonEmptyString(sessionId)
    ? { phase: "connection_failed", sessionId }
    : { phase: "connection_failed" };
}

/**
 * Normalizes legacy flat fixtures without ever promoting incomplete credentials
 * to a room-ready phase.
 */
export function conversationSessionStateFromProjection(
  projection: ConversationSessionProjection,
): ConversationSessionState {
  switch (projection.connectionState) {
    case "idle":
      return createIdleConversationSessionState();
    case "checking_health":
      return createCheckingHealthConversationSessionState();
    case "connecting":
      if (isRoomConnection(projection)) {
        return {
          phase: "credentials_ready",
          sessionId: projection.sessionId,
          token: projection.token,
          wsUrl: projection.wsUrl,
        };
      }
      return isNonEmptyString(projection.sessionId)
        ? { phase: "fetching_token", sessionId: projection.sessionId }
        : createCreatingSessionConversationSessionState();
    case "active": {
      const active = isRoomConnection(projection)
        ? createActiveConversationSessionState(projection)
        : null;
      if (active) return active;
      return isNonEmptyString(projection.sessionId)
        ? { phase: "fetching_token", sessionId: projection.sessionId }
        : createCreatingSessionConversationSessionState();
    }
    case "ending":
      return isNonEmptyString(projection.sessionId)
        ? { phase: "ending", sessionId: projection.sessionId }
        : createEndedConversationSessionState();
    case "end_failed":
      return isNonEmptyString(projection.sessionId)
        ? { phase: "end_failed", sessionId: projection.sessionId }
        : createEndedConversationSessionState();
    case "ended":
      return createEndedConversationSessionState(projection.sessionId);
    case "dispatch_failed":
      return createDispatchFailedConversationSessionState(projection.sessionId);
    case "connection_failed":
      return createConnectionFailedConversationSessionState(projection.sessionId);
  }
}

export function projectConversationSessionState(
  state: ConversationSessionState,
): ConversationSessionProjection {
  switch (state.phase) {
    case "idle":
      return {
        connectionState: "idle",
        sessionId: null,
        token: null,
        wsUrl: null,
      };
    case "checking_health":
      return {
        connectionState: "checking_health",
        sessionId: null,
        token: null,
        wsUrl: null,
      };
    case "creating_session":
      return {
        connectionState: "connecting",
        sessionId: null,
        token: null,
        wsUrl: null,
      };
    case "fetching_token":
      return {
        connectionState: "connecting",
        sessionId: state.sessionId,
        token: null,
        wsUrl: null,
      };
    case "credentials_ready":
      return {
        connectionState: "connecting",
        sessionId: state.sessionId,
        token: state.token,
        wsUrl: state.wsUrl,
      };
    case "active":
      return {
        connectionState: "active",
        sessionId: state.sessionId,
        token: state.token,
        wsUrl: state.wsUrl,
      };
    case "ending":
      return {
        connectionState: "ending",
        sessionId: state.sessionId,
        token: null,
        wsUrl: null,
      };
    case "end_failed":
      return {
        connectionState: "end_failed",
        sessionId: state.sessionId,
        token: null,
        wsUrl: null,
      };
    case "ended":
      return {
        connectionState: "ended",
        sessionId: state.sessionId ?? null,
        token: null,
        wsUrl: null,
      };
    case "dispatch_failed":
      return {
        connectionState: "dispatch_failed",
        sessionId: state.sessionId ?? null,
        token: null,
        wsUrl: null,
      };
    case "connection_failed":
      return {
        connectionState: "connection_failed",
        sessionId: state.sessionId ?? null,
        token: null,
        wsUrl: null,
      };
  }
}

function asConversationSessionState(input: SessionStateInput): ConversationSessionState {
  if ("_sessionState" in input) return input._sessionState;
  return "phase" in input ? input : conversationSessionStateFromProjection(input);
}

export function canStartConversationSession(input: SessionStateInput): boolean {
  return asConversationSessionState(input).phase === "idle";
}

export function isStartingConversationSession(input: SessionStateInput): boolean {
  const state = asConversationSessionState(input);
  return (
    state.phase === "checking_health" ||
    state.phase === "creating_session" ||
    state.phase === "fetching_token"
  );
}

export function isRoomSessionState(state: ConversationSessionState): state is RoomSessionState {
  return state.phase === "credentials_ready" || state.phase === "active";
}

export function getRoomConnection(input: SessionStateInput): RoomConnection | null {
  const state = asConversationSessionState(input);
  if (!isRoomSessionState(state)) return null;
  return {
    sessionId: state.sessionId,
    token: state.token,
    wsUrl: state.wsUrl,
  };
}

export function hasRoomConnection(input: SessionStateInput): boolean {
  return getRoomConnection(input) !== null;
}

function sessionIdOf(state: ConversationSessionState): string | null {
  switch (state.phase) {
    case "fetching_token":
    case "credentials_ready":
    case "active":
    case "ending":
    case "end_failed":
      return state.sessionId;
    case "ended":
    case "dispatch_failed":
    case "connection_failed":
      return state.sessionId ?? null;
    case "idle":
    case "checking_health":
    case "creating_session":
      return null;
  }
}

export function isConnectingOrActiveConversationSession(state: ConversationSessionState): boolean {
  return (
    state.phase === "creating_session" ||
    state.phase === "fetching_token" ||
    state.phase === "credentials_ready" ||
    state.phase === "active"
  );
}

export type ConversationSessionEvent =
  | { readonly type: "begin_checking" }
  | { readonly type: "begin_connecting" }
  | { readonly type: "session_created"; readonly sessionId: string }
  | {
      readonly type: "credentials_ready";
      readonly sessionId: string;
      readonly token: string;
      readonly wsUrl: string;
    }
  | { readonly type: "activate" }
  | { readonly type: "fail_dispatch" }
  | { readonly type: "fail_connection" }
  | { readonly type: "begin_end" }
  | { readonly type: "finish_end" }
  | { readonly type: "fail_end" }
  | { readonly type: "agent_error" }
  | { readonly type: "reset" };

export function reduceConversationSession(
  state: ConversationSessionState,
  event: ConversationSessionEvent,
): ConversationSessionState {
  switch (event.type) {
    case "begin_checking":
      return state.phase === "idle" ? createCheckingHealthConversationSessionState() : state;
    case "begin_connecting":
      return state.phase === "checking_health"
        ? createCreatingSessionConversationSessionState()
        : state;
    case "session_created":
      return state.phase === "creating_session"
        ? (createFetchingTokenConversationSessionState(event.sessionId) ?? state)
        : state;
    case "credentials_ready": {
      if (
        state.phase !== "checking_health" &&
        state.phase !== "creating_session" &&
        state.phase !== "fetching_token"
      ) {
        return state;
      }
      return (
        createCredentialsReadyConversationSessionState({
          sessionId: event.sessionId,
          token: event.token,
          wsUrl: event.wsUrl,
        }) ?? state
      );
    }
    case "activate":
      return state.phase === "credentials_ready"
        ? (createActiveConversationSessionState(state) ?? state)
        : state;
    case "fail_dispatch":
      return isConnectingOrActiveConversationSession(state)
        ? createDispatchFailedConversationSessionState(sessionIdOf(state))
        : state;
    case "fail_connection":
      return isConnectingOrActiveConversationSession(state)
        ? createConnectionFailedConversationSessionState(sessionIdOf(state))
        : state;
    case "begin_end": {
      if (state.phase === "idle" || state.phase === "ended" || state.phase === "ending") {
        return state;
      }
      const sessionId = sessionIdOf(state);
      return sessionId
        ? (createEndingConversationSessionState(sessionId) ?? state)
        : createEndedConversationSessionState();
    }
    case "finish_end":
      return state.phase === "ending"
        ? createEndedConversationSessionState(state.sessionId)
        : state;
    case "fail_end":
      return state.phase === "ending"
        ? (createEndFailedConversationSessionState(state.sessionId) ?? state)
        : state;
    case "agent_error":
      return createEndedConversationSessionState(sessionIdOf(state));
    case "reset":
      return createIdleConversationSessionState();
  }
}
