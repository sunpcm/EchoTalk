/** 前端唯一认证边界：标准 OIDC Authorization Code + PKCE，或显式 dev token。 */

import { UserManager, type StateStore, type User } from "oidc-client-ts";

export interface AuthPrincipal {
  issuer: string;
  subject: string;
}

export type AuthState = "loading" | "authenticated" | "anonymous" | "misconfigured";

export interface AuthSnapshot {
  state: AuthState;
  principal: AuthPrincipal | null;
}

export type AccessTokenProvider = () => string | null | Promise<string | null>;

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length(): number {
      return data.size;
    },
    clear(): void {
      data.clear();
    },
    getItem(key: string): string | null {
      return data.get(key) ?? null;
    },
    key(index: number): string | null {
      return Array.from(data.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      data.delete(key);
    },
    setItem(key: string, value: string): void {
      data.set(key, value);
    },
  };
}

/**
 * 具有原子操作能力的 WebStorage 状态存储实现，消除先 getItem 再 removeItem 的微任务间隙，
 * 并通过单调递增的操作 revision 保护，防止迟到的异步清理误删新登录的用户凭据。
 */
export class AtomicWebStorageStore implements StateStore {
  private readonly prefix: string;
  private readonly store: Storage;
  private readonly keyRevision = new Map<string, number>();
  private activeCleanupRevision: number | null = null;
  private readonly getRevision?: () => number;

  constructor(options?: { prefix?: string; store?: Storage; getRevision?: () => number }) {
    this.prefix = options?.prefix ?? "oidc.";
    this.store =
      options?.store ??
      (typeof window !== "undefined" ? window.sessionStorage : createMemoryStorage());
    this.getRevision = options?.getRevision;
  }

  setCleanupTarget(revision: number): void {
    this.activeCleanupRevision = revision;
  }

  async set(key: string, value: string): Promise<void> {
    if (this.getRevision) {
      this.keyRevision.set(key, this.getRevision());
    }
    this.store.setItem(this.prefix + key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.store.getItem(this.prefix + key);
  }

  async remove(key: string): Promise<string | null> {
    const fullKey = this.prefix + key;
    const item = this.store.getItem(fullKey);
    // 若当前正在执行针对某个旧 revision 的清理操作：
    // 若 storage 中当前 key 的数据是在更新的 revision 写入的，则绝不删除
    if (this.activeCleanupRevision !== null && this.keyRevision.has(key)) {
      const writtenRevision = this.keyRevision.get(key)!;
      if (writtenRevision > this.activeCleanupRevision) {
        return item;
      }
    }
    this.keyRevision.delete(key);
    this.store.removeItem(fullKey);
    return item;
  }

  async getAllKeys(): Promise<string[]> {
    const keys: string[] = [];
    const len = this.store.length || 0;
    for (let i = 0; i < len; i++) {
      const k = this.store.key(i);
      if (k && k.startsWith(this.prefix)) {
        keys.push(k.slice(this.prefix.length));
      }
    }
    return keys;
  }
}

export const DEV_PRINCIPAL: AuthPrincipal = {
  issuer: "urn:echotalk:auth:dev",
  subject: "dev-user",
};

export function arePrincipalsEqual(a: AuthPrincipal | null, b: AuthPrincipal | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.issuer === b.issuer && a.subject === b.subject;
}

export function getPrincipalKey(principal: AuthPrincipal | null): string | null {
  if (!principal) return null;
  return JSON.stringify([principal.issuer, principal.subject]);
}

/**
 * 契约 §2：只用 trim 检查非空，返回原始精确身份，不归一化或 trim 返回值，
 * 避免不同原始 subject（如 "a" 与 " a "）被误合并。
 */
export function extractPrincipalFromUser(user: User | null): AuthPrincipal | null {
  if (!user || user.expired) return null;
  const iss = user.profile?.iss;
  const sub = user.profile?.sub;
  if (
    typeof iss === "string" &&
    iss.trim() !== "" &&
    typeof sub === "string" &&
    sub.trim() !== ""
  ) {
    return { issuer: iss, subject: sub };
  }
  return null;
}

const explicitDevToken =
  import.meta.env.DEV && import.meta.env.VITE_AUTH_MODE === "dev"
    ? import.meta.env.VITE_DEV_AUTH_TOKEN || null
    : null;

interface InFlightCallbackOperation {
  key: string;
  initSeq: number;
  initEventRevision: number;
  promise: Promise<AuthSnapshot>;
}

let currentRevision = 1;
let activeInitSequence = 0;
let inFlightCallback: InFlightCallbackOperation | null = null;
let currentSnapshot: AuthSnapshot = { state: "loading", principal: null };
const snapshotListeners = new Set<(snapshot: AuthSnapshot) => void>();
const legacyListeners = new Set<(state: AuthState) => void>();

let accessTokenProvider: AccessTokenProvider = () => explicitDevToken;
let oidcManager: UserManager | null = null;
let atomicUserStore: AtomicWebStorageStore | null = null;
let boundOidcManager: UserManager | null = null;

function updateSnapshot(next: AuthSnapshot): void {
  currentRevision += 1;
  // 任何新的认证事件发布，均立即淘汰所有先前在途的旧初始化与在途 callback 的写入/发布所有权
  activeInitSequence += 1;
  currentSnapshot = next;
  const snap = { ...currentSnapshot };
  for (const listener of Array.from(snapshotListeners)) {
    listener(snap);
  }
  for (const listener of Array.from(legacyListeners)) {
    listener(snap.state);
  }
}

export function getAuthRevision(): number {
  return currentRevision;
}

export function getAuthSnapshot(): AuthSnapshot {
  return { ...currentSnapshot };
}

export function getAuthMode(): "dev" | "oidc" | "invalid" {
  if (oidcManager) return "oidc";
  if (import.meta.env.VITE_AUTH_MODE === "dev") return "dev";
  if (import.meta.env.VITE_AUTH_MODE === "oidc") return "oidc";
  return "invalid";
}

function getOidcManager(): UserManager | null {
  if (oidcManager) return oidcManager;
  const authority = import.meta.env.VITE_OIDC_AUTHORITY;
  const clientId = import.meta.env.VITE_OIDC_CLIENT_ID;
  const redirectUri = import.meta.env.VITE_OIDC_REDIRECT_URI;
  if (!authority || !clientId || !redirectUri) return null;

  atomicUserStore = new AtomicWebStorageStore({
    store: typeof window !== "undefined" ? window.sessionStorage : undefined,
    getRevision: getAuthRevision,
  });

  oidcManager = new UserManager({
    authority,
    client_id: clientId,
    redirect_uri: redirectUri,
    post_logout_redirect_uri: import.meta.env.VITE_OIDC_POST_LOGOUT_REDIRECT_URI || redirectUri,
    response_type: "code",
    scope: import.meta.env.VITE_OIDC_SCOPE || "openid profile email",
    userStore: atomicUserStore,
    automaticSilentRenew: false,
  });

  accessTokenProvider = async () => {
    const user = await oidcManager?.getUser();
    return user && !user.expired ? user.access_token : null;
  };

  bindOidcEvents(oidcManager);
  return oidcManager;
}

function bindOidcEvents(manager: UserManager): void {
  if (boundOidcManager === manager) return;
  boundOidcManager = manager;

  manager.events.addUserLoaded((user: User) => {
    if (oidcManager !== manager) return;
    if (!user || user.expired) {
      updateSnapshot({ state: "anonymous", principal: null });
      return;
    }
    const principal = extractPrincipalFromUser(user);
    if (principal) {
      updateSnapshot({ state: "authenticated", principal });
    } else {
      updateSnapshot({ state: "misconfigured", principal: null });
    }
  });

  manager.events.addUserUnloaded(() => {
    if (oidcManager !== manager) return;
    if (currentSnapshot.state !== "anonymous") {
      updateSnapshot({ state: "anonymous", principal: null });
    }
  });

  manager.events.addAccessTokenExpired(() => {
    if (oidcManager !== manager) return;
    if (currentSnapshot.state !== "anonymous") {
      updateSnapshot({ state: "anonymous", principal: null });
    }
  });
}

function createOperationUserStore(baseStore: StateStore, isOwnerValid: () => boolean): StateStore {
  return {
    set: async (key: string, value: string): Promise<void> => {
      if (!isOwnerValid()) {
        return;
      }
      await baseStore.set(key, value);
    },
    get: async (key: string): Promise<string | null> => {
      return baseStore.get(key);
    },
    remove: async (key: string): Promise<string | null> => {
      if (!isOwnerValid()) {
        return null;
      }
      return baseStore.remove(key);
    },
    getAllKeys: async (): Promise<string[]> => {
      return baseStore.getAllKeys();
    },
  };
}

/**
 * 初始化认证快照。
 * 引入独立的 activeInitSequence 与认证事件 revision 门禁：
 * 新的初始化启动即淘汰旧初始化；期间发生退出或事件变更也淘汰旧初始化。
 * 针对 redirect callback 操作采用独立的 per-operation UserManager 与绑定该次操作所有权的 userStore 包装，
 * 并对同一次 (code, state) 的并发/StrictMode 初始化共享在途交换，确保只消费一次 state / 交换一次 code。
 */
export async function initializeAuthSnapshot(): Promise<AuthSnapshot> {
  const mode = getAuthMode();

  if (mode === "dev") {
    const initSeq = ++activeInitSequence;
    const initEventRevision = currentRevision;
    inFlightCallback = null;
    const snap: AuthSnapshot = explicitDevToken
      ? { state: "authenticated", principal: DEV_PRINCIPAL }
      : { state: "misconfigured", principal: null };
    if (initSeq === activeInitSequence && currentRevision === initEventRevision) {
      updateSnapshot(snap);
    }
    return currentSnapshot;
  }

  if (mode !== "oidc") {
    const initSeq = ++activeInitSequence;
    const initEventRevision = currentRevision;
    inFlightCallback = null;
    const snap: AuthSnapshot = { state: "misconfigured", principal: null };
    if (initSeq === activeInitSequence && currentRevision === initEventRevision) {
      updateSnapshot(snap);
    }
    return currentSnapshot;
  }

  const manager = getOidcManager();
  if (!manager) {
    const initSeq = ++activeInitSequence;
    const initEventRevision = currentRevision;
    inFlightCallback = null;
    const snap: AuthSnapshot = { state: "misconfigured", principal: null };
    if (initSeq === activeInitSequence && currentRevision === initEventRevision) {
      updateSnapshot(snap);
    }
    return currentSnapshot;
  }

  let callback: URL;
  try {
    callback = new URL(window.location.href);
  } catch {
    const initSeq = ++activeInitSequence;
    const initEventRevision = currentRevision;
    inFlightCallback = null;
    if (initSeq === activeInitSequence && currentRevision === initEventRevision) {
      const snap: AuthSnapshot = { state: "misconfigured", principal: null };
      updateSnapshot(snap);
      return snap;
    }
    return currentSnapshot;
  }

  const code = callback.searchParams.get("code");
  const state = callback.searchParams.get("state");
  if (code !== null && state !== null) {
    const callbackKey = JSON.stringify([code, state]);
    if (inFlightCallback !== null && inFlightCallback.key === callbackKey) {
      return inFlightCallback.promise;
    }

    const initSeq = ++activeInitSequence;
    const initEventRevision = currentRevision;
    const isOwnerValid = (): boolean =>
      initSeq === activeInitSequence && currentRevision === initEventRevision;

    const exchangePromise = (async (): Promise<AuthSnapshot> => {
      try {
        const baseUserStore: StateStore | null = manager.settings?.userStore ?? atomicUserStore;
        const opUserStore = baseUserStore
          ? createOperationUserStore(baseUserStore, isOwnerValid)
          : undefined;

        const callbackManager = new UserManager({
          ...manager.settings,
          ...(opUserStore ? { userStore: opUserStore } : {}),
          automaticSilentRenew: false,
          monitorSession: false,
        });

        const callbackUser = await manager.signinRedirectCallback.call(callbackManager);

        // 核心门禁：若已被更新的初始化启动超越，或期间发生了退出/事件变更，放弃回填
        if (!isOwnerValid()) {
          return currentSnapshot;
        }

        window.history.replaceState({}, document.title, callback.pathname);

        if (!callbackUser || callbackUser.expired) {
          await callbackManager.storeUser(null).catch(() => {});
          if (!isOwnerValid()) {
            return currentSnapshot;
          }
          const snap: AuthSnapshot = { state: "anonymous", principal: null };
          updateSnapshot(snap);
          return snap;
        }

        const principal = extractPrincipalFromUser(callbackUser);
        if (!principal) {
          await callbackManager.storeUser(null).catch(() => {});
          if (!isOwnerValid()) {
            return currentSnapshot;
          }
          const snap: AuthSnapshot = { state: "misconfigured", principal: null };
          updateSnapshot(snap);
          return snap;
        }

        const snap: AuthSnapshot = { state: "authenticated", principal };
        updateSnapshot(snap);
        return snap;
      } catch {
        if (isOwnerValid()) {
          window.history.replaceState({}, document.title, callback.pathname);
          const snap: AuthSnapshot = { state: "misconfigured", principal: null };
          updateSnapshot(snap);
          return snap;
        }
        return currentSnapshot;
      } finally {
        if (inFlightCallback?.initSeq === initSeq) {
          inFlightCallback = null;
        }
      }
    })();

    inFlightCallback = {
      key: callbackKey,
      initSeq,
      initEventRevision,
      promise: exchangePromise,
    };

    return exchangePromise;
  }

  const initSeq = ++activeInitSequence;
  const initEventRevision = currentRevision;
  inFlightCallback = null;

  try {
    const user = await manager.getUser();

    // 核心门禁：若已被更新的初始化启动超越，或期间发生了退出/事件变更，放弃回填
    if (initSeq !== activeInitSequence || currentRevision !== initEventRevision) {
      return currentSnapshot;
    }

    if (!user || user.expired) {
      const snap: AuthSnapshot = { state: "anonymous", principal: null };
      updateSnapshot(snap);
      return snap;
    }

    const principal = extractPrincipalFromUser(user);
    if (!principal) {
      const snap: AuthSnapshot = { state: "misconfigured", principal: null };
      updateSnapshot(snap);
      return snap;
    }

    const snap: AuthSnapshot = { state: "authenticated", principal };
    updateSnapshot(snap);
    return snap;
  } catch {
    if (initSeq === activeInitSequence && currentRevision === initEventRevision) {
      const snap: AuthSnapshot = { state: "misconfigured", principal: null };
      updateSnapshot(snap);
      return snap;
    }
    return currentSnapshot;
  }
}

export async function initializeAuth(): Promise<AuthState> {
  const snapshot = await initializeAuthSnapshot();
  return snapshot.state;
}

export function subscribeAuthSnapshot(listener: (snapshot: AuthSnapshot) => void): () => void {
  if (getAuthMode() === "oidc") {
    getOidcManager();
  }
  snapshotListeners.add(listener);
  return () => {
    snapshotListeners.delete(listener);
  };
}

export function subscribeAuth(listener: (state: AuthState) => void): () => void {
  if (getAuthMode() === "oidc") {
    getOidcManager();
  }
  legacyListeners.add(listener);
  return () => {
    legacyListeners.delete(listener);
  };
}

export function invalidateAuthSession(expectedRevision?: number): void {
  if (expectedRevision !== undefined && currentRevision !== expectedRevision) {
    return;
  }
  const mode = getAuthMode();
  const nextState: AuthState = mode === "dev" ? "misconfigured" : "anonymous";
  const cleanupRevision = currentRevision;

  // 递增 revision 与 activeInitSequence，使先前在途的 callback 和初始化立即失效
  updateSnapshot({ state: nextState, principal: null });

  const manager = oidcManager;
  if (manager) {
    if (atomicUserStore) {
      atomicUserStore.setCleanupTarget(cleanupRevision);
    }
    // 仅通过公有 storeUser(null) 接口清空凭据，杜绝任何 _userStoreKey 私有属性依赖
    void manager.storeUser(null).catch(() => {});
  }
}

export async function beginLogin(): Promise<void> {
  const manager = getOidcManager();
  if (!manager) throw new Error("OIDC configuration is incomplete");
  await manager.signinRedirect();
}

export async function beginLogout(): Promise<void> {
  invalidateAuthSession();
  const manager = getOidcManager();
  if (!manager) return;
  try {
    await manager.signoutRedirect();
  } catch {
    // 捕获跳转异常
  }
}

export function setAccessTokenProvider(provider: AccessTokenProvider): () => void {
  const previous = accessTokenProvider;
  accessTokenProvider = provider;
  return () => {
    accessTokenProvider = previous;
  };
}

export async function getAccessToken(): Promise<string | null> {
  if (currentSnapshot.state === "anonymous" || currentSnapshot.state === "misconfigured") {
    return null;
  }
  return accessTokenProvider();
}

/** 测试专用状态重置与依赖注入钩子 */
export function _setOidcManagerForTesting(
  manager: UserManager | null,
  userStore?: AtomicWebStorageStore,
): void {
  oidcManager = manager;
  inFlightCallback = null;
  const candidateStore: StateStore | undefined = userStore ?? manager?.settings?.userStore;
  atomicUserStore = candidateStore instanceof AtomicWebStorageStore ? candidateStore : null;
  if (manager) {
    accessTokenProvider = async () => {
      const user = await oidcManager?.getUser();
      return user && !user.expired ? user.access_token : null;
    };
    bindOidcEvents(manager);
  }
}

export function _resetAuthForTesting(): void {
  currentRevision = 1;
  activeInitSequence = 0;
  inFlightCallback = null;
  currentSnapshot = { state: "loading", principal: null };
  snapshotListeners.clear();
  legacyListeners.clear();
  accessTokenProvider = () => explicitDevToken;
  oidcManager = null;
  atomicUserStore = null;
  boundOidcManager = null;
}
