import { App } from "@capacitor/app";
import { detectPlatform } from "./detection";
import type { PlatformType } from "./types";
import {
  createWebLifecycleAdapter,
  type WebLifecycleEvent,
  type WebLifecycleEventType,
  type WebLifecycleOptions,
  type WebLifecycleSnapshot,
  type WebLifecycleVisibility,
} from "./webLifecycle";

export interface AppStateSource {
  getState(): Promise<{ isActive: boolean }>;
  addListener(
    eventName: "appStateChange",
    listenerFunc: (state: { isActive: boolean }) => void,
  ): Promise<{ remove(): Promise<void> }>;
}

export interface LifecycleOptions {
  platform?: PlatformType;
  webOptions?: WebLifecycleOptions;
  app?: AppStateSource;
}

export interface LifecycleCapabilities {
  readonly webEvents: boolean;
  readonly nativeAppState: boolean;
}

export interface LifecycleAdapter {
  readonly capabilities: LifecycleCapabilities;
  getSnapshot(): WebLifecycleSnapshot;
  subscribe(listener: (event: WebLifecycleEvent) => void): () => void;
  dispose(): void;
  whenReady(): Promise<void>;
}

interface Subscription {
  readonly id: number;
  readonly listener: (event: WebLifecycleEvent) => void;
  active: boolean;
}

function createWebAdapterWrapper(webOptions?: WebLifecycleOptions): LifecycleAdapter {
  const webAdapter = createWebLifecycleAdapter(webOptions);

  return {
    get capabilities(): LifecycleCapabilities {
      return {
        webEvents: webAdapter.capabilities.webEvents,
        nativeAppState: false,
      };
    },
    getSnapshot(): WebLifecycleSnapshot {
      return webAdapter.getSnapshot();
    },
    subscribe(listener: (event: WebLifecycleEvent) => void): () => void {
      return webAdapter.subscribe(listener);
    },
    dispose(): void {
      webAdapter.dispose();
    },
    whenReady(): Promise<void> {
      return Promise.resolve();
    },
  };
}

function createIosAppLifecycleAdapter(
  appSource?: AppStateSource,
  webOptions?: WebLifecycleOptions,
): LifecycleAdapter {
  const app = appSource ?? App;
  const webAdapter = createWebLifecycleAdapter(webOptions);

  let isDisposed = false;
  let nativeRegistered = false;
  let registrationFailed = false;
  let initialStateFailed = false;
  let nativeReady = false;
  let nativeActive: boolean | null = null;
  let eventVersion = 0;
  let appListenerHandle: { remove(): Promise<void> } | null = null;

  let currentVisibility: WebLifecycleVisibility = "hidden";
  let currentOnline: boolean | null = webAdapter.getSnapshot().online;

  let nextSubId = 1;
  const subscriptions = new Map<number, Subscription>();

  let whenReadyResolved = false;
  let resolveWhenReady = () => {};
  const whenReadyPromise = new Promise<void>((resolve) => {
    resolveWhenReady = () => {
      if (!whenReadyResolved) {
        whenReadyResolved = true;
        resolve();
      }
    };
  });

  function computeVisibility(): WebLifecycleVisibility {
    if (!nativeReady || nativeActive !== true || registrationFailed || initialStateFailed) {
      return "hidden";
    }
    const webVis = webAdapter.getSnapshot().visibility;
    // 原生 active 且 Web 不为 hidden（visible 或 unknown 均非 hidden）时呈现 visible
    if (webVis === "hidden") {
      return "hidden";
    }
    return "visible";
  }

  function createSnapshotCopy(): WebLifecycleSnapshot {
    return {
      visibility: currentVisibility,
      online: currentOnline,
    };
  }

  function notify(type: WebLifecycleEventType) {
    if (isDisposed) {
      return;
    }

    const currentSubs = Array.from(subscriptions.values());
    for (const sub of currentSubs) {
      if (isDisposed) {
        break;
      }
      if (!sub.active || !subscriptions.has(sub.id)) {
        continue;
      }
      try {
        sub.listener({
          type,
          snapshot: createSnapshotCopy(),
        });
      } catch {
        // 单个 listener 抛错不妨碍其他 listener 与清理
      }
    }
  }

  function syncStateAndNotify() {
    if (isDisposed) {
      return;
    }

    const nextVis = computeVisibility();
    const nextOnline = webAdapter.getSnapshot().online;

    const visChanged = nextVis !== currentVisibility;
    const onlineChanged = nextOnline !== currentOnline;

    if (visChanged) {
      currentVisibility = nextVis;
      if (currentVisibility === "visible") {
        notify("resume");
      } else {
        notify("suspend");
      }
    }

    if (onlineChanged) {
      currentOnline = nextOnline;
      notify("connectivity");
    }
  }

  const unsubWeb = webAdapter.subscribe(() => {
    if (isDisposed) {
      return;
    }
    syncStateAndNotify();
  });

  function handleAppStateChange(state: { isActive: boolean }) {
    if (isDisposed) {
      return;
    }
    if (!state || typeof state.isActive !== "boolean") {
      return;
    }

    // 每次有效事件（包括同值）均推进版本
    eventVersion++;
    nativeActive = state.isActive;

    // 仅当监听真实注册成功且未发生注册失败时方可开放能力
    if (nativeRegistered && !registrationFailed) {
      initialStateFailed = false;
      nativeReady = true;
      resolveWhenReady();
      syncStateAndNotify();
    }
  }

  function fetchInitialGetState() {
    if (isDisposed) {
      return;
    }

    const capturedVersion = eventVersion;
    let getStatePromise: Promise<{ isActive: boolean }> | undefined;
    try {
      getStatePromise = app.getState();
    } catch {
      if (eventVersion === capturedVersion) {
        initialStateFailed = true;
        resolveWhenReady();
        syncStateAndNotify();
      }
      return;
    }

    if (getStatePromise && typeof getStatePromise.then === "function") {
      getStatePromise
        .then((state) => {
          if (isDisposed) {
            return;
          }
          // 若在 getState 发起后已有更新事件（版本增加），则放弃旧查询结果
          if (eventVersion > capturedVersion) {
            return;
          }
          if (state && typeof state.isActive === "boolean") {
            nativeActive = state.isActive;
            nativeReady = true;
            initialStateFailed = false;
            resolveWhenReady();
            syncStateAndNotify();
          } else {
            initialStateFailed = true;
            resolveWhenReady();
            syncStateAndNotify();
          }
        })
        .catch(() => {
          if (isDisposed) {
            return;
          }
          // 有更晚事件到达时，旧 getState 失败不得回滚新事件建立的事实
          if (eventVersion > capturedVersion) {
            return;
          }
          initialStateFailed = true;
          resolveWhenReady();
          syncStateAndNotify();
        });
    }
  }

  // 1. 先安装 App.appStateChange 监听，真实注册成功前不调用 getState
  let addListenerPromise: Promise<{ remove(): Promise<void> }> | undefined;
  try {
    addListenerPromise = app.addListener("appStateChange", (state) => {
      handleAppStateChange(state);
    });
  } catch {
    registrationFailed = true;
    resolveWhenReady();
  }

  if (addListenerPromise && typeof addListenerPromise.then === "function") {
    addListenerPromise
      .then((handle) => {
        if (isDisposed) {
          // 在 dispose 后才 resolve 的句柄必须调用 remove 一次，且不读取 getState
          try {
            const removePromise = handle?.remove?.();
            if (removePromise && typeof removePromise.catch === "function") {
              removePromise.catch(() => {});
            }
          } catch {
            // 吞掉同步错误
          }
          return;
        }

        appListenerHandle = handle;
        nativeRegistered = true;

        // 若在注册 pending 期间已收到有效事件（例如先触发的 callback）
        if (eventVersion > 0 && nativeActive !== null) {
          nativeReady = true;
          resolveWhenReady();
          syncStateAndNotify();
        }

        // 真实注册成功后读取 App.getState
        fetchInitialGetState();
      })
      .catch(() => {
        // 注册失败保持关闭，不调用 getState，不泄漏未处理拒绝
        if (!isDisposed) {
          registrationFailed = true;
          nativeRegistered = false;
          nativeReady = false;
          resolveWhenReady();
          syncStateAndNotify();
        }
      });
  }

  return {
    get capabilities(): LifecycleCapabilities {
      return {
        webEvents: webAdapter.capabilities.webEvents,
        nativeAppState: Boolean(
          !isDisposed &&
          nativeRegistered &&
          !registrationFailed &&
          nativeReady &&
          !initialStateFailed,
        ),
      };
    },
    getSnapshot(): WebLifecycleSnapshot {
      if (!isDisposed) {
        currentVisibility = computeVisibility();
        currentOnline = webAdapter.getSnapshot().online;
      }
      return createSnapshotCopy();
    },
    subscribe(listener: (event: WebLifecycleEvent) => void): () => void {
      if (isDisposed) {
        return () => {};
      }

      const id = nextSubId++;
      const sub: Subscription = {
        id,
        listener,
        active: true,
      };
      subscriptions.set(id, sub);

      let unsubscribed = false;
      return () => {
        if (unsubscribed) {
          return;
        }
        unsubscribed = true;
        sub.active = false;
        subscriptions.delete(id);
      };
    },
    dispose(): void {
      if (isDisposed) {
        return;
      }
      isDisposed = true;

      resolveWhenReady();

      for (const sub of subscriptions.values()) {
        sub.active = false;
      }
      subscriptions.clear();

      try {
        unsubWeb();
      } catch {
        // swallow
      }
      try {
        webAdapter.dispose();
      } catch {
        // swallow
      }

      if (appListenerHandle) {
        try {
          const removePromise = appListenerHandle.remove();
          if (removePromise && typeof removePromise.catch === "function") {
            removePromise.catch(() => {});
          }
        } catch {
          // 吞掉同步 throw
        }
        appListenerHandle = null;
      }
    },
    whenReady(): Promise<void> {
      return whenReadyPromise;
    },
  };
}

/**
 * 创建统一生命周期适配器。
 * 遵循 CROSS_PLATFORM_NATIVE_LIFECYCLE.md 契约。
 */
export function createLifecycleAdapter(options?: LifecycleOptions): LifecycleAdapter {
  const resolvedPlatform =
    options?.platform ??
    detectPlatform({
      window: options?.webOptions?.window,
      navigator: options?.webOptions?.navigator as { userAgent?: string } | undefined,
    });

  if (resolvedPlatform !== "ios") {
    return createWebAdapterWrapper(options?.webOptions);
  }

  return createIosAppLifecycleAdapter(options?.app, options?.webOptions);
}
