export type WebLifecycleVisibility = "visible" | "hidden" | "unknown";

export interface WebLifecycleSnapshot {
  readonly visibility: WebLifecycleVisibility;
  readonly online: boolean | null;
}

export type WebLifecycleEventType = "suspend" | "resume" | "connectivity";

export interface WebLifecycleEvent {
  readonly type: WebLifecycleEventType;
  readonly snapshot: WebLifecycleSnapshot;
}

export interface WebLifecycleCapabilities {
  readonly webEvents: boolean;
  readonly nativeAppState: false;
}

export interface WebLifecycleAdapter {
  readonly capabilities: WebLifecycleCapabilities;
  getSnapshot(): WebLifecycleSnapshot;
  subscribe(listener: (event: WebLifecycleEvent) => void): () => void;
  dispose(): void;
}

export interface WebLifecycleOptions {
  window?: unknown;
  document?: unknown;
  navigator?: unknown;
}

interface EventTargetLike {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

interface DocumentLike extends EventTargetLike {
  visibilityState?: string;
}

interface NavigatorLike {
  onLine?: boolean;
}

function resolveVisibility(doc?: DocumentLike | null): WebLifecycleVisibility {
  const state = doc?.visibilityState;
  if (state === "visible" || state === "hidden") {
    return state;
  }
  return "unknown";
}

function resolveOnline(nav?: NavigatorLike | null): boolean | null {
  if (typeof nav?.onLine === "boolean") {
    return nav.onLine;
  }
  return null;
}

function isEventTarget(obj: unknown): obj is EventTargetLike {
  return (
    typeof obj === "object" &&
    obj !== null &&
    typeof (obj as EventTargetLike).addEventListener === "function" &&
    typeof (obj as EventTargetLike).removeEventListener === "function"
  );
}

interface Subscription {
  readonly id: number;
  readonly listener: (event: WebLifecycleEvent) => void;
  active: boolean;
}

/**
 * 创建 Web 生命周期薄适配器。
 * 遵循 CROSS_PLATFORM_LIFECYCLE.md 契约。
 */
export function createWebLifecycleAdapter(options?: WebLifecycleOptions): WebLifecycleAdapter {
  const hasWindowOption = options !== undefined && "window" in options;
  const targetWindow = hasWindowOption
    ? isEventTarget(options.window)
      ? (options.window as EventTargetLike)
      : null
    : typeof window !== "undefined" && isEventTarget(window)
      ? (window as unknown as EventTargetLike)
      : null;

  const hasDocumentOption = options !== undefined && "document" in options;
  const targetDocument = hasDocumentOption
    ? isEventTarget(options.document)
      ? (options.document as DocumentLike)
      : null
    : typeof document !== "undefined" && isEventTarget(document)
      ? (document as unknown as DocumentLike)
      : null;

  const hasNavigatorOption = options !== undefined && "navigator" in options;
  const targetNavigator = hasNavigatorOption
    ? (options.navigator as NavigatorLike | null)
    : typeof navigator !== "undefined"
      ? (navigator as unknown as NavigatorLike)
      : null;

  const hasWebEvents = Boolean(targetWindow && targetDocument);

  let currentVisibility: WebLifecycleVisibility = hasWebEvents
    ? resolveVisibility(targetDocument)
    : "unknown";

  let currentOnline: boolean | null = hasWebEvents ? resolveOnline(targetNavigator) : null;

  let isDisposed = false;
  let isListening = false;
  let nextSubId = 1;

  const subscriptions = new Map<number, Subscription>();

  function syncCurrentStateFromEnvironment() {
    if (!hasWebEvents || isDisposed) {
      return;
    }
    currentVisibility = resolveVisibility(targetDocument);
    currentOnline = resolveOnline(targetNavigator);
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
        // 单个 listener 抛错不能阻止其他 listener 与清理
      }
    }
  }

  const handleVisibilityChange = () => {
    if (isDisposed) return;
    const nextVisibility = resolveVisibility(targetDocument);
    if (nextVisibility !== currentVisibility) {
      currentVisibility = nextVisibility;
      if (currentVisibility === "visible") {
        notify("resume");
      } else if (currentVisibility === "hidden") {
        notify("suspend");
      }
    }
  };

  const handleOnline = () => {
    if (isDisposed) return;
    if (currentOnline !== true) {
      currentOnline = true;
      notify("connectivity");
    }
  };

  const handleOffline = () => {
    if (isDisposed) return;
    if (currentOnline !== false) {
      currentOnline = false;
      notify("connectivity");
    }
  };

  const handlePageShow = () => {
    if (isDisposed) return;
    currentVisibility = resolveVisibility(targetDocument);
    notify("resume");
  };

  const handlePageHide = () => {
    if (isDisposed) return;
    currentVisibility = "hidden";
    notify("suspend");
  };

  function attachListeners() {
    if (isListening || !hasWebEvents || !targetWindow || !targetDocument) {
      return;
    }
    syncCurrentStateFromEnvironment();
    targetDocument.addEventListener("visibilitychange", handleVisibilityChange);
    targetWindow.addEventListener("online", handleOnline);
    targetWindow.addEventListener("offline", handleOffline);
    targetWindow.addEventListener("pageshow", handlePageShow);
    targetWindow.addEventListener("pagehide", handlePageHide);
    isListening = true;
  }

  function detachListeners() {
    if (!isListening || !hasWebEvents || !targetWindow || !targetDocument) {
      return;
    }
    targetDocument.removeEventListener("visibilitychange", handleVisibilityChange);
    targetWindow.removeEventListener("online", handleOnline);
    targetWindow.removeEventListener("offline", handleOffline);
    targetWindow.removeEventListener("pageshow", handlePageShow);
    targetWindow.removeEventListener("pagehide", handlePageHide);
    isListening = false;
  }

  return {
    capabilities: {
      webEvents: hasWebEvents,
      nativeAppState: false,
    },
    getSnapshot(): WebLifecycleSnapshot {
      if (!isListening) {
        syncCurrentStateFromEnvironment();
      }
      return createSnapshotCopy();
    },
    subscribe(listener: (event: WebLifecycleEvent) => void): () => void {
      if (isDisposed || !hasWebEvents) {
        return () => {};
      }

      const id = nextSubId++;
      const sub: Subscription = {
        id,
        listener,
        active: true,
      };
      subscriptions.set(id, sub);

      if (subscriptions.size === 1) {
        attachListeners();
      }

      let unsubscribed = false;
      return () => {
        if (unsubscribed) {
          return;
        }
        unsubscribed = true;
        sub.active = false;
        subscriptions.delete(id);

        if (subscriptions.size === 0 && !isDisposed) {
          detachListeners();
        }
      };
    },
    dispose(): void {
      if (isDisposed) {
        return;
      }
      isDisposed = true;
      for (const sub of subscriptions.values()) {
        sub.active = false;
      }
      subscriptions.clear();
      detachListeners();
    },
  };
}
