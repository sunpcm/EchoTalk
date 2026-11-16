import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { User, UserManager } from "oidc-client-ts";
import App from "@/App";
import { AuthGate } from "@/components/auth/AuthGate";
import {
  AtomicWebStorageStore,
  _resetAuthForTesting,
  _setOidcManagerForTesting,
  beginLogout,
  getAuthSnapshot,
} from "@/lib/auth";
import {
  ApiError,
  getSessionDetail,
  type AnalysisStatusResponse,
  type AssessmentResponse,
  type GrammarErrorResponse,
  type KnowledgeStateResponse,
  type UserSettingsResponse,
} from "@/lib/api";
import { clearDiagnosticBuffer } from "@/lib/diagnostics";
import { useAppStore } from "@/store/appStore";
import { useAssessmentStore } from "@/store/assessment";
import { useConversationStore } from "@/store/conversation";
import { useSettingsStore } from "@/store/settings";
import { zhCN } from "@/i18n/zh-CN";

const AUTH_ISSUER = "https://auth.echotalk.test";
const API_ORIGIN = "https://api.echotalk.test";
const API_BASE_URL = `${API_ORIGIN}/api`;
const ACCESS_TOKEN = "synthetic-auth-exit-access-token";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_TOKEN = "synthetic-livekit-token";
const WS_URL = "wss://livekit.echotalk.test";
const PRINCIPAL_SUBJECT = "auth-exit-user";

const SETTINGS_SEED: UserSettingsResponse = {
  is_custom_mode: true,
  is_custom_verified: true,
  subscription_tier: "vip",
  theme: "dark",
  stt_provider: "deepgram",
  llm_provider: "siliconflow",
  llm_model: "auth-exit-model",
  tts_provider: "cartesia",
  has_stt_key: true,
  has_llm_key: true,
  has_tts_key: true,
  stt_status: "verified",
  llm_status: "verified",
  tts_status: "verified",
};

const ASSESSMENT_SEED: AssessmentResponse = {
  id: "22222222-2222-4222-8222-222222222222",
  session_id: SESSION_ID,
  overall_score: 88,
  phoneme_alignment: [],
  source: "synthetic",
  provider: null,
  model_version: null,
  is_synthetic: true,
  confidence: null,
  provider_response_ref: null,
  created_at: "2026-11-15T10:00:00Z",
};

const GRAMMAR_SEED: GrammarErrorResponse = {
  id: "33333333-3333-4333-8333-333333333333",
  session_id: SESSION_ID,
  original: "synthetic original",
  corrected: "synthetic corrected",
  error_type: "grammar",
  skill_tag: "article_usage",
  source: "synthetic",
  provider: null,
  model_version: null,
  is_synthetic: true,
  confidence: null,
  created_at: "2026-11-15T10:00:00Z",
};

const KNOWLEDGE_SEED: KnowledgeStateResponse = {
  id: "44444444-4444-4444-8444-444444444444",
  user_id: "55555555-5555-4555-8555-555555555555",
  skill_id: "article_usage",
  skill_name: "Articles",
  skill_category: "grammar",
  p_mastery: 0.72,
  updated_at: "2026-11-15T10:00:00Z",
};

const ANALYSIS_SEED: AnalysisStatusResponse = {
  attempt_count: 1,
  error_code: null,
  finished_at: null,
  retryable: true,
  session_id: SESSION_ID,
  started_at: "2026-11-15T10:00:00Z",
  status: "running",
  updated_at: "2026-11-15T10:00:05Z",
};

const liveKitMock = vi.hoisted(() => {
  const track = {
    state: "live" as "live" | "ended",
    stop: vi.fn(),
  };
  track.stop.mockImplementation(() => {
    track.state = "ended";
  });
  const room = {
    objectId: "auth-exit-room",
    localParticipant: {
      trackPublications: new Map([
        [
          "auth-exit-microphone-publication",
          {
            track,
          },
        ],
      ]),
    },
  };
  return {
    room,
    track,
    roomRenderCount: 0,
    roomMountCount: 0,
    roomUnmountCount: 0,
    reset() {
      track.state = "live";
      track.stop.mockClear();
      this.roomRenderCount = 0;
      this.roomMountCount = 0;
      this.roomUnmountCount = 0;
    },
  };
});

vi.mock("@livekit/components-react", () => {
  const RoomContext = React.createContext(liveKitMock.room);
  const emptySegments: never[] = [];
  const voiceAssistant = {
    state: "listening" as const,
    audioTrack: { publication: { track: {} } },
    agentTranscriptions: emptySegments,
  };
  const localParticipant = liveKitMock.room.localParticipant;

  return {
    LiveKitRoom: ({ children }: { children: React.ReactNode }) => {
      liveKitMock.roomRenderCount += 1;
      React.useEffect(() => {
        liveKitMock.roomMountCount += 1;
        return () => {
          liveKitMock.roomUnmountCount += 1;
        };
      }, []);
      return (
        <RoomContext.Provider value={liveKitMock.room}>
          <div data-testid="auth-exit-livekit-room">{children}</div>
        </RoomContext.Provider>
      );
    },
    useRoomContext: () => React.useContext(RoomContext),
    useConnectionState: () => "connected",
    useVoiceAssistant: () => voiceAssistant,
    useLocalParticipant: () => ({
      localParticipant,
      microphoneTrack: undefined,
    }),
    useTrackTranscription: () => ({ segments: emptySegments }),
    useDataChannel: () => undefined,
    BarVisualizer: () => <div data-testid="auth-exit-visualizer" />,
    RoomAudioRenderer: () => <div data-testid="auth-exit-room-audio" />,
    VoiceAssistantControlBar: () => null,
  };
});

interface RequestRecord {
  readonly method: string;
  readonly path: string;
  readonly url: URL;
}

interface FetchAttempt {
  readonly method: string;
  readonly input: string;
  path: string | null;
  rejection: string | null;
}

class SyntheticApi {
  readonly records: RequestRecord[] = [];
  readonly attempts: FetchAttempt[] = [];
  settingsRequests = 0;
  sessionDetailRequests = 0;

  readonly fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    const method = (init?.method ?? "GET").toUpperCase();
    const attempt: FetchAttempt = {
      method,
      input: raw,
      path: null,
      rejection: null,
    };
    this.attempts.push(attempt);
    const reject = (reason: string): never => {
      attempt.rejection = reason;
      throw new Error(reason);
    };

    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return reject(`Invalid synthetic API URL: ${raw}`);
    }
    attempt.path = url.pathname;

    if (url.origin !== API_ORIGIN || !url.pathname.startsWith("/api/")) {
      return reject(`Unexpected synthetic API URL: ${url.href}`);
    }

    const authorization = readHeader(init?.headers, "Authorization");
    if (authorization !== `Bearer ${ACCESS_TOKEN}`) {
      return reject(`Unexpected authorization for ${method} ${url.href}`);
    }

    if (method === "GET" && url.pathname === "/api/user/settings") {
      this.records.push({ method, path: url.pathname, url });
      this.settingsRequests += 1;
      return Promise.resolve(jsonResponse(SETTINGS_SEED));
    }

    if (method === "GET" && url.pathname === `/api/sessions/${SESSION_ID}`) {
      this.records.push({ method, path: url.pathname, url });
      this.sessionDetailRequests += 1;
      return Promise.resolve(jsonResponse({ detail: "synthetic unauthorized" }, 401));
    }

    return reject(`Unexpected synthetic request: ${method} ${url.href}`);
  });

  constructor() {
    globalThis.fetch = this.fetchMock as unknown as typeof fetch;
  }
}

interface OidcHarness {
  readonly manager: UserManager;
  readonly signoutRedirect: ReturnType<typeof vi.fn>;
  readonly disposeEvents: () => void;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function readHeader(headers: HeadersInit | undefined, name: string): string | null {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return found?.[1] ?? null;
  }
  const key = Object.keys(headers).find((entry) => entry.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length(): number {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

function syntheticUser(): User {
  const now = Math.floor(Date.now() / 1000);
  return new User({
    access_token: ACCESS_TOKEN,
    token_type: "Bearer",
    profile: {
      iss: AUTH_ISSUER,
      sub: PRINCIPAL_SUBJECT,
      aud: "echotalk-web",
      exp: now + 3600,
      iat: now - 60,
    },
  });
}

async function createOidcHarness(): Promise<OidcHarness> {
  const userStore = new AtomicWebStorageStore({
    prefix: "auth-exit.user.",
    store: createMemoryStorage(),
  });
  const stateStore = new AtomicWebStorageStore({
    prefix: "auth-exit.state.",
    store: createMemoryStorage(),
  });
  const manager = new UserManager({
    authority: AUTH_ISSUER,
    client_id: "echotalk-web",
    redirect_uri: "https://app.echotalk.test/callback",
    response_type: "code",
    scope: "openid profile email",
    userStore,
    stateStore,
    loadUserInfo: false,
    metadata: {
      issuer: AUTH_ISSUER,
      authorization_endpoint: `${AUTH_ISSUER}/authorize`,
      token_endpoint: `${AUTH_ISSUER}/oauth/token`,
    },
    automaticSilentRenew: false,
    monitorSession: false,
  });

  const userLoadedHandlers = new Set<(user: User) => void>();
  const userUnloadedHandlers = new Set<() => void>();
  const accessTokenExpiredHandlers = new Set<() => void>();
  const addUserLoaded = manager.events.addUserLoaded.bind(manager.events);
  const addUserUnloaded = manager.events.addUserUnloaded.bind(manager.events);
  const addAccessTokenExpired = manager.events.addAccessTokenExpired.bind(manager.events);
  const removeUserLoaded = manager.events.removeUserLoaded.bind(manager.events);
  const removeUserUnloaded = manager.events.removeUserUnloaded.bind(manager.events);
  const removeAccessTokenExpired = manager.events.removeAccessTokenExpired.bind(manager.events);

  vi.spyOn(manager.events, "addUserLoaded").mockImplementation((callback) => {
    userLoadedHandlers.add(callback);
    return addUserLoaded(callback);
  });
  vi.spyOn(manager.events, "addUserUnloaded").mockImplementation((callback) => {
    userUnloadedHandlers.add(callback);
    return addUserUnloaded(callback);
  });
  vi.spyOn(manager.events, "addAccessTokenExpired").mockImplementation((callback) => {
    accessTokenExpiredHandlers.add(callback);
    return addAccessTokenExpired(callback);
  });

  await manager.storeUser(syntheticUser());
  _setOidcManagerForTesting(manager, userStore);
  const signoutRedirect = vi.spyOn(manager, "signoutRedirect").mockResolvedValue(undefined);

  return {
    manager,
    signoutRedirect,
    disposeEvents: () => {
      for (const callback of userLoadedHandlers) removeUserLoaded(callback);
      for (const callback of userUnloadedHandlers) removeUserUnloaded(callback);
      for (const callback of accessTokenExpiredHandlers) removeAccessTokenExpired(callback);
      userLoadedHandlers.clear();
      userUnloadedHandlers.clear();
      accessTokenExpiredHandlers.clear();
    },
  };
}

function seedUserStores(): void {
  useSettingsStore.setState({
    settings: SETTINGS_SEED,
    loading: false,
    saving: false,
    error: "private-settings-error",
    theme: "dark",
  });
  useAssessmentStore.setState({
    loadState: "running",
    assessment: ASSESSMENT_SEED,
    grammarErrors: [GRAMMAR_SEED],
    knowledgeStates: [KNOWLEDGE_SEED],
    error: "private-assessment-error",
    job: ANALYSIS_SEED,
    pollVersion: 7,
  });
}

function seedActiveRoom(): void {
  useAppStore.setState({
    appView: "session",
    sessionGen: 41,
    connectionState: "active",
    sessionId: SESSION_ID,
    token: SESSION_TOKEN,
    wsUrl: WS_URL,
    sessionPresentation: {
      sessionId: SESSION_ID,
      sessionGen: 41,
      startedAt: "2026-11-15T10:00:00Z",
      mode: "free_talk",
      scenarioName: null,
    },
  });
}

function assertPrivateSessionPresent(): void {
  expect(screen.getByTestId("app-private-boundary")).toBeInTheDocument();
  expect(screen.getByTestId("auth-exit-livekit-room")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: zhCN.conversation.endButton })).toBeInTheDocument();
  expect(useSettingsStore.getState().settings).toEqual(SETTINGS_SEED);
  expect(useAssessmentStore.getState().assessment).toEqual(ASSESSMENT_SEED);
  expect(liveKitMock.roomMountCount).toBe(1);
  expect(liveKitMock.roomUnmountCount).toBe(0);
  expect(liveKitMock.track.state).toBe("live");
  expect(liveKitMock.track.stop).not.toHaveBeenCalled();
}

function assertFinalCleanup(
  trigger: "logout" | "unauthorized",
  sessionGenBeforeExit: number,
  router: SyntheticApi,
  oidc: OidcHarness,
  requestError: unknown,
): void {
  expect(screen.queryByTestId("app-private-boundary")).not.toBeInTheDocument();
  expect(screen.queryByTestId("auth-exit-livekit-room")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: zhCN.conversation.endButton }),
  ).not.toBeInTheDocument();
  expect(liveKitMock.roomMountCount).toBe(1);
  expect(liveKitMock.roomUnmountCount).toBe(1);
  expect(screen.getByText(zhCN.auth.loginRequired)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: zhCN.auth.login })).toBeInTheDocument();
  expect(getAuthSnapshot()).toEqual({ state: "anonymous", principal: null });

  expect(liveKitMock.track.state).toBe("ended");
  expect(liveKitMock.track.stop).toHaveBeenCalled();

  const conversation = useAppStore.getState();
  expect(conversation.appView).toBe("dashboard");
  expect(conversation.connectionState).toBe("idle");
  expect(conversation._sessionState.phase).toBe("idle");
  expect(conversation.sessionId).toBeNull();
  expect(conversation.token).toBeNull();
  expect(conversation.wsUrl).toBeNull();
  expect(conversation.sessionPresentation).toBeNull();
  expect(conversation.sessionGen).toBeGreaterThan(sessionGenBeforeExit);

  expect(useSettingsStore.getState()).toMatchObject({
    settings: null,
    loading: false,
    saving: false,
    error: null,
  });
  expect(useAssessmentStore.getState()).toMatchObject({
    loadState: "idle",
    assessment: null,
    grammarErrors: [],
    knowledgeStates: [],
    error: null,
    job: null,
    pollVersion: 0,
  });

  expect(router.settingsRequests).toBe(1);
  expect(router.attempts.filter((attempt) => attempt.rejection !== null)).toEqual([]);
  expect(router.attempts).toHaveLength(router.records.length);
  expect(router.records.every((record) => record.method === "GET")).toBe(true);
  expect(
    router.records.some((record) =>
      [
        `/api/sessions/${SESSION_ID}/end`,
        `/api/sessions/${SESSION_ID}/token`,
        `/api/sessions/${SESSION_ID}/dispatch`,
      ].includes(record.path),
    ),
  ).toBe(false);

  if (trigger === "logout") {
    expect(router.sessionDetailRequests).toBe(0);
    expect(oidc.signoutRedirect).toHaveBeenCalledTimes(1);
  } else {
    expect(router.sessionDetailRequests).toBe(1);
    expect(requestError).toBeInstanceOf(ApiError);
    expect((requestError as ApiError).status).toBe(401);
    expect(oidc.signoutRedirect).not.toHaveBeenCalled();
  }
}

function authGateAppTree(): React.ReactElement {
  return (
    <AuthGate>
      <div data-testid="app-private-boundary">
        <App />
      </div>
    </AuthGate>
  );
}

describe("AuthGate active Room exit integration", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalVisibilityDescriptor: PropertyDescriptor | undefined;
  let originalOnlineDescriptor: PropertyDescriptor | undefined;
  let originalCapacitorDescriptor: PropertyDescriptor | undefined;
  let originalTauriDescriptor: PropertyDescriptor | undefined;
  let originalMediaDevicesDescriptor: PropertyDescriptor | undefined;
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_API_BASE_URL", API_BASE_URL);
    _resetAuthForTesting();
    useAppStore.getState().goHome();
    useSettingsStore.getState().reset();
    useAssessmentStore.getState().reset();
    useConversationStore.getState().reset();
    clearDiagnosticBuffer();
    liveKitMock.reset();

    originalFetch = globalThis.fetch;
    originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    originalOnlineDescriptor = Object.getOwnPropertyDescriptor(navigator, "onLine");
    originalCapacitorDescriptor = Object.getOwnPropertyDescriptor(window, "Capacitor");
    originalTauriDescriptor = Object.getOwnPropertyDescriptor(window, "__TAURI_INTERNALS__");
    originalMediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, "onLine", {
      value: true,
      configurable: true,
      writable: true,
    });
    Reflect.deleteProperty(window, "Capacitor");
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    restoreOwnProperty(document, "visibilityState", originalVisibilityDescriptor);
    restoreOwnProperty(navigator, "onLine", originalOnlineDescriptor);
    restoreOwnProperty(window, "Capacitor", originalCapacitorDescriptor);
    restoreOwnProperty(window, "__TAURI_INTERNALS__", originalTauriDescriptor);
    restoreOwnProperty(navigator, "mediaDevices", originalMediaDevicesDescriptor);
    useAppStore.getState().goHome();
    useSettingsStore.getState().reset();
    useAssessmentStore.getState().reset();
    useConversationStore.getState().reset();
    clearDiagnosticBuffer();
    _resetAuthForTesting();
    vi.restoreAllMocks();
    liveKitMock.reset();
    vi.unstubAllEnvs();
  });

  it.each(["logout", "unauthorized"] as const)(
    "cleans the active Room, owned tracks, and user stores on %s",
    async (trigger) => {
      const router = new SyntheticApi();
      const oidc = await createOidcHarness();
      seedUserStores();
      seedActiveRoom();
      let rendered: ReturnType<typeof render> | null = null;
      let requestError: unknown = null;

      try {
        const renderedApp = render(authGateAppTree());
        rendered = renderedApp;

        await waitFor(() => expect(router.settingsRequests).toBe(1));
        await waitFor(() =>
          expect(useSettingsStore.getState()).toMatchObject({
            settings: SETTINGS_SEED,
            loading: false,
          }),
        );
        await waitFor(() => expect(screen.getByTestId("auth-exit-livekit-room")).toBeVisible());
        assertPrivateSessionPresent();

        const requestCountBeforeRerender = router.attempts.length;
        const renderCountBeforeRerender = liveKitMock.roomRenderCount;
        const roomBeforeRerender = liveKitMock.room;
        const trackBeforeRerender = liveKitMock.track;
        await act(async () => {
          renderedApp.rerender(authGateAppTree());
          await Promise.resolve();
        });
        expect(liveKitMock.roomRenderCount).toBeGreaterThan(renderCountBeforeRerender);
        expect(liveKitMock.room).toBe(roomBeforeRerender);
        expect(liveKitMock.track).toBe(trackBeforeRerender);
        assertPrivateSessionPresent();
        expect(router.attempts).toHaveLength(requestCountBeforeRerender);

        const sessionGenBeforeExit = useConversationStore.getState().sessionGen;
        const requestCountBeforeExit = router.attempts.length;

        await act(async () => {
          if (trigger === "logout") {
            await beginLogout();
          } else {
            try {
              await getSessionDetail(SESSION_ID);
            } catch (error) {
              requestError = error;
            }
          }
          await Promise.resolve();
        });

        await waitFor(() =>
          expect(screen.queryByTestId("auth-exit-livekit-room")).not.toBeInTheDocument(),
        );
        await act(async () => {
          await Promise.resolve();
        });

        assertFinalCleanup(trigger, sessionGenBeforeExit, router, oidc, requestError);
        expect(router.attempts).toHaveLength(
          trigger === "logout" ? requestCountBeforeExit : requestCountBeforeExit + 1,
        );
        expect(getUserMedia).not.toHaveBeenCalled();
      } finally {
        rendered?.unmount();
        oidc.disposeEvents();
      }
    },
  );
});

function restoreOwnProperty(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) Object.defineProperty(target, property, descriptor);
  else Reflect.deleteProperty(target, property);
}
