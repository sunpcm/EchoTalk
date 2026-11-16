import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { User, UserManager } from "oidc-client-ts";
import App from "./App";
import { AuthGate } from "@/components/auth/AuthGate";
import {
  AtomicWebStorageStore,
  _resetAuthForTesting,
  _setOidcManagerForTesting,
  type AuthPrincipal,
} from "@/lib/auth";
import type { SessionListItem, UserSettingsResponse } from "@/lib/api";
import { getZonedWeekWindows } from "@/lib/localDayWindow";
import { clearDiagnosticBuffer } from "@/lib/diagnostics";
import { useAssessmentStore } from "@/store/assessment";
import { useAppStore } from "@/store/appStore";
import { useConversationStore } from "@/store/conversation";
import { useSettingsStore } from "@/store/settings";
import { zhCN } from "@/i18n/zh-CN";

const AUTH_ISSUER = "https://auth.echotalk.test";
const API_ORIGIN = "https://api.echotalk.test";
const API_BASE_URL = `${API_ORIGIN}/api`;
const A_TOKEN = "synthetic-a-initial-token";
const A_REFRESHED_TOKEN = "synthetic-a-refreshed-token";
const B_TOKEN = "synthetic-b-initial-token";

const A_PRINCIPAL: AuthPrincipal = { issuer: AUTH_ISSUER, subject: "identity-user-a" };
const B_PRINCIPAL: AuthPrincipal = { issuer: AUTH_ISSUER, subject: "identity-user-b" };

const A_ACTIVE_ID = "11111111-1111-4111-8111-111111111111";
const A_LATE_ACTIVE_ID = "11111111-1111-4111-8111-222222222222";
const A_DAILY_ID = "22222222-2222-4222-8222-111111111111";
const A_LATE_DAILY_ID = "22222222-2222-4222-8222-222222222222";
const A_WEEKLY_ID = "33333333-3333-4333-8333-111111111111";
const B_ACTIVE_ID = "44444444-4444-4444-8444-111111111111";
const B_DAILY_ID = "55555555-5555-4555-8555-111111111111";
const B_WEEKLY_ID = "66666666-6666-4666-8666-111111111111";

const tDashboard = zhCN.dashboard;
const tSettings = zhCN.settings;
const tActive = zhCN.activeSessions;
const tWeekly = zhCN.weeklyProgress;
const tGrammar = zhCN.weeklyGrammar;

type Actor = "A" | "B";
type ResponseVariant = "normal" | "canary" | "failure";
type UserLoadedCallback = (user: User) => void;
type RouteKind =
  | "settings"
  | "knowledge"
  | "recommendation"
  | "active"
  | "dailyProgress"
  | "dailySessions"
  | "weekly"
  | "grammar"
  | "weeklyHistory";

const CORE_ROUTES: readonly RouteKind[] = [
  "settings",
  "knowledge",
  "recommendation",
  "active",
  "dailyProgress",
  "dailySessions",
  "weekly",
  "grammar",
];

const CONSUMER_ROUTES: readonly RouteKind[] = [
  "active",
  "dailyProgress",
  "dailySessions",
  "weekly",
  "grammar",
];

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly settled: () => boolean;
}

interface RouteRecord {
  kind: RouteKind;
  actor: Actor;
  method: string;
  url: URL;
  deferred: Deferred<Response>;
}

interface OidcHarness {
  manager: UserManager;
  disposeEvents: () => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let isSettled = false;
  const promise = new Promise<T>((res) => {
    resolve = (value) => {
      isSettled = true;
      res(value);
    };
  });
  return {
    promise,
    resolve,
    settled: () => isSettled,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function readRequestUrl(input: RequestInfo | URL): URL {
  const raw =
    typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  return new URL(raw);
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

function actorFromAuthorization(headers: HeadersInit | undefined): Actor | null {
  const authorization = readHeader(headers, "Authorization");
  if (authorization === `Bearer ${A_TOKEN}` || authorization === `Bearer ${A_REFRESHED_TOKEN}`) {
    return "A";
  }
  if (authorization === `Bearer ${B_TOKEN}`) return "B";
  return null;
}

function classifyRoute(url: URL): RouteKind {
  if (url.origin !== API_ORIGIN || !url.pathname.startsWith("/api/")) {
    throw new Error(`Unexpected API origin: ${url.href}`);
  }
  const path = url.pathname.slice("/api".length);
  if (path === "/user/settings") return "settings";
  if (path === "/assessments/knowledge/states") return "knowledge";
  if (path === "/curriculum/next") return "recommendation";
  if (path === "/sessions/active") return "active";
  if (path === "/sessions/daily-progress") return "dailyProgress";
  if (path === "/sessions/weekly-progress") return "weekly";
  if (path === "/assessments/weekly-grammar") return "grammar";
  if (path === "/sessions" && url.searchParams.get("status") === "completed") {
    return url.searchParams.get("limit") === "50" ? "weeklyHistory" : "dailySessions";
  }
  throw new Error(`Unexpected request route: ${url.href}`);
}

function requiredSearchParam(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (!value) throw new Error(`Missing ${name} in ${url.href}`);
  return value;
}

function completedSession(id: string, windowStart: string): SessionListItem {
  const startedAt = new Date(Date.parse(windowStart) + 60 * 60 * 1000).toISOString();
  return {
    id,
    mode: "scenario",
    status: "completed",
    started_at: startedAt,
    ended_at: new Date(Date.parse(startedAt) + 5 * 60 * 1000).toISOString(),
  };
}

function activeSession(id: string): SessionListItem {
  return {
    id,
    mode: "scenario",
    status: "active",
    started_at: "2026-11-15T10:00:00Z",
    ended_at: null,
  };
}

function settingsBody(actor: Actor, variant: ResponseVariant = "normal"): UserSettingsResponse {
  return {
    is_custom_mode: true,
    is_custom_verified: true,
    subscription_tier: "vip",
    theme: actor === "A" ? "warm" : "cool",
    stt_provider: "deepgram",
    llm_provider: "siliconflow",
    llm_model: variant === "canary" ? "a-late-canary-model" : `${actor.toLowerCase()}-model`,
    tts_provider: "cartesia",
    has_stt_key: true,
    has_llm_key: true,
    has_tts_key: true,
    stt_status: "verified",
    llm_status: "verified",
    tts_status: "verified",
  };
}

function weeklyProgressBody(url: URL, actor: Actor) {
  const endDate = requiredSearchParam(url, "end_date");
  const timezone = requiredSearchParam(url, "timezone");
  const days = getZonedWeekWindows(endDate, timezone);
  return {
    days: days.map((day, index) => ({
      ...day,
      completed_sessions: index === 0 ? (actor === "A" ? 2 : 5) : index === days.length - 1 ? 1 : 0,
    })),
  };
}

function weeklyGrammarBody(url: URL, actor: Actor) {
  const endDate = requiredSearchParam(url, "end_date");
  const timezone = requiredSearchParam(url, "timezone");
  const days = getZonedWeekWindows(endDate, timezone);
  return {
    start: days[0].start,
    end: days[days.length - 1].end,
    total_errors: 4,
    items: [
      {
        skill_tag: actor === "A" ? "article_usage" : "preposition",
        count: 4,
      },
    ],
  };
}

function responseFor(kind: RouteKind, url: URL, actor: Actor, variant: ResponseVariant): Response {
  if (variant === "failure") {
    return jsonResponse({ detail: `${actor.toLowerCase()}-late-safe-error` }, 500);
  }

  if (kind === "settings") return jsonResponse(settingsBody(actor, variant));
  if (kind === "knowledge") return jsonResponse([]);
  if (kind === "recommendation") {
    return jsonResponse({
      recommendations: [],
      target_level: "B1",
      weakest_skill: "grammar",
      weakest_skill_mastery: 0.4,
    });
  }
  if (kind === "active") {
    const id = variant === "canary" ? A_LATE_ACTIVE_ID : actor === "A" ? A_ACTIVE_ID : B_ACTIVE_ID;
    return jsonResponse({ items: [activeSession(id)], next_cursor: null });
  }
  if (kind === "dailyProgress") {
    return jsonResponse({
      completed_sessions: variant === "canary" ? 9 : actor === "A" ? 3 : 4,
      total_turns: variant === "canary" ? 97 : actor === "A" ? 11 : 19,
    });
  }
  if (kind === "dailySessions") {
    const id = variant === "canary" ? A_LATE_DAILY_ID : actor === "A" ? A_DAILY_ID : B_DAILY_ID;
    return jsonResponse({
      items: [completedSession(id, requiredSearchParam(url, "start"))],
      next_cursor: null,
    });
  }
  if (kind === "weekly") return jsonResponse(weeklyProgressBody(url, actor));
  if (kind === "grammar") return jsonResponse(weeklyGrammarBody(url, actor));
  return jsonResponse({
    items: [
      completedSession(
        actor === "A" ? A_WEEKLY_ID : B_WEEKLY_ID,
        requiredSearchParam(url, "start"),
      ),
    ],
    next_cursor: null,
  });
}

class SyntheticFetchRouter {
  readonly records: RouteRecord[] = [];
  readonly unknownRequests: string[] = [];
  readonly fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const url = readRequestUrl(input);
    const headers = init?.headers as HeadersInit | undefined;
    const actor = actorFromAuthorization(headers);

    let kind: RouteKind;
    try {
      kind = classifyRoute(url);
    } catch (error) {
      this.unknownRequests.push(`${method} ${url.href}`);
      throw error;
    }
    if (!actor) {
      this.unknownRequests.push(`${method} ${url.href} unknown Authorization`);
      throw new Error(`Unexpected authorization for ${url.href}`);
    }
    if (method !== "GET") {
      this.unknownRequests.push(`${method} ${url.href}`);
      throw new Error(`Unexpected non-GET request: ${method} ${url.href}`);
    }

    const deferred = createDeferred<Response>();
    this.records.push({ kind, actor, method, url, deferred });
    return deferred.promise;
  });

  constructor() {
    globalThis.fetch = this.fetchMock as unknown as typeof fetch;
  }

  pending(actor: Actor, kind?: RouteKind): RouteRecord[] {
    return this.records.filter(
      (record) =>
        record.actor === actor && (!kind || record.kind === kind) && !record.deferred.settled(),
    );
  }

  count(actor: Actor, kind: RouteKind): number {
    return this.records.filter((record) => record.actor === actor && record.kind === kind).length;
  }

  release(actor: Actor, kinds: readonly RouteKind[], variant: ResponseVariant = "normal"): number {
    const pending = this.records.filter(
      (record) =>
        record.actor === actor && kinds.includes(record.kind) && !record.deferred.settled(),
    );
    for (const record of pending) {
      record.deferred.resolve(responseFor(record.kind, record.url, actor, variant));
    }
    return pending.length;
  }

  releaseEverything(actor: Actor, variant: ResponseVariant = "normal"): number {
    return this.release(actor, CORE_ROUTES.concat("weeklyHistory"), variant);
  }
}

function createMockWebStorage(): Storage {
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

function syntheticUser(subject: string, accessToken: string): User {
  const now = Math.floor(Date.now() / 1000);
  return new User({
    access_token: accessToken,
    token_type: "Bearer",
    profile: {
      iss: AUTH_ISSUER,
      sub: subject,
      aud: "echotalk-web",
      exp: now + 3600,
      iat: now - 60,
    },
  });
}

async function createOidcHarness(initialUser: User): Promise<OidcHarness> {
  const userStore = new AtomicWebStorageStore({
    prefix: "identity-test.user.",
    store: createMockWebStorage(),
  });
  const stateStore = new AtomicWebStorageStore({
    prefix: "identity-test.state.",
    store: createMockWebStorage(),
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

  const userLoadedHandlers = new Set<UserLoadedCallback>();
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

  await manager.storeUser(initialUser);
  _setOidcManagerForTesting(manager, userStore);

  return {
    manager,
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

async function waitForKind(router: SyntheticFetchRouter, actor: Actor, kind: RouteKind) {
  await waitFor(() => expect(router.pending(actor, kind).length).toBeGreaterThan(0));
}

async function waitForDashboardRequests(router: SyntheticFetchRouter, actor: Actor) {
  for (const kind of CORE_ROUTES) {
    await waitForKind(router, actor, kind);
  }
}

async function settleDashboardRequests(
  router: SyntheticFetchRouter,
  actor: Actor,
  variant: ResponseVariant = "normal",
) {
  await waitForDashboardRequests(router, actor);
  await act(async () => {
    router.release(actor, CORE_ROUTES, variant);
    await Promise.resolve();
  });
  await waitForKind(router, actor, "weeklyHistory");
  await act(async () => {
    router.release(actor, ["weeklyHistory"], variant);
    await Promise.resolve();
  });
}

async function waitForLifecycleRefresh(router: SyntheticFetchRouter, actor: Actor) {
  const before = new Map(CONSUMER_ROUTES.map((kind) => [kind, router.count(actor, kind)]));
  await act(async () => {
    setNavigatorOnline(false);
    window.dispatchEvent(new Event("offline"));
    await Promise.resolve();
    setNavigatorOnline(true);
    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
  });
  for (const kind of CONSUMER_ROUTES) {
    await waitFor(() => expect(router.count(actor, kind)).toBeGreaterThan(before.get(kind) ?? 0));
  }
}

async function openSettingsForActor(router: SyntheticFetchRouter, actor: Actor) {
  fireEvent.click(screen.getByRole("button", { name: tSettings.title }));
  await waitForKind(router, actor, "settings");
  await act(async () => {
    router.release(actor, ["settings"]);
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.getByRole("dialog", { name: tSettings.title })).toBeVisible());
  return screen.getByLabelText(tSettings.llmModel, { selector: "#llm-model-input" });
}

function expectFinalActorUi(actor: Actor) {
  const activeId = actor === "A" ? A_ACTIVE_ID : B_ACTIVE_ID;
  const dailyId = actor === "A" ? A_DAILY_ID : B_DAILY_ID;
  const weeklyId = actor === "A" ? A_WEEKLY_ID : B_WEEKLY_ID;

  expect(screen.getByTestId(`active-session-item-${activeId}`)).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: tDashboard.turnsGoal })).toHaveAttribute(
    "aria-valuetext",
    actor === "A" ? "11 / 20" : "19 / 20",
  );
  expect(screen.getByTestId(`daily-session-item-${dailyId}`)).toBeInTheDocument();
  expect(screen.getByTestId(`weekly-session-${weeklyId}`)).toBeInTheDocument();
  expect(
    screen.getByTestId(`weekly-grammar-${actor === "A" ? "article_usage" : "preposition"}`),
  ).toBeInTheDocument();
}

function expectActorDataAbsent(actor: Actor) {
  const activeId = actor === "A" ? A_ACTIVE_ID : B_ACTIVE_ID;
  const dailyId = actor === "A" ? A_DAILY_ID : B_DAILY_ID;
  const weeklyId = actor === "A" ? A_WEEKLY_ID : B_WEEKLY_ID;
  const grammarId = actor === "A" ? "article_usage" : "preposition";

  expect(screen.queryByTestId(`active-session-item-${activeId}`)).not.toBeInTheDocument();
  expect(screen.queryByTestId(`daily-session-item-${dailyId}`)).not.toBeInTheDocument();
  expect(screen.queryByTestId(`weekly-session-${weeklyId}`)).not.toBeInTheDocument();
  expect(screen.queryByTestId(`weekly-grammar-${grammarId}`)).not.toBeInTheDocument();
}

function setDocumentVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
    writable: true,
  });
}

function setNavigatorOnline(online: boolean): void {
  Object.defineProperty(navigator, "onLine", {
    value: online,
    configurable: true,
    writable: true,
  });
}

function restoreOwnProperty(
  target: object,
  property: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) Object.defineProperty(target, property, descriptor);
  else Reflect.deleteProperty(target, property);
}

describe("App identity integration", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalVisibilityDescriptor: PropertyDescriptor | undefined;
  let originalOnlineDescriptor: PropertyDescriptor | undefined;
  let originalCapacitorDescriptor: PropertyDescriptor | undefined;
  let originalMediaDevicesDescriptor: PropertyDescriptor | undefined;
  let originalShowModalDescriptor: PropertyDescriptor | undefined;
  let originalCloseDescriptor: PropertyDescriptor | undefined;
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

    originalFetch = globalThis.fetch;
    originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, "visibilityState");
    originalOnlineDescriptor = Object.getOwnPropertyDescriptor(navigator, "onLine");
    originalCapacitorDescriptor = Object.getOwnPropertyDescriptor(window, "Capacitor");
    originalMediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    originalShowModalDescriptor = Object.getOwnPropertyDescriptor(
      HTMLDialogElement.prototype,
      "showModal",
    );
    originalCloseDescriptor = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

    setDocumentVisibility("visible");
    setNavigatorOnline(true);
    Reflect.deleteProperty(window, "Capacitor");
    getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      writable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.open = true;
      }),
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      writable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.open = false;
      }),
    });
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    restoreOwnProperty(document, "visibilityState", originalVisibilityDescriptor);
    restoreOwnProperty(navigator, "onLine", originalOnlineDescriptor);
    restoreOwnProperty(window, "Capacitor", originalCapacitorDescriptor);
    restoreOwnProperty(navigator, "mediaDevices", originalMediaDevicesDescriptor);
    restoreOwnProperty(HTMLDialogElement.prototype, "showModal", originalShowModalDescriptor);
    restoreOwnProperty(HTMLDialogElement.prototype, "close", originalCloseDescriptor);
    useAppStore.getState().goHome();
    useSettingsStore.getState().reset();
    useAssessmentStore.getState().reset();
    useConversationStore.getState().reset();
    clearDiagnosticBuffer();
    _resetAuthForTesting();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("不同 principal 切换先清理旧 App 树，迟到 A 成功不覆盖 B 的四消费者与设置草稿", async () => {
    const oidc = await createOidcHarness(syntheticUser(A_PRINCIPAL.subject, A_TOKEN));
    const router = new SyntheticFetchRouter();
    let rendered: ReturnType<typeof render> | null = null;
    try {
      rendered = render(
        <AuthGate>
          <App />
        </AuthGate>,
      );
      await settleDashboardRequests(router, "A");
      expectFinalActorUi("A");

      const draftInput = await openSettingsForActor(router, "A");
      fireEvent.change(draftInput, { target: { value: "A-draft-canary" } });
      draftInput.focus();
      expect(draftInput).toHaveValue("A-draft-canary");
      expect(document.activeElement).toBe(draftInput);

      const settingsCountBeforeRefresh = router.count("A", "settings");
      act(() => {
        void useSettingsStore.getState().fetchSettings();
      });
      await waitFor(() => expect(router.pending("A", "settings").length).toBeGreaterThan(0));
      expect(router.count("A", "settings")).toBeGreaterThan(settingsCountBeforeRefresh);
      await waitForLifecycleRefresh(router, "A");

      await act(async () => {
        const userB = syntheticUser(B_PRINCIPAL.subject, B_TOKEN);
        await oidc.manager.storeUser(userB);
        await oidc.manager.events.load(userB);
        await Promise.resolve();
      });

      expect(screen.queryByRole("dialog", { name: tSettings.title })).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue("A-draft-canary")).not.toBeInTheDocument();
      await waitForDashboardRequests(router, "B");
      await settleDashboardRequests(router, "B");
      expectFinalActorUi("B");

      const bWeeklyRecord = router.records.find(
        (record) => record.actor === "B" && record.kind === "weekly",
      );
      expect(bWeeklyRecord).toBeDefined();
      const bOverviewFirstDay = getZonedWeekWindows(
        requiredSearchParam(bWeeklyRecord!.url, "end_date"),
        requiredSearchParam(bWeeklyRecord!.url, "timezone"),
      )[0];
      const bOverviewLabel = tWeekly.dayLabel
        .replace("{date}", bOverviewFirstDay.date)
        .replace("{count}", "5");
      expect(screen.getByRole("button", { name: bOverviewLabel })).toHaveAttribute(
        "aria-pressed",
        "false",
      );

      await act(async () => {
        router.release("A", CONSUMER_ROUTES.concat("settings"), "canary");
        await Promise.resolve();
      });
      expect(
        screen.queryByTestId(`active-session-item-${A_LATE_ACTIVE_ID}`),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId(`daily-session-item-${A_LATE_DAILY_ID}`)).not.toBeInTheDocument();
      expectActorDataAbsent("A");
      expect(screen.queryByText("a-late-safe-error")).not.toBeInTheDocument();
      expect(screen.queryByText("97 / 20")).not.toBeInTheDocument();

      expectFinalActorUi("B");
      expectActorDataAbsent("A");
      expect(screen.getByRole("button", { name: bOverviewLabel })).toBeInTheDocument();
      expect(useSettingsStore.getState().settings?.llm_model).toBe("b-model");

      const bSettingsInput = await openSettingsForActor(router, "B");
      expect(bSettingsInput).toHaveValue("b-model");
      expect(bSettingsInput).not.toHaveValue("A-draft-canary");
    } finally {
      rendered?.unmount();
      router.releaseEverything("A");
      router.releaseEverything("B");
      oidc.disposeEvents();
    }

    expect(router.unknownRequests).toEqual([]);
    expect(router.records.every((record) => record.method === "GET")).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("A 在途失败与 finally 在 B loading 期间迟到时，不污染 B 的 loading、错误、数据或设置", async () => {
    const oidc = await createOidcHarness(syntheticUser(A_PRINCIPAL.subject, A_TOKEN));
    const router = new SyntheticFetchRouter();
    let rendered: ReturnType<typeof render> | null = null;
    try {
      rendered = render(
        <AuthGate>
          <App />
        </AuthGate>,
      );
      await waitForDashboardRequests(router, "A");

      await act(async () => {
        const userB = syntheticUser(B_PRINCIPAL.subject, B_TOKEN);
        await oidc.manager.storeUser(userB);
        await oidc.manager.events.load(userB);
        await Promise.resolve();
      });
      await waitForDashboardRequests(router, "B");

      await act(async () => {
        router.releaseEverything("A", "failure");
        await Promise.resolve();
        await Promise.resolve();
      });

      const activeSection = screen.getByRole("heading", { name: tActive.title }).closest("section");
      const dailySection = screen.getByRole("heading", {
        name: tDashboard.dailyProgressTitle,
      }).parentElement;
      expect(activeSection).not.toBeNull();
      expect(dailySection).not.toBeNull();
      expect(within(activeSection!).getByText(tActive.loading)).toBeInTheDocument();
      expect(within(dailySection!).getByText(tDashboard.loading)).toBeInTheDocument();
      expect(
        within(screen.getByTestId("weekly-progress")).getByText(tWeekly.loading),
      ).toBeVisible();
      expect(
        within(screen.getByTestId("weekly-grammar")).getByText(tGrammar.loading),
      ).toBeVisible();
      expect(screen.queryByText("a-late-safe-error")).not.toBeInTheDocument();
      expectActorDataAbsent("A");
      expect(useSettingsStore.getState()).toMatchObject({
        settings: null,
        loading: true,
        error: null,
      });

      await settleDashboardRequests(router, "B");
      expectFinalActorUi("B");
      expectActorDataAbsent("A");
      expect(useSettingsStore.getState().error).toBeNull();
    } finally {
      rendered?.unmount();
      router.releaseEverything("A");
      router.releaseEverything("B");
      oidc.disposeEvents();
    }

    expect(router.unknownRequests).toEqual([]);
    expect(router.records.every((record) => record.method === "GET")).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("同 principal token/revision 更新保留真实 App、设置抽屉草稿焦点与用户 store", async () => {
    const oidc = await createOidcHarness(syntheticUser(A_PRINCIPAL.subject, A_TOKEN));
    const router = new SyntheticFetchRouter();
    let rendered: ReturnType<typeof render> | null = null;
    try {
      rendered = render(
        <AuthGate>
          <App />
        </AuthGate>,
      );
      await settleDashboardRequests(router, "A");

      const draftInput = await openSettingsForActor(router, "A");
      const settingsButton = screen.getByRole("button", { name: tSettings.title });
      const settingsCountBeforeRenewal = router.count("A", "settings");
      fireEvent.change(draftInput, { target: { value: "same-principal-draft" } });
      draftInput.focus();
      useConversationStore.setState({ error: "same-principal-store-marker" });

      await act(async () => {
        const refreshed = syntheticUser(A_PRINCIPAL.subject, A_REFRESHED_TOKEN);
        await oidc.manager.storeUser(refreshed);
        await oidc.manager.events.load(refreshed);
        await Promise.resolve();
      });

      expect(screen.getByRole("dialog", { name: tSettings.title })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: tSettings.title })).toBe(settingsButton);
      expect(screen.getByLabelText(tSettings.llmModel, { selector: "#llm-model-input" })).toBe(
        draftInput,
      );
      expect(draftInput).toHaveValue("same-principal-draft");
      expect(document.activeElement).toBe(draftInput);
      expect(useConversationStore.getState().error).toBe("same-principal-store-marker");
      expect(router.count("A", "settings")).toBe(settingsCountBeforeRenewal);

      for (const kind of CONSUMER_ROUTES) {
        await waitForKind(router, "A", kind);
      }
      await act(async () => {
        router.release("A", CONSUMER_ROUTES);
        await Promise.resolve();
      });
      await waitForKind(router, "A", "weeklyHistory");
      await act(async () => {
        router.release("A", ["weeklyHistory"]);
        await Promise.resolve();
      });

      expect(screen.getByRole("dialog", { name: tSettings.title })).toBeInTheDocument();
      expect(draftInput).toHaveValue("same-principal-draft");
      expect(document.activeElement).toBe(draftInput);
      expect(useConversationStore.getState().error).toBe("same-principal-store-marker");
      expectFinalActorUi("A");
    } finally {
      rendered?.unmount();
      router.releaseEverything("A");
      oidc.disposeEvents();
    }

    expect(router.unknownRequests).toEqual([]);
    expect(router.records.every((record) => record.method === "GET")).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
