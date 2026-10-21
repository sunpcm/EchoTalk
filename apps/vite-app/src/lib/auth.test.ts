import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  getAccessToken,
  setAccessTokenProvider,
  arePrincipalsEqual,
  getPrincipalKey,
  extractPrincipalFromUser,
  getAuthSnapshot,
  getAuthRevision,
  invalidateAuthSession,
  initializeAuthSnapshot,
  DEV_PRINCIPAL,
  AtomicWebStorageStore,
  _resetAuthForTesting,
  _setOidcManagerForTesting,
  type AuthPrincipal,
} from "./auth";
import { OidcClient, User, UserManager } from "oidc-client-ts";

function createMockWebStorage(): { storage: Storage; data: Map<string, string> } {
  const data = new Map<string, string>();
  const storage: Storage = {
    get length(): number {
      return data.size;
    },
    clear: vi.fn(() => {
      data.clear();
    }),
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    key: vi.fn((index: number) => Array.from(data.keys())[index] ?? null),
    removeItem: vi.fn((k: string) => {
      data.delete(k);
    }),
    setItem: vi.fn((k: string, v: string) => {
      data.set(k, v);
    }),
  };
  return { storage, data };
}

function createSyntheticIdToken(sub: string, iss = "https://auth.example.com"): string {
  const toBase64Url = (obj: Record<string, unknown>): string =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url({ alg: "RS256", typ: "JWT" });
  const payload = toBase64Url({
    iss,
    sub,
    aud: "echotalk-web",
    exp: now + 3600,
    iat: now - 60,
  });
  return `${header}.${payload}.synthetic-signature`;
}

function createRealTestOidcEnv() {
  const userStorage = createMockWebStorage();
  const stateStorage = createMockWebStorage();

  const userStore = new AtomicWebStorageStore({
    prefix: "oidc.",
    store: userStorage.storage,
    getRevision: getAuthRevision,
  });
  const stateStore = new AtomicWebStorageStore({
    prefix: "oidc.state.",
    store: stateStorage.storage,
  });

  const globalManager = new UserManager({
    authority: "https://auth.example.com",
    client_id: "echotalk-web",
    redirect_uri: "https://app.example.com/callback",
    response_type: "code",
    scope: "openid profile email",
    userStore,
    stateStore,
    loadUserInfo: false,
    metadata: {
      issuer: "https://auth.example.com",
      authorization_endpoint: "https://auth.example.com/authorize",
      token_endpoint: "https://auth.example.com/oauth/token",
    },
    automaticSilentRenew: false,
    monitorSession: false,
  });

  return { globalManager, userStore, stateStore, userStorage, stateStorage };
}

async function prepareSigninState(manager: UserManager): Promise<string> {
  const client = new OidcClient(manager.settings);
  const req = await client.createSigninRequest({});
  const state = new URL(req.url).searchParams.get("state");
  if (!state) {
    throw new Error("Expected state parameter in signin request URL");
  }
  return state;
}

function createTokenResponse(sub: string, accessToken: string): Response {
  return new Response(
    JSON.stringify({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      id_token: createSyntheticIdToken(sub),
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

describe("Auth token provider & snapshot lifecycle", () => {
  const originalFetch = globalThis.fetch;
  const originalHref = window.location.href;

  beforeEach(() => {
    _resetAuthForTesting();
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    window.history.replaceState({}, "", originalHref);
    vi.restoreAllMocks();
  });

  it("reflects login and logout state without a fixed production token", async () => {
    let token: string | null = "signed-in-token";
    const restore = setAccessTokenProvider(() => token);

    expect(await getAccessToken()).toBe("signed-in-token");
    token = null;
    expect(await getAccessToken()).toBeNull();

    restore();
  });

  describe("Principal verification and key generation", () => {
    it("compares principals accurately", () => {
      expect(DEV_PRINCIPAL.issuer).toBe("urn:echotalk:auth:dev");
      expect(typeof initializeAuthSnapshot).toBe("function");
      const p1: AuthPrincipal = { issuer: "https://auth.example.com", subject: "user-123" };
      const p2: AuthPrincipal = { issuer: "https://auth.example.com", subject: "user-123" };
      const p3: AuthPrincipal = { issuer: "https://auth.example.com", subject: "user-456" };
      const p4: AuthPrincipal = { issuer: "https://other.example.com", subject: "user-123" };

      expect(arePrincipalsEqual(p1, p2)).toBe(true);
      expect(arePrincipalsEqual(p1, p3)).toBe(false);
      expect(arePrincipalsEqual(p1, p4)).toBe(false);
      expect(arePrincipalsEqual(p1, null)).toBe(false);
      expect(arePrincipalsEqual(null, null)).toBe(true);
    });

    it("encodes principal key as JSON array without ambiguous delimiter collision", () => {
      const p1: AuthPrincipal = { issuer: "auth:a", subject: "b" };
      const p2: AuthPrincipal = { issuer: "auth", subject: "a:b" };

      const key1 = getPrincipalKey(p1);
      const key2 = getPrincipalKey(p2);

      expect(key1).toBe('["auth:a","b"]');
      expect(key2).toBe('["auth","a:b"]');
      expect(key1).not.toBe(key2);
      expect(getPrincipalKey(null)).toBeNull();
    });

    it("extracts principal preserving exact raw subject/issuer without trimming return value (P1-2)", () => {
      const userRawSpaces = new User({
        access_token: "token-raw",
        token_type: "Bearer",
        profile: {
          iss: " https://accounts.example.com ",
          sub: " raw-user-123 ",
          aud: "echotalk-web",
          exp: 9999999999,
          iat: 1000000000,
        },
      });

      const extracted = extractPrincipalFromUser(userRawSpaces);
      expect(extracted).not.toBeNull();
      // 契约 §2：只用 trim 校验非空，保留原始精确身份，不归一化或剥离首尾空格
      expect(extracted?.subject).toBe(" raw-user-123 ");
      expect(extracted?.issuer).toBe(" https://accounts.example.com ");

      // 验证与 trim 后的 subject 不等同，杜绝误合并
      expect(
        arePrincipalsEqual(extracted, {
          issuer: " https://accounts.example.com ",
          subject: "raw-user-123",
        }),
      ).toBe(false);

      // 纯空或缺少
      expect(
        extractPrincipalFromUser(
          new User({
            access_token: "token-empty-iss",
            token_type: "Bearer",
            profile: {
              iss: "   ",
              sub: "123",
              aud: "echotalk-web",
              exp: 9999999999,
              iat: 1000000000,
            },
          }),
        ),
      ).toBeNull();

      expect(
        extractPrincipalFromUser(
          new User({
            access_token: "token-empty-sub",
            token_type: "Bearer",
            profile: {
              iss: "https://auth",
              sub: "",
              aud: "echotalk-web",
              exp: 9999999999,
              iat: 1000000000,
            },
          }),
        ),
      ).toBeNull();
    });
  });

  describe("Overlapping initialization and mutation-killing gates (P1-1 & P1-3)", () => {
    it("newer initialization supersedes older in-flight initialization (P1-1 kills gate mutation)", async () => {
      const { globalManager, userStore } = createRealTestOidcEnv();
      _setOidcManagerForTesting(globalManager, userStore);

      const userA = new User({
        access_token: "token-a",
        token_type: "Bearer",
        profile: {
          iss: "https://auth.example.com",
          sub: "user-A",
          aud: "echotalk-web",
          exp: 9999999999,
          iat: 1000000000,
        },
      });
      const userB = new User({
        access_token: "token-b",
        token_type: "Bearer",
        profile: {
          iss: "https://auth.example.com",
          sub: "user-B",
          aud: "echotalk-web",
          exp: 9999999999,
          iat: 1000000000,
        },
      });

      const pendingGets = new Map<string, () => void>();
      const origGet = userStore.get.bind(userStore);
      vi.spyOn(userStore, "get").mockImplementation(async (key: string) => {
        const snapshotValue = await origGet(key);
        const parsed = snapshotValue
          ? (JSON.parse(snapshotValue) as { access_token?: string })
          : null;
        const tokenId = parsed?.access_token ?? "empty";
        await new Promise<void>((resolve) => {
          pendingGets.set(tokenId, resolve);
        });
        return snapshotValue;
      });

      // 1. 先存入 userA 并启动初始化 A
      await globalManager.storeUser(userA);
      const promiseA = initializeAuthSnapshot();

      // 2. 存储更新为 userB 并启动初始化 B
      await globalManager.storeUser(userB);
      const promiseB = initializeAuthSnapshot();

      // 3. A 先完成并试图提交
      pendingGets.get("token-a")?.();
      await Promise.resolve();

      // 4. B 后完成
      pendingGets.get("token-b")?.();
      const snapB = await promiseB;
      const snapA = await promiseA;

      // 核心契约验证：最终生效的快照必须是最新启动的 B，旧请求 A 被淘汰！
      expect(getAuthSnapshot().principal?.subject).toBe("user-B");
      expect(snapB.principal?.subject).toBe("user-B");
      expect(snapA.principal?.subject).not.toBe("user-A");
    });

    it("stale initialization completing after logout or event is discarded (kills gate mutation)", async () => {
      const { globalManager, userStore } = createRealTestOidcEnv();
      _setOidcManagerForTesting(globalManager, userStore);

      const userStale = new User({
        access_token: "token-stale",
        token_type: "Bearer",
        profile: {
          iss: "https://auth.example.com",
          sub: "stale-user",
          aud: "echotalk-web",
          exp: 9999999999,
          iat: 1000000000,
        },
      });
      await globalManager.storeUser(userStale);

      let releaseStaleRead!: () => void;
      const origGet = userStore.get.bind(userStore);
      vi.spyOn(userStore, "get").mockImplementationOnce(async (key: string) => {
        const snapshotValue = await origGet(key);
        await new Promise<void>((resolve) => {
          releaseStaleRead = resolve;
        });
        return snapshotValue;
      });

      const initPromise = initializeAuthSnapshot();
      await vi.waitFor(() => {
        expect(typeof releaseStaleRead).toBe("function");
      });

      // 在初始化在途期间，用户显式退出或者会话失效
      invalidateAuthSession();
      expect(getAuthSnapshot().state).toBe("anonymous");

      // 旧初始化迟到返回
      releaseStaleRead();
      await initPromise;

      // 核心门禁：绝不能将已退出的会话恢复为 authenticated！
      expect(getAuthSnapshot().state).toBe("anonymous");
      expect(getAuthSnapshot().principal).toBeNull();
    });
  });

  describe("Redirect callback single-exchange sharing & ownership fencing (R2, R3, R4 & R5)", () => {
    const parseFetchFormCode = (init?: RequestInit): string => {
      if (init?.body instanceof URLSearchParams) {
        return init.body.get("code") ?? "";
      }
      if (typeof init?.body === "string") {
        return new URLSearchParams(init.body).get("code") ?? "";
      }
      return "";
    };

    it("shares in-flight callback exchange for identical code/state under StrictMode, consuming state and exchanging code only once, then releases after completion (R4)", async () => {
      const { globalManager, userStore, stateStore } = createRealTestOidcEnv();
      _setOidcManagerForTesting(globalManager, userStore);

      const stateId = await prepareSigninState(globalManager);
      window.history.replaceState({}, "", `/callback?code=single-code-1&state=${stateId}`);

      let releaseTokenNetwork!: () => void;
      const exchangedCodes = new Set<string>();

      globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const code = parseFetchFormCode(init);
        if (exchangedCodes.has(code)) {
          return new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        exchangedCodes.add(code);
        await new Promise<void>((resolve) => {
          releaseTokenNetwork = resolve;
        });
        return createTokenResponse("strict-user-1", "strict-token-1");
      });

      const callbackSpy = vi.spyOn(UserManager.prototype, "signinRedirectCallback");
      const stateRemoveSpy = vi.spyOn(stateStore, "remove");

      // 模拟 StrictMode 下对同一 (code, state) 的并发重复初始化
      const initPromise1 = initializeAuthSnapshot();
      const initPromise2 = initializeAuthSnapshot();

      // 等待微任务直至真实 SDK 消费 state 并到达 token 交换网络请求
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      // 释放网络响应
      releaseTokenNetwork();
      const [snap1, snap2] = await Promise.all([initPromise1, initPromise2]);

      const expectedSnap = {
        state: "authenticated" as const,
        principal: { issuer: "https://auth.example.com", subject: "strict-user-1" },
      };
      expect(snap1).toEqual(expectedSnap);
      expect(snap2).toEqual(expectedSnap);
      expect(getAuthSnapshot()).toEqual(expectedSnap);
      expect(await getAccessToken()).toBe("strict-token-1");

      // 真实 SDK 公有入口断言：只调用 1 次 signinRedirectCallback、只消费 1 次 state、只请求 1 次网络交换
      expect(callbackSpy).toHaveBeenCalledTimes(1);
      expect(stateRemoveSpy).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(await stateStore.get(stateId)).toBeNull();
      expect(window.location.pathname).toBe("/callback");
      expect(window.location.search).toBe("");

      // 验证共享在途操作结束后已释放（不永久缓存回调结果）：
      // 若后续再次出现相同已消费的 (code, state)，必须重新走 SDK 校验并因 state 已消费而受控失败
      window.history.replaceState({}, "", `/callback?code=single-code-1&state=${stateId}`);
      const replaySnap = await initializeAuthSnapshot();
      expect(callbackSpy).toHaveBeenCalledTimes(2);
      expect(replaySnap).toEqual({ state: "misconfigured", principal: null });
    });

    it("isolates ownership across distinct callbacks (code-A vs code-B) so stale callback A cannot overwrite newer callback B (R4)", async () => {
      const { globalManager, userStore } = createRealTestOidcEnv();
      _setOidcManagerForTesting(globalManager, userStore);

      const stateA = await prepareSigninState(globalManager);
      const stateB = await prepareSigninState(globalManager);

      const networkResolvers = new Map<string, () => void>();
      globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const code = parseFetchFormCode(init);
        await new Promise<void>((resolve) => {
          networkResolvers.set(code, resolve);
        });
        if (code === "code-A") {
          return createTokenResponse("user-A", "token-user-A");
        }
        return createTokenResponse("user-B", "token-user-B");
      });

      const callbackSpy = vi.spyOn(UserManager.prototype, "signinRedirectCallback");

      // 1. 启动 callback A
      window.history.replaceState({}, "", `/callback?code=code-A&state=${stateA}`);
      const promiseA = initializeAuthSnapshot();
      await vi.waitFor(() => {
        expect(networkResolvers.has("code-A")).toBe(true);
      });

      // 2. 在 callback A 仍在途时，切换到不同的 callback B 并初始化
      window.history.replaceState({}, "", `/callback?code=code-B&state=${stateB}`);
      const promiseB = initializeAuthSnapshot();
      await vi.waitFor(() => {
        expect(networkResolvers.has("code-B")).toBe(true);
      });

      // 不同 (code, state) 绝不混用共享，各自进入一次 SDK 回调
      expect(callbackSpy).toHaveBeenCalledTimes(2);

      // 3. 新 callback B 先完成网络交换
      networkResolvers.get("code-B")?.();
      const snapB = await promiseB;
      expect(snapB).toEqual({
        state: "authenticated",
        principal: { issuer: "https://auth.example.com", subject: "user-B" },
      });

      // 4. 旧 callback A 随后迟到完成网络交换
      networkResolvers.get("code-A")?.();
      await promiseA;

      // 核心断言：若去掉操作归属门禁，旧 A 会覆盖 storage 与快照；有门禁则始终保持 user-B
      expect(getAuthSnapshot()).toEqual({
        state: "authenticated",
        principal: { issuer: "https://auth.example.com", subject: "user-B" },
      });
      expect((await globalManager.getUser())?.profile.sub).toBe("user-B");
      expect(await getAccessToken()).toBe("token-user-B");
    });

    it("does not re-consume state or overwrite user B with misconfigured when initializeAuthSnapshot is called again for the same pending callback after invalidate and user B login (R5)", async () => {
      const { globalManager, userStore, stateStore } = createRealTestOidcEnv();
      _setOidcManagerForTesting(globalManager, userStore);

      const stateA = await prepareSigninState(globalManager);
      window.history.replaceState({}, "", `/callback?code=code-A&state=${stateA}`);

      let releaseStaleNetworkA!: () => void;
      globalThis.fetch = vi.fn(async () => {
        await new Promise<void>((resolve) => {
          releaseStaleNetworkA = resolve;
        });
        return createTokenResponse("user-A", "token-user-A");
      });

      const callbackSpy = vi.spyOn(UserManager.prototype, "signinRedirectCallback");
      const stateRemoveSpy = vi.spyOn(stateStore, "remove");

      // 1. 启动 callback A，消费了 stateA 并停留在网络交换 pending
      const firstInitPromise = initializeAuthSnapshot();
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      // 2. 在 A 仍 pending 期间，发生 invalidate，且 globalManager 公有 storeUser(B) + events.load(B) 新登录
      invalidateAuthSession();
      const userB = new User({
        access_token: "synthetic-token-b",
        token_type: "Bearer",
        profile: {
          iss: "https://auth.example.com",
          sub: "user-B",
          aud: "echotalk-web",
          exp: 9999999999,
          iat: 1000000000,
        },
      });
      await globalManager.storeUser(userB);
      await globalManager.events.load(userB);

      expect(getAuthSnapshot()).toEqual({
        state: "authenticated",
        principal: { issuer: "https://auth.example.com", subject: "user-B" },
      });

      // 3. 在 A 仍 pending 且 URL 保持同一 code-A/stateA 时，再次调用 initializeAuthSnapshot
      const secondInitPromise = initializeAuthSnapshot();

      // 4. 释放 A 的网络交换并等待两次初始化完成
      releaseStaleNetworkA();
      const [firstResult, secondResult] = await Promise.all([firstInitPromise, secondInitPromise]);

      // 核心断言：
      // (1) 只发生 1 次 SDK 交换与 state 消费，绝不因第二次调用重新消费已消费 state 而把 B 置为 misconfigured
      expect(callbackSpy).toHaveBeenCalledTimes(1);
      expect(stateRemoveSpy).toHaveBeenCalledTimes(1);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // (2) 两次初始化观察到的当前快照、全局快照、SDK storage 与 token 均保持为 user-B
      const expectedBSnap = {
        state: "authenticated" as const,
        principal: { issuer: "https://auth.example.com", subject: "user-B" },
      };
      expect(firstResult).toEqual(expectedBSnap);
      expect(secondResult).toEqual(expectedBSnap);
      expect(getAuthSnapshot()).toEqual(expectedBSnap);
      expect((await globalManager.getUser())?.profile.sub).toBe("user-B");
      expect(await getAccessToken()).toBe("synthetic-token-b");
    });

    it("restores authenticated state and token when UserLoaded fires after anonymous initialization without active callback (R3 P1-1)", async () => {
      const { globalManager, userStore } = createRealTestOidcEnv();
      _setOidcManagerForTesting(globalManager, userStore);

      // 1. 初始化无用户 -> anonymous
      const initSnap = await initializeAuthSnapshot();
      expect(initSnap.state).toBe("anonymous");
      expect(initSnap.principal).toBeNull();
      expect(await getAccessToken()).toBeNull();

      // 2. 真实 SDK storeUser(validUserA) + events.load(validUserA)
      const validUserA = new User({
        access_token: "synthetic-token-a",
        token_type: "Bearer",
        profile: {
          iss: "https://auth.example.com",
          sub: "user-a",
          aud: "echotalk-web",
          exp: 9999999999,
          iat: 1000000000,
        },
      });

      await globalManager.storeUser(validUserA);
      await globalManager.events.load(validUserA);

      // 3. 应恢复为 authenticated 并可获取 token
      expect(getAuthSnapshot()).toEqual({
        state: "authenticated",
        principal: { issuer: "https://auth.example.com", subject: "user-a" },
      });
      expect(await getAccessToken()).toBe("synthetic-token-a");
    });

    it("stale redirect callback completing after logout does not fire authenticated event and does not write credentials", async () => {
      const { globalManager, userStore } = createRealTestOidcEnv();
      _setOidcManagerForTesting(globalManager, userStore);

      const stateId = await prepareSigninState(globalManager);
      window.history.replaceState({}, "", `/callback?code=stale-code&state=${stateId}`);

      let releaseStaleTokenNetwork!: () => void;
      globalThis.fetch = vi.fn(async () => {
        await new Promise<void>((resolve) => {
          releaseStaleTokenNetwork = resolve;
        });
        return createTokenResponse("old-callback-user", "old-stale-token");
      });

      // 1. 启动初始化并处理 callback
      const initPromise = initializeAuthSnapshot();
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      // 2. 初始化在途时，用户显式登出，发布 anonymous
      invalidateAuthSession();
      expect(getAuthSnapshot().state).toBe("anonymous");

      // 3. 释放旧 callback 网络响应，让真实 SDK 走完 storeUser 与 events.load
      releaseStaleTokenNetwork();
      await initPromise;

      // 核心门禁验证：
      // (1) 绝不能被迟到的 UserLoaded 或 callback 冲刷回 authenticated，必须始终保持 anonymous！
      expect(getAuthSnapshot().state).toBe("anonymous");
      expect(getAuthSnapshot().principal).toBeNull();

      // (2) 凭据写入必须被拦截，不得将旧凭据写入 storage！
      expect(await globalManager.getUser()).toBeNull();
      expect(await getAccessToken()).toBeNull();
    });

    it("stale callback arriving after invalidate and a newer user login does not overwrite newer session, storage, or token (R3 P1-2)", async () => {
      const { globalManager, userStore } = createRealTestOidcEnv();
      _setOidcManagerForTesting(globalManager, userStore);

      // 1. global manager 先初始化 anonymous
      window.history.replaceState({}, "", "/");
      const initialSnap = await initializeAuthSnapshot();
      expect(initialSnap.state).toBe("anonymous");

      // 2. 启动旧 redirect callback A 并挂起网络响应
      const stateA = await prepareSigninState(globalManager);
      window.history.replaceState({}, "", `/callback?code=code-A&state=${stateA}`);

      let releaseStaleNetworkA!: () => void;
      globalThis.fetch = vi.fn(async () => {
        await new Promise<void>((resolve) => {
          releaseStaleNetworkA = resolve;
        });
        return createTokenResponse("user-A", "synthetic-token-a");
      });

      const staleCallbackPromise = initializeAuthSnapshot();
      await vi.waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      // 3. 在途期间发生 invalidate
      invalidateAuthSession();
      expect(getAuthSnapshot().state).toBe("anonymous");

      // 4. global manager 保存新账号 B 并触发 events.load(B)
      const userB = new User({
        access_token: "synthetic-token-b",
        token_type: "Bearer",
        profile: {
          iss: "https://auth.example.com",
          sub: "user-B",
          aud: "echotalk-web",
          exp: 9999999999,
          iat: 1000000000,
        },
      });
      await globalManager.storeUser(userB);
      await globalManager.events.load(userB);

      expect(getAuthSnapshot()).toEqual({
        state: "authenticated",
        principal: { issuer: "https://auth.example.com", subject: "user-B" },
      });
      expect(await getAccessToken()).toBe("synthetic-token-b");

      // 5. 再完成旧 callback A（真实 SDK 内部执行 storeUser(A) 与 events.load(A)）
      releaseStaleNetworkA();
      await staleCallbackPromise;

      // 6. 核心门禁验证：必须保持 B，且 SDK storage 和 Token 都是 B，旧 A 不可发布！
      expect(getAuthSnapshot()).toEqual({
        state: "authenticated",
        principal: { issuer: "https://auth.example.com", subject: "user-B" },
      });
      const storedUser = await globalManager.getUser();
      expect(storedUser?.profile.sub).toBe("user-B");
      expect(await getAccessToken()).toBe("synthetic-token-b");
    });
  });

  describe("AtomicWebStorageStore real monotonic race test (P1-3 & P2)", () => {
    it("does not delete newer session data when stale cleanup for older revision arrives (realistic monotonic order)", async () => {
      const { storage: mockStorage } = createMockWebStorage();

      let runtimeRev = 10;
      const store = new AtomicWebStorageStore({
        prefix: "oidc.",
        store: mockStorage,
        getRevision: () => runtimeRev,
      });

      // 1. 账号 A 在 revision 10 登录，写入凭据
      await store.set("user", JSON.stringify({ token: "token-userA" }));
      expect(await store.get("user")).toBe(JSON.stringify({ token: "token-userA" }));

      // 2. 账号 A 退出，发起针对 revision 10 的异步清理操作（排队中）
      store.setCleanupTarget(runtimeRev);

      // 3. 在清理执行之前，账号 B 登录在单调递增的 revision 11，写入新凭据
      runtimeRev = 11;
      await store.set("user", JSON.stringify({ token: "token-userB" }));

      // 4. 账号 A 迟到的清理针对旧 revision 10 执行
      await store.remove("user");

      // 核心断言：迟到的清理绝不得删除 revision 11 的新凭据！
      expect(await store.get("user")).toBe(JSON.stringify({ token: "token-userB" }));
      expect(mockStorage.removeItem).not.toHaveBeenCalled();

      // 5. 当正常清理匹配的当前 revision 11 时，正常删除
      store.setCleanupTarget(11);
      await store.remove("user");
      expect(mockStorage.removeItem).toHaveBeenCalledWith("oidc.user");
    });
  });
});
