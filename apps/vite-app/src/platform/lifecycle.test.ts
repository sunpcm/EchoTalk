import { describe, expect, it, vi } from "vitest";
import { type AppStateSource, createLifecycleAdapter } from "./lifecycle";
import type { WebLifecycleEvent, WebLifecycleOptions } from "./webLifecycle";

interface MockListener {
  (event: unknown): void;
}

class MockEventTarget {
  private listeners: Map<string, Set<MockListener>> = new Map();

  addEventListener(type: string, listener: MockListener): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: MockListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, eventData: unknown = {}): void {
    const list = Array.from(this.listeners.get(type) ?? []);
    for (const listener of list) {
      listener(eventData);
    }
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  totalListeners(): number {
    let count = 0;
    for (const set of this.listeners.values()) {
      count += set.size;
    }
    return count;
  }
}

class MockDocument extends MockEventTarget {
  visibilityState: string = "visible";
}

class MockWindow extends MockEventTarget {}

function createMockEnvironment(overrides?: { visibilityState?: string; onLine?: boolean | null }) {
  const mockDoc = new MockDocument();
  mockDoc.visibilityState = overrides?.visibilityState ?? "visible";

  const mockWin = new MockWindow();

  const mockNav = {
    onLine: overrides?.onLine !== undefined ? overrides.onLine : true,
  };

  const options: WebLifecycleOptions = {
    window: mockWin,
    document: mockDoc,
    navigator: mockNav,
  };

  return {
    mockDoc,
    mockWin,
    mockNav,
    options,
  };
}

class Deferred<T> {
  readonly promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;
  reject!: (reason?: unknown) => void;

  constructor() {
    this.promise = new Promise<T>((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
  }
}

interface MockAppStatePlugin {
  app: AppStateSource;
  addListenerDeferred: Deferred<{ remove(): Promise<void> }>;
  getStateDeferred: Deferred<{ isActive: boolean }>;
  triggerStateChange(state: { isActive: boolean }): void;
  removeCalls: number;
}

function createMockAppSource(initialActive = true): MockAppStatePlugin {
  let appStateListener: ((state: { isActive: boolean }) => void) | null = null;
  const addListenerDeferred = new Deferred<{ remove(): Promise<void> }>();
  const getStateDeferred = new Deferred<{ isActive: boolean }>();
  let removeCalls = 0;

  const handle = {
    remove: vi.fn(async () => {
      removeCalls++;
    }),
  };

  const app: AppStateSource = {
    getState: vi.fn(() => getStateDeferred.promise),
    addListener: vi.fn(
      async (eventName: string, callback: (state: { isActive: boolean }) => void) => {
        if (eventName === "appStateChange") {
          appStateListener = callback;
        }
        return addListenerDeferred.promise;
      },
    ),
  };

  // 默认自解析为初始活跃状态
  addListenerDeferred.resolve(handle);
  getStateDeferred.resolve({ isActive: initialActive });

  return {
    app,
    addListenerDeferred,
    getStateDeferred,
    triggerStateChange(state: { isActive: boolean }) {
      appStateListener?.(state);
    },
    get removeCalls() {
      return removeCalls;
    },
  };
}

describe("LifecycleAdapter (Unified & iOS Native)", () => {
  describe("平台选择与无导入副作用", () => {
    it("非 iOS 平台（web, android, macos, windows）降级走 Web 适配器，whenReady 立即完成", async () => {
      const platforms: Array<"web" | "android" | "macos" | "windows"> = [
        "web",
        "android",
        "macos",
        "windows",
      ];

      for (const p of platforms) {
        const { options } = createMockEnvironment({ visibilityState: "visible", onLine: true });
        const adapter = createLifecycleAdapter({
          platform: p,
          webOptions: options,
        });

        expect(adapter.capabilities).toEqual({
          webEvents: true,
          nativeAppState: false,
        });

        await expect(adapter.whenReady()).resolves.toBeUndefined();

        const snap = adapter.getSnapshot();
        expect(snap).toEqual({
          visibility: "visible",
          online: true,
        });

        adapter.dispose();
      }
    });

    it("检测到 Capacitor iOS 时激活 iOS 原生生命周期适配器", async () => {
      const mockWin = {
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => "ios",
        },
      };

      const mockDoc = new MockDocument();
      mockDoc.visibilityState = "visible";

      const mockApp = createMockAppSource(true);

      const adapter = createLifecycleAdapter({
        webOptions: {
          window: mockWin,
          document: mockDoc,
          navigator: { onLine: true },
        },
        app: mockApp.app,
      });

      await adapter.whenReady();
      expect(adapter.capabilities.nativeAppState).toBe(true);

      adapter.dispose();
    });
  });

  describe("初始就绪状态与能力门禁", () => {
    it("就绪前 nativeAppState 为 false，visibility 保守为 hidden", async () => {
      const { options } = createMockEnvironment({ visibilityState: "visible" });
      const addListenerDeferred = new Deferred<{ remove(): Promise<void> }>();
      const getStateDeferred = new Deferred<{ isActive: boolean }>();

      const app: AppStateSource = {
        getState: vi.fn(() => getStateDeferred.promise),
        addListener: vi.fn(async () => addListenerDeferred.promise),
      };

      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app,
      });

      // 初始化尚未完成时
      expect(adapter.capabilities.nativeAppState).toBe(false);
      expect(adapter.getSnapshot().visibility).toBe("hidden");

      // 完成注册与获取状态
      const handle = { remove: vi.fn(async () => {}) };
      addListenerDeferred.resolve(handle);
      getStateDeferred.resolve({ isActive: true });

      await adapter.whenReady();

      expect(adapter.capabilities.nativeAppState).toBe(true);
      expect(adapter.getSnapshot().visibility).toBe("visible");

      adapter.dispose();
    });

    it("每次 getSnapshot 返回防御性拷贝，防止外部篡改", async () => {
      const { options } = createMockEnvironment({ visibilityState: "visible" });
      const mockApp = createMockAppSource(true);
      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app: mockApp.app,
      });

      await adapter.whenReady();
      const snap1 = adapter.getSnapshot();
      (snap1 as { visibility: string }).visibility = "hidden";

      const snap2 = adapter.getSnapshot();
      expect(snap2.visibility).toBe("visible");

      adapter.dispose();
    });
  });

  describe("原生与 Web 保守交集及状态流转", () => {
    it("原生 active 且 Web visible 时才呈现 visible 并派发 resume", async () => {
      const { options } = createMockEnvironment({ visibilityState: "visible" });
      const mockApp = createMockAppSource(true);
      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app: mockApp.app,
      });

      const events: WebLifecycleEvent[] = [];
      adapter.subscribe((e) => events.push(e));

      await adapter.whenReady();

      // 初始就绪由 hidden -> visible，应派发 resume
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "resume",
        snapshot: { visibility: "visible", online: true },
      });

      adapter.dispose();
    });

    it("原生 active 时若 DOM 处于 hidden，直到 DOM 恢复 visible 才 resume", async () => {
      const { mockDoc, options } = createMockEnvironment({ visibilityState: "hidden" });
      const mockApp = createMockAppSource(true);
      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app: mockApp.app,
      });

      const events: WebLifecycleEvent[] = [];
      adapter.subscribe((e) => events.push(e));

      await adapter.whenReady();

      // 原生 active 但 DOM hidden -> 最终 visibility 为 hidden，不触发 resume
      expect(events).toHaveLength(0);
      expect(adapter.getSnapshot().visibility).toBe("hidden");

      // DOM 变为 visible
      mockDoc.visibilityState = "visible";
      mockDoc.dispatch("visibilitychange");

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "resume",
        snapshot: { visibility: "visible", online: true },
      });

      adapter.dispose();
    });

    it("原生 inactive 时 DOM pageshow / visibilitychange visible 不得恢复", async () => {
      const { mockDoc, mockWin, options } = createMockEnvironment({ visibilityState: "visible" });
      const mockApp = createMockAppSource(false); // 初始原生后台
      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app: mockApp.app,
      });

      const events: WebLifecycleEvent[] = [];
      adapter.subscribe((e) => events.push(e));

      await adapter.whenReady();
      expect(adapter.getSnapshot().visibility).toBe("hidden");
      expect(events).toHaveLength(0);

      // DOM 触发 visibilitychange 或 pageshow
      mockDoc.dispatch("visibilitychange");
      mockWin.dispatch("pageshow");

      // 依然保持 hidden，不可恢复 resume
      expect(events).toHaveLength(0);
      expect(adapter.getSnapshot().visibility).toBe("hidden");

      adapter.dispose();
    });

    it("DOM hidden / pagehide 或原生 inactive 均立即 suspend，并合并重复状态", async () => {
      const { mockWin, options } = createMockEnvironment({ visibilityState: "visible" });
      const mockApp = createMockAppSource(true);
      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app: mockApp.app,
      });

      const events: WebLifecycleEvent[] = [];
      adapter.subscribe((e) => events.push(e));

      await adapter.whenReady();
      expect(events).toHaveLength(1); // 首次 resume
      expect(events[0].type).toBe("resume");

      // 原生切到后台 -> 触发 suspend
      mockApp.triggerStateChange({ isActive: false });
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({
        type: "suspend",
        snapshot: { visibility: "hidden", online: true },
      });

      // 再次派发原生后台事件（同值） -> 去重，不重复发 suspend
      mockApp.triggerStateChange({ isActive: false });
      expect(events).toHaveLength(2);

      // DOM 此时触发 pagehide -> 已经处于 hidden，去重不重复发 suspend
      mockWin.dispatch("pagehide");
      expect(events).toHaveLength(2);

      adapter.dispose();
    });

    it("Web online / offline 只派发 connectivity，不覆盖原生后台事实", async () => {
      const { mockWin, options } = createMockEnvironment({
        visibilityState: "visible",
        onLine: true,
      });
      const mockApp = createMockAppSource(false); // 原生后台
      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app: mockApp.app,
      });

      const events: WebLifecycleEvent[] = [];
      adapter.subscribe((e) => events.push(e));

      await adapter.whenReady();
      expect(events).toHaveLength(0);

      // Web 掉线
      mockWin.dispatch("offline");
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "connectivity",
        snapshot: { visibility: "hidden", online: false },
      });

      // Web 重新联网
      mockWin.dispatch("online");
      expect(events).toHaveLength(2);
      expect(events[1]).toEqual({
        type: "connectivity",
        snapshot: { visibility: "hidden", online: true },
      });

      // 即使 online，visibility 仍为原生后台的 hidden
      expect(adapter.getSnapshot().visibility).toBe("hidden");

      adapter.dispose();
    });
  });

  describe("getState 与 appStateChange 竞态控制", () => {
    it("有效新事件优先于早先 getState（包括同值），旧 getState 不能覆盖或重复触发", async () => {
      const { options } = createMockEnvironment({ visibilityState: "visible" });
      const addListenerDeferred = new Deferred<{ remove(): Promise<void> }>();
      const getStateDeferred = new Deferred<{ isActive: boolean }>();
      let listenerCallback: ((state: { isActive: boolean }) => void) | null = null;

      const app: AppStateSource = {
        getState: vi.fn(() => getStateDeferred.promise),
        addListener: vi.fn(async (_evt, cb) => {
          listenerCallback = cb;
          return addListenerDeferred.promise;
        }),
      };

      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app,
      });

      const events: WebLifecycleEvent[] = [];
      adapter.subscribe((e) => events.push(e));

      // 1. 注册成功
      addListenerDeferred.resolve({ remove: vi.fn(async () => {}) });
      await Promise.resolve();

      // 2. 在 getState 完成前，新的原生事件先到达 (isActive: true)
      listenerCallback!({ isActive: true });

      // whenReady 应立即完成
      await adapter.whenReady();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("resume");

      // 3. 稍后迟到的 getState 返回同值 { isActive: true }
      getStateDeferred.resolve({ isActive: true });
      await Promise.resolve();

      // 不能重复触发 resume
      expect(events).toHaveLength(1);

      // 4. 若 getState 迟到返回不同值 { isActive: false }，旧 getState 也不得回滚已有事件
      const getStateDeferred2 = new Deferred<{ isActive: boolean }>();
      app.getState = vi.fn(() => getStateDeferred2.promise);

      getStateDeferred2.resolve({ isActive: false });
      await Promise.resolve();

      // 状态依然是有效事件建立的 visible，没有被旧 getState 回滚
      expect(adapter.getSnapshot().visibility).toBe("visible");
      expect(events).toHaveLength(1);

      adapter.dispose();
    });

    it("有效已注册的新事件可使挂起的 getState 不再阻塞 whenReady", async () => {
      const { options } = createMockEnvironment({ visibilityState: "visible" });
      const addListenerDeferred = new Deferred<{ remove(): Promise<void> }>();
      // 永久挂起的 getState
      const getStateDeferred = new Deferred<{ isActive: boolean }>();
      let listenerCallback: ((state: { isActive: boolean }) => void) | null = null;

      const app: AppStateSource = {
        getState: vi.fn(() => getStateDeferred.promise),
        addListener: vi.fn((_evt, cb) => {
          listenerCallback = cb;
          return addListenerDeferred.promise;
        }),
      };

      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app,
      });

      // 注册完成
      addListenerDeferred.resolve({ remove: vi.fn(async () => {}) });
      await new Promise((r) => setTimeout(r, 10));

      // 触发新事件
      listenerCallback!({ isActive: true });

      // whenReady 不会被挂起的 getState 阻塞
      await adapter.whenReady();
      expect(adapter.getSnapshot().visibility).toBe("visible");

      adapter.dispose();
    });

    it("有效新事件建立事实后，旧 getState 迟到 reject 不能回滚它，亦不泄漏未处理拒绝", async () => {
      const { options } = createMockEnvironment({ visibilityState: "visible" });
      const addListenerDeferred = new Deferred<{ remove(): Promise<void> }>();
      const getStateDeferred = new Deferred<{ isActive: boolean }>();
      let listenerCallback: ((state: { isActive: boolean }) => void) | null = null;

      const app: AppStateSource = {
        getState: vi.fn(() => getStateDeferred.promise),
        addListener: vi.fn((_evt, cb) => {
          listenerCallback = cb;
          return addListenerDeferred.promise;
        }),
      };

      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app,
      });

      addListenerDeferred.resolve({ remove: vi.fn(async () => {}) });
      await new Promise((r) => setTimeout(r, 10));

      // 触发新事件建立事实
      listenerCallback!({ isActive: true });
      await adapter.whenReady();
      expect(adapter.capabilities.nativeAppState).toBe(true);

      // 旧 getState 拒绝
      getStateDeferred.reject(new Error("getState network error"));
      await new Promise((r) => setTimeout(r, 10));

      // 不回滚已建立的事实
      expect(adapter.capabilities.nativeAppState).toBe(true);
      expect(adapter.getSnapshot().visibility).toBe("visible");

      adapter.dispose();
    });
  });

  describe("失败与安全降级", () => {
    it("addListener 注册失败时保持关闭，whenReady 正常结束，不宣称原生能力", async () => {
      const { options } = createMockEnvironment({ visibilityState: "visible" });
      const addListenerDeferred = new Deferred<{ remove(): Promise<void> }>();

      const app: AppStateSource = {
        getState: vi.fn(async () => ({ isActive: true })),
        addListener: vi.fn(async () => addListenerDeferred.promise),
      };

      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app,
      });

      addListenerDeferred.reject(new Error("Plugin not available"));

      await adapter.whenReady();

      expect(adapter.capabilities.nativeAppState).toBe(false);
      expect(adapter.getSnapshot().visibility).toBe("hidden");

      adapter.dispose();
    });

    it("addListener 同步抛错时安全捕获并保持关闭", async () => {
      const { options } = createMockEnvironment();
      const app: AppStateSource = {
        getState: vi.fn(async () => ({ isActive: true })),
        addListener: vi.fn(() => {
          throw new Error("Sync addListener error");
        }),
      };

      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app,
      });

      await adapter.whenReady();

      expect(adapter.capabilities.nativeAppState).toBe(false);
      expect(adapter.getSnapshot().visibility).toBe("hidden");

      adapter.dispose();
    });

    it("getState 失败且无有效新事件时保持关闭", async () => {
      const { options } = createMockEnvironment({ visibilityState: "visible" });
      const addListenerDeferred = new Deferred<{ remove(): Promise<void> }>();
      const getStateDeferred = new Deferred<{ isActive: boolean }>();

      const app: AppStateSource = {
        getState: vi.fn(() => getStateDeferred.promise),
        addListener: vi.fn(async () => addListenerDeferred.promise),
      };

      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app,
      });

      addListenerDeferred.resolve({ remove: vi.fn(async () => {}) });
      getStateDeferred.reject(new Error("State unavailable"));

      await adapter.whenReady();

      expect(adapter.capabilities.nativeAppState).toBe(false);
      expect(adapter.getSnapshot().visibility).toBe("hidden");

      adapter.dispose();
    });
  });

  describe("生命周期释放与迟到句柄清理", () => {
    it("dispose 释放原生句柄且幂等，不调用全局 removeAllListeners", async () => {
      const { options } = createMockEnvironment();
      const mockApp = createMockAppSource(true);

      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app: mockApp.app,
      });

      await adapter.whenReady();
      expect(mockApp.removeCalls).toBe(0);

      adapter.dispose();
      expect(mockApp.removeCalls).toBe(1);

      // 重复 dispose 幂等
      adapter.dispose();
      expect(mockApp.removeCalls).toBe(1);
    });

    it("addListener 的 Promise 在 dispose 后才 resolve 必须调用 handle.remove 一次", async () => {
      const { options } = createMockEnvironment();
      const addListenerDeferred = new Deferred<{ remove(): Promise<void> }>();
      const removeFn = vi.fn(async () => {});

      const app: AppStateSource = {
        getState: vi.fn(async () => ({ isActive: true })),
        addListener: vi.fn(async () => addListenerDeferred.promise),
      };

      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app,
      });

      // 在 handle 返回前提前 dispose
      adapter.dispose();
      expect(removeFn).not.toHaveBeenCalled();

      // 稍后 handle 才 resolve
      addListenerDeferred.resolve({ remove: removeFn });
      await new Promise((r) => setTimeout(r, 10));

      expect(removeFn).toHaveBeenCalledTimes(1);
    });

    it("未完成的 whenReady 在 dispose 后应结束等待", async () => {
      const { options } = createMockEnvironment();
      const addListenerDeferred = new Deferred<{ remove(): Promise<void> }>();
      const getStateDeferred = new Deferred<{ isActive: boolean }>();

      const app: AppStateSource = {
        getState: vi.fn(() => getStateDeferred.promise),
        addListener: vi.fn(async () => addListenerDeferred.promise),
      };

      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app,
      });

      let ready = false;
      adapter.whenReady().then(() => {
        ready = true;
      });

      expect(ready).toBe(false);
      adapter.dispose();

      await Promise.resolve();
      expect(ready).toBe(true);
    });

    it("dispose 后排队的旧 callback / getState 不得复活实例或改变快照", async () => {
      const { options } = createMockEnvironment();
      const holder: { listenerCb?: (state: { isActive: boolean }) => void } = {};
      const getStateDeferred = new Deferred<{ isActive: boolean }>();

      const app: AppStateSource = {
        getState: vi.fn(() => getStateDeferred.promise),
        addListener: vi.fn(async (_evt, cb) => {
          holder.listenerCb = cb;
          return { remove: vi.fn(async () => {}) };
        }),
      };

      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app,
      });

      adapter.dispose();

      // 迟到的 callback
      holder.listenerCb?.({ isActive: true });
      expect(adapter.getSnapshot().visibility).toBe("hidden");

      // 迟到的 getState
      getStateDeferred.resolve({ isActive: true });
      await Promise.resolve();
      expect(adapter.getSnapshot().visibility).toBe("hidden");
    });

    it("dispose 后新订阅为安全空操作", async () => {
      const { options } = createMockEnvironment();
      const mockApp = createMockAppSource(true);
      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app: mockApp.app,
      });

      adapter.dispose();

      const listener = vi.fn();
      const unsub = adapter.subscribe(listener);
      unsub();

      mockApp.triggerStateChange({ isActive: true });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("订阅管理与错误隔离", () => {
    it("单个 listener 抛错不妨碍其他 listener 执行", async () => {
      const { options } = createMockEnvironment({ visibilityState: "visible" });
      const mockApp = createMockAppSource(true);
      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app: mockApp.app,
      });

      await adapter.whenReady();

      const faultyListener = vi.fn(() => {
        throw new Error("Listener crash");
      });
      const healthyListener = vi.fn();

      adapter.subscribe(faultyListener);
      adapter.subscribe(healthyListener);

      expect(() => {
        mockApp.triggerStateChange({ isActive: false });
      }).not.toThrow();

      expect(faultyListener).toHaveBeenCalledTimes(1);
      expect(healthyListener).toHaveBeenCalledTimes(1);

      adapter.dispose();
    });

    it("在分发过程中退订的 listener 不接收当前后续事件", async () => {
      const { options } = createMockEnvironment({ visibilityState: "visible" });
      const mockApp = createMockAppSource(true);
      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app: mockApp.app,
      });

      await adapter.whenReady();

      const subRef: { unsub?: () => void } = {};
      const firstListener = vi.fn(() => {
        subRef.unsub?.();
      });
      const secondListener = vi.fn();

      adapter.subscribe(firstListener);
      subRef.unsub = adapter.subscribe(secondListener);

      mockApp.triggerStateChange({ isActive: false });

      expect(firstListener).toHaveBeenCalledTimes(1);
      expect(secondListener).not.toHaveBeenCalled();

      adapter.dispose();
    });

    it("在分发过程中调用 dispose 立即终止后续 listener 派发", async () => {
      const { options } = createMockEnvironment({ visibilityState: "visible" });
      const mockApp = createMockAppSource(true);
      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app: mockApp.app,
      });

      await adapter.whenReady();

      const firstListener = vi.fn(() => {
        adapter.dispose();
      });
      const secondListener = vi.fn();

      adapter.subscribe(firstListener);
      adapter.subscribe(secondListener);

      mockApp.triggerStateChange({ isActive: false });

      expect(firstListener).toHaveBeenCalledTimes(1);
      expect(secondListener).not.toHaveBeenCalled();
    });

    it("最后一个 subscriber 退出后仍维护快照，直到 dispose 才释放句柄", async () => {
      const { options } = createMockEnvironment({ visibilityState: "visible" });
      const mockApp = createMockAppSource(true);
      const adapter = createLifecycleAdapter({
        platform: "ios",
        webOptions: options,
        app: mockApp.app,
      });

      await adapter.whenReady();

      const listener = vi.fn();
      const unsub = adapter.subscribe(listener);

      // 退订
      unsub();
      // 退订后句柄未释放
      expect(mockApp.removeCalls).toBe(0);

      // 原生状态更新依然影响快照
      mockApp.triggerStateChange({ isActive: false });
      expect(adapter.getSnapshot().visibility).toBe("hidden");

      // 显式 dispose 才释放
      adapter.dispose();
      expect(mockApp.removeCalls).toBe(1);
    });

    it("独立实例间互不干扰", async () => {
      const { options: env1 } = createMockEnvironment({ visibilityState: "visible" });
      const { options: env2 } = createMockEnvironment({ visibilityState: "visible" });

      const app1 = createMockAppSource(true);
      const app2 = createMockAppSource(false);

      const adapter1 = createLifecycleAdapter({ platform: "ios", webOptions: env1, app: app1.app });
      const adapter2 = createLifecycleAdapter({ platform: "ios", webOptions: env2, app: app2.app });

      await Promise.all([adapter1.whenReady(), adapter2.whenReady()]);

      expect(adapter1.getSnapshot().visibility).toBe("visible");
      expect(adapter2.getSnapshot().visibility).toBe("hidden");

      adapter1.dispose();
      expect(app1.removeCalls).toBe(1);
      expect(app2.removeCalls).toBe(0);

      expect(adapter2.getSnapshot().visibility).toBe("hidden");
      adapter2.dispose();
      expect(app2.removeCalls).toBe(1);
    });
  });

  describe("NAT-01 与 NAT-02 专项目标回归 (r1 集中关闭)", () => {
    describe("NAT-01: 注册先后、pending 回调隔离与迟到 handle", () => {
      it("先完成 addListener 注册后才发起 getState 读取", async () => {
        const { options } = createMockEnvironment({ visibilityState: "visible" });
        const addListenerDeferred = new Deferred<{ remove(): Promise<void> }>();
        const getStateDeferred = new Deferred<{ isActive: boolean }>();

        const getStateFn = vi.fn(() => getStateDeferred.promise);
        const addListenerFn = vi.fn(() => addListenerDeferred.promise);

        const app: AppStateSource = {
          getState: getStateFn,
          addListener: addListenerFn,
        };

        const adapter = createLifecycleAdapter({
          platform: "ios",
          webOptions: options,
          app,
        });

        // 此时 addListener 已被调用，但其 Promise 尚未 resolve
        expect(addListenerFn).toHaveBeenCalledTimes(1);
        expect(getStateFn).not.toHaveBeenCalled();

        // 稍后注册成功 resolve
        addListenerDeferred.resolve({ remove: vi.fn(async () => {}) });
        await new Promise((r) => setTimeout(r, 10));

        // 真实注册成功后方才发起 getState
        expect(getStateFn).toHaveBeenCalledTimes(1);

        getStateDeferred.resolve({ isActive: true });
        await adapter.whenReady();
        expect(adapter.capabilities.nativeAppState).toBe(true);

        adapter.dispose();
      });

      it("在 addListener pending 期间捕获 callback 随后 reject 时，不开放能力亦不调用 getState", async () => {
        const { options } = createMockEnvironment({ visibilityState: "visible" });
        const addListenerDeferred = new Deferred<{ remove(): Promise<void> }>();
        const getStateFn = vi.fn(async () => ({ isActive: true }));
        let capturedCallback: ((state: { isActive: boolean }) => void) | null = null;

        const app: AppStateSource = {
          getState: getStateFn,
          addListener: vi.fn((_evt, cb) => {
            capturedCallback = cb;
            return addListenerDeferred.promise;
          }),
        };

        const adapter = createLifecycleAdapter({
          platform: "ios",
          webOptions: options,
          app,
        });

        // 在注册尚未 settle 时触发提前 callback
        capturedCallback!({ isActive: true });

        // 注册尚在 pending，不可宣称原生能力或 visible
        expect(adapter.capabilities.nativeAppState).toBe(false);
        expect(adapter.getSnapshot().visibility).toBe("hidden");
        expect(getStateFn).not.toHaveBeenCalled();

        // 随后注册发生 reject 失败
        addListenerDeferred.reject(new Error("Registration failed"));

        // whenReady 结束等待
        await adapter.whenReady();

        // 保持关闭，严禁开放原生能力或 visible 状态，且不发起 getState
        expect(adapter.capabilities.nativeAppState).toBe(false);
        expect(adapter.getSnapshot().visibility).toBe("hidden");
        expect(getStateFn).not.toHaveBeenCalled();

        adapter.dispose();
      });

      it("dispose 后迟到的 addListener handle 仅执行 remove 一次且绝不发起 getState", async () => {
        const { options } = createMockEnvironment({ visibilityState: "visible" });
        const addListenerDeferred = new Deferred<{ remove(): Promise<void> }>();
        const getStateFn = vi.fn(async () => ({ isActive: true }));
        const removeFn = vi.fn(async () => {});

        const app: AppStateSource = {
          getState: getStateFn,
          addListener: vi.fn(async () => addListenerDeferred.promise),
        };

        const adapter = createLifecycleAdapter({
          platform: "ios",
          webOptions: options,
          app,
        });

        // 注册尚未 resolve 时立即 dispose
        adapter.dispose();
        expect(getStateFn).not.toHaveBeenCalled();
        expect(removeFn).not.toHaveBeenCalled();

        // 迟到的 handle resolve
        addListenerDeferred.resolve({ remove: removeFn });
        await new Promise((r) => setTimeout(r, 10));

        // 仅调用 remove 一次，且绝不发起 getState
        expect(removeFn).toHaveBeenCalledTimes(1);
        expect(getStateFn).not.toHaveBeenCalled();
      });

      it("成功注册后新事件优先于挂起的 getState 并立即结束 whenReady 等待", async () => {
        const { options } = createMockEnvironment({ visibilityState: "visible" });
        const addListenerDeferred = new Deferred<{ remove(): Promise<void> }>();
        const getStateDeferred = new Deferred<{ isActive: boolean }>();
        let capturedCallback: ((state: { isActive: boolean }) => void) | null = null;

        const app: AppStateSource = {
          getState: vi.fn(() => getStateDeferred.promise),
          addListener: vi.fn((_evt, cb) => {
            capturedCallback = cb;
            return addListenerDeferred.promise;
          }),
        };

        const adapter = createLifecycleAdapter({
          platform: "ios",
          webOptions: options,
          app,
        });

        // 1. 注册成功
        addListenerDeferred.resolve({ remove: vi.fn(async () => {}) });
        await new Promise((r) => setTimeout(r, 10));

        // 2. getState 处于挂起等待状态，此时到达新事件
        capturedCallback!({ isActive: true });

        // whenReady 不再被挂起的 getState 阻塞
        await adapter.whenReady();
        expect(adapter.capabilities.nativeAppState).toBe(true);
        expect(adapter.getSnapshot().visibility).toBe("visible");

        // 挂起的 getState 迟到 reject 也不回滚
        getStateDeferred.reject(new Error("Late rejection"));
        await new Promise((r) => setTimeout(r, 10));

        expect(adapter.capabilities.nativeAppState).toBe(true);
        expect(adapter.getSnapshot().visibility).toBe("visible");

        adapter.dispose();
      });
    });

    describe("NAT-02: 原生 active 与 Web unknown 保守交集", () => {
      it("显式 unknown DOM (如无 document 或 SSR) 下有效原生 active 应呈现 visible", async () => {
        const mockApp = createMockAppSource(true);
        const adapter = createLifecycleAdapter({
          platform: "ios",
          webOptions: {
            window: undefined,
            document: undefined,
            navigator: undefined,
          },
          app: mockApp.app,
        });

        await adapter.whenReady();

        expect(adapter.capabilities.nativeAppState).toBe(true);
        // Web visibility 为 unknown（非 hidden），原生 active，按保守交集应为 visible
        expect(adapter.getSnapshot().visibility).toBe("visible");

        adapter.dispose();
      });

      it("显式 unknown DOM 下原生 inactive 应保持 hidden", async () => {
        const mockApp = createMockAppSource(false);
        const adapter = createLifecycleAdapter({
          platform: "ios",
          webOptions: {
            window: undefined,
            document: undefined,
            navigator: undefined,
          },
          app: mockApp.app,
        });

        await adapter.whenReady();

        expect(adapter.capabilities.nativeAppState).toBe(true);
        expect(adapter.getSnapshot().visibility).toBe("hidden");

        adapter.dispose();
      });

      it("显式 hidden DOM 下即使原生 active 依然保持 hidden", async () => {
        const { options } = createMockEnvironment({ visibilityState: "hidden" });
        const mockApp = createMockAppSource(true);
        const adapter = createLifecycleAdapter({
          platform: "ios",
          webOptions: options,
          app: mockApp.app,
        });

        await adapter.whenReady();

        expect(adapter.capabilities.nativeAppState).toBe(true);
        expect(adapter.getSnapshot().visibility).toBe("hidden");

        adapter.dispose();
      });

      it("保留 Web 平台原有 unknown 语义不变", async () => {
        const adapter = createLifecycleAdapter({
          platform: "web",
          webOptions: {
            window: undefined,
            document: undefined,
            navigator: undefined,
          },
        });

        await adapter.whenReady();

        expect(adapter.capabilities.nativeAppState).toBe(false);
        expect(adapter.getSnapshot().visibility).toBe("unknown");

        adapter.dispose();
      });
    });

    describe("NAT-03: 事件与 getState 调用相对先后时序与代际绑定", () => {
      it("注册 pending 时的 callback({isActive:true}) 早于 getState 发起，随后返回 {isActive:false} 的较新状态必须生效最终呈现 hidden", async () => {
        const { options } = createMockEnvironment({ visibilityState: "visible" });
        const addListenerDeferred = new Deferred<{ remove(): Promise<void> }>();
        const getStateDeferred = new Deferred<{ isActive: boolean }>();
        let capturedCallback: ((state: { isActive: boolean }) => void) | null = null;

        const app: AppStateSource = {
          getState: vi.fn(() => getStateDeferred.promise),
          addListener: vi.fn((_evt, cb) => {
            capturedCallback = cb;
            return addListenerDeferred.promise;
          }),
        };

        const adapter = createLifecycleAdapter({
          platform: "ios",
          webOptions: options,
          app,
        });

        // 1. 注册尚未 resolve 时触发 callback({ isActive: true })
        capturedCallback!({ isActive: true });

        // 2. 稍后 resolve handle，真实注册成功，并按已有事实通知 visible，同时发起 getState()
        addListenerDeferred.resolve({ remove: vi.fn(async () => {}) });
        await new Promise((r) => setTimeout(r, 10));

        // 注册完成时根据此前 callback 暂为 visible
        expect(adapter.capabilities.nativeAppState).toBe(true);
        expect(adapter.getSnapshot().visibility).toBe("visible");
        expect(app.getState).toHaveBeenCalledTimes(1);

        // 3. 晚于 callback 发起的 getState 返回较新的真实后台事实 { isActive: false }
        getStateDeferred.resolve({ isActive: false });
        await new Promise((r) => setTimeout(r, 10));

        // 较新的 getState 结果必须压过早先的旧 callback 事实，最终状态呈现 hidden
        expect(adapter.capabilities.nativeAppState).toBe(true);
        expect(adapter.getSnapshot().visibility).toBe("hidden");

        adapter.dispose();
      });

      it("getState 调用后到达的更晚事件（包括同值事件）推进代际，旧 getState 迟到 resolve 不得覆盖更晚事件", async () => {
        const { options } = createMockEnvironment({ visibilityState: "visible" });
        const addListenerDeferred = new Deferred<{ remove(): Promise<void> }>();
        const getStateDeferred = new Deferred<{ isActive: boolean }>();
        let capturedCallback: ((state: { isActive: boolean }) => void) | null = null;

        const app: AppStateSource = {
          getState: vi.fn(() => getStateDeferred.promise),
          addListener: vi.fn((_evt, cb) => {
            capturedCallback = cb;
            return addListenerDeferred.promise;
          }),
        };

        const adapter = createLifecycleAdapter({
          platform: "ios",
          webOptions: options,
          app,
        });

        // 注册成功 -> 发起 getState
        addListenerDeferred.resolve({ remove: vi.fn(async () => {}) });
        await new Promise((r) => setTimeout(r, 10));
        expect(app.getState).toHaveBeenCalledTimes(1);

        // 在 getState 挂起期间，到达更晚的新事件 callback({ isActive: true })
        capturedCallback!({ isActive: true });
        expect(adapter.getSnapshot().visibility).toBe("visible");

        // 稍后旧的 getState 迟到返回 { isActive: false }
        getStateDeferred.resolve({ isActive: false });
        await new Promise((r) => setTimeout(r, 10));

        // 因为事件晚于 getState 调用，旧 getState 结果被丢弃，保持更晚事件的 visible
        expect(adapter.getSnapshot().visibility).toBe("visible");

        adapter.dispose();
      });
    });

    describe("NAT-04: 初次 getState 失败可恢复性与注册失败严格关闭", () => {
      it("注册成功但初次 getState reject 时当时关闭，后续有效 appStateChange 可建立前台事实与 native 能力", async () => {
        const { options } = createMockEnvironment({ visibilityState: "visible" });
        const addListenerDeferred = new Deferred<{ remove(): Promise<void> }>();
        const getStateDeferred = new Deferred<{ isActive: boolean }>();
        let capturedCallback: ((state: { isActive: boolean }) => void) | null = null;

        const app: AppStateSource = {
          getState: vi.fn(() => getStateDeferred.promise),
          addListener: vi.fn((_evt, cb) => {
            capturedCallback = cb;
            return addListenerDeferred.promise;
          }),
        };

        const adapter = createLifecycleAdapter({
          platform: "ios",
          webOptions: options,
          app,
        });

        // 1. 注册成功 -> 发起 getState
        addListenerDeferred.resolve({ remove: vi.fn(async () => {}) });
        await new Promise((r) => setTimeout(r, 10));

        // 2. getState reject
        getStateDeferred.reject(new Error("Initial getState failed"));
        await adapter.whenReady();

        // 首次状态读取失败：当时保持关闭，nativeAppState 为 false，快照 hidden
        expect(adapter.capabilities.nativeAppState).toBe(false);
        expect(adapter.getSnapshot().visibility).toBe("hidden");

        // 3. 监听已被成功注册，后续有效原生事件到达 callback({ isActive: true })
        capturedCallback!({ isActive: true });

        // 必须能够恢复并建立有效前台事实与原生能力！
        expect(adapter.capabilities.nativeAppState).toBe(true);
        expect(adapter.getSnapshot().visibility).toBe("visible");

        adapter.dispose();
      });

      it("addListener 注册失败后即使随后触发 callback 依然保持关闭，绝不开放原生能力", async () => {
        const { options } = createMockEnvironment({ visibilityState: "visible" });
        const addListenerDeferred = new Deferred<{ remove(): Promise<void> }>();
        let capturedCallback: ((state: { isActive: boolean }) => void) | null = null;

        const app: AppStateSource = {
          getState: vi.fn(async () => ({ isActive: true })),
          addListener: vi.fn((_evt, cb) => {
            capturedCallback = cb;
            return addListenerDeferred.promise;
          }),
        };

        const adapter = createLifecycleAdapter({
          platform: "ios",
          webOptions: options,
          app,
        });

        // 1. addListener reject 注册失败
        addListenerDeferred.reject(new Error("Listener registration failed"));
        await adapter.whenReady();

        expect(adapter.capabilities.nativeAppState).toBe(false);
        expect(adapter.getSnapshot().visibility).toBe("hidden");

        // 2. 随后若有伪 callback 到达
        capturedCallback!({ isActive: true });

        // 注册失败必须严格永久关闭，绝不开放能力或 visible
        expect(adapter.capabilities.nativeAppState).toBe(false);
        expect(adapter.getSnapshot().visibility).toBe("hidden");

        adapter.dispose();
      });
    });
  });
});
