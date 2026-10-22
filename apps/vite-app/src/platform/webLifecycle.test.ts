import { describe, expect, it, vi } from "vitest";
import {
  createWebLifecycleAdapter,
  type WebLifecycleEvent,
  type WebLifecycleOptions,
} from "./webLifecycle";

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

describe("WebLifecycleAdapter", () => {
  it("provides initial snapshot and capabilities without immediately dispatching events", () => {
    const { options } = createMockEnvironment({
      visibilityState: "visible",
      onLine: true,
    });
    const adapter = createWebLifecycleAdapter(options);

    expect(adapter.capabilities).toEqual({
      webEvents: true,
      nativeAppState: false,
    });

    const snapshot = adapter.getSnapshot();
    expect(snapshot).toEqual({
      visibility: "visible",
      online: true,
    });

    const listener = vi.fn();
    adapter.subscribe(listener);
    // subscribe does not dispatch immediately
    expect(listener).not.toHaveBeenCalled();
  });

  it("defensively copies snapshots to prevent external mutation", () => {
    const { options } = createMockEnvironment({
      visibilityState: "visible",
      onLine: true,
    });
    const adapter = createWebLifecycleAdapter(options);

    const snapshot1 = adapter.getSnapshot();
    // mutate returned snapshot
    (snapshot1 as { visibility: string }).visibility = "hidden";

    const snapshot2 = adapter.getSnapshot();
    expect(snapshot2.visibility).toBe("visible");
  });

  it("handles visibilitychange with deduplication and state changes", () => {
    const { mockDoc, options } = createMockEnvironment({
      visibilityState: "visible",
      onLine: true,
    });
    const adapter = createWebLifecycleAdapter(options);

    const events: WebLifecycleEvent[] = [];
    adapter.subscribe((e) => events.push(e));

    // Change to hidden -> suspend event
    mockDoc.visibilityState = "hidden";
    mockDoc.dispatch("visibilitychange");

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "suspend",
      snapshot: { visibility: "hidden", online: true },
    });

    // Duplicate hidden -> no event
    mockDoc.dispatch("visibilitychange");
    expect(events).toHaveLength(1);

    // Change back to visible -> resume event
    mockDoc.visibilityState = "visible";
    mockDoc.dispatch("visibilitychange");

    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      type: "resume",
      snapshot: { visibility: "visible", online: true },
    });

    // Duplicate visible -> no event
    mockDoc.dispatch("visibilitychange");
    expect(events).toHaveLength(2);
  });

  it("handles online and offline events with deduplication", () => {
    const { mockWin, options } = createMockEnvironment({
      visibilityState: "visible",
      onLine: true,
    });
    const adapter = createWebLifecycleAdapter(options);

    const events: WebLifecycleEvent[] = [];
    adapter.subscribe((e) => events.push(e));

    // Duplicate online event -> no event
    mockWin.dispatch("online");
    expect(events).toHaveLength(0);

    // Offline event -> connectivity with online: false
    mockWin.dispatch("offline");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "connectivity",
      snapshot: { visibility: "visible", online: false },
    });

    // Duplicate offline -> no event
    mockWin.dispatch("offline");
    expect(events).toHaveLength(1);

    // Online event -> connectivity with online: true
    mockWin.dispatch("online");
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      type: "connectivity",
      snapshot: { visibility: "visible", online: true },
    });
  });

  it("handles pageshow and pagehide correctly", () => {
    const { mockDoc, mockWin, options } = createMockEnvironment({
      visibilityState: "visible",
      onLine: true,
    });
    const adapter = createWebLifecycleAdapter(options);

    const events: WebLifecycleEvent[] = [];
    adapter.subscribe((e) => events.push(e));

    // pagehide sets snapshot to hidden and always dispatches suspend
    mockWin.dispatch("pagehide");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "suspend",
      snapshot: { visibility: "hidden", online: true },
    });
    expect(adapter.getSnapshot().visibility).toBe("hidden");

    // pagehide again -> always dispatches suspend
    mockWin.dispatch("pagehide");
    expect(events).toHaveLength(2);
    expect(events[1].type).toBe("suspend");

    // pageshow re-reads document visibilityState and always dispatches resume even if already visible
    mockDoc.visibilityState = "visible";
    mockWin.dispatch("pageshow");
    expect(events).toHaveLength(3);
    expect(events[2]).toEqual({
      type: "resume",
      snapshot: { visibility: "visible", online: true },
    });

    // pageshow again when already visible -> still dispatches resume
    mockWin.dispatch("pageshow");
    expect(events).toHaveLength(4);
    expect(events[3]).toEqual({
      type: "resume",
      snapshot: { visibility: "visible", online: true },
    });
  });

  it("manages listeners: attaches on first subscription and detaches on last unsubscription", () => {
    const { mockDoc, mockWin, options } = createMockEnvironment();
    const adapter = createWebLifecycleAdapter(options);

    expect(mockDoc.totalListeners()).toBe(0);
    expect(mockWin.totalListeners()).toBe(0);

    const listener1 = vi.fn();
    const listener2 = vi.fn();

    const unsub1 = adapter.subscribe(listener1);
    expect(mockDoc.listenerCount("visibilitychange")).toBe(1);
    expect(mockWin.listenerCount("online")).toBe(1);
    expect(mockWin.listenerCount("offline")).toBe(1);
    expect(mockWin.listenerCount("pageshow")).toBe(1);
    expect(mockWin.listenerCount("pagehide")).toBe(1);

    const unsub2 = adapter.subscribe(listener2);
    // Still 1 DOM listener each
    expect(mockDoc.listenerCount("visibilitychange")).toBe(1);
    expect(mockWin.listenerCount("online")).toBe(1);

    // Unsubscribe first listener
    unsub1();
    expect(mockDoc.listenerCount("visibilitychange")).toBe(1);
    expect(mockWin.listenerCount("online")).toBe(1);

    // Duplicate unsubscribe does nothing
    unsub1();
    expect(mockDoc.listenerCount("visibilitychange")).toBe(1);

    // Unsubscribe second listener -> all DOM listeners removed
    unsub2();
    expect(mockDoc.totalListeners()).toBe(0);
    expect(mockWin.totalListeners()).toBe(0);
  });

  it("supports re-subscribing after all listeners unsubscribed", () => {
    const { mockDoc, mockWin, options } = createMockEnvironment({
      visibilityState: "visible",
      onLine: true,
    });
    const adapter = createWebLifecycleAdapter(options);

    const listenerA = vi.fn();
    const unsubA = adapter.subscribe(listenerA);
    unsubA();
    expect(mockDoc.totalListeners()).toBe(0);

    // Re-subscribe
    const listenerB = vi.fn();
    adapter.subscribe(listenerB);
    expect(mockDoc.listenerCount("visibilitychange")).toBe(1);
    expect(mockWin.listenerCount("online")).toBe(1);

    mockDoc.visibilityState = "hidden";
    mockDoc.dispatch("visibilitychange");

    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledWith({
      type: "suspend",
      snapshot: { visibility: "hidden", online: true },
    });
  });

  it("handles identical listener subscribed multiple times as independent subscriptions", () => {
    const { mockDoc, options } = createMockEnvironment({
      visibilityState: "visible",
    });
    const adapter = createWebLifecycleAdapter(options);

    const calls: number[] = [];
    const sharedListener = () => calls.push(1);

    const unsub1 = adapter.subscribe(sharedListener);
    const unsub2 = adapter.subscribe(sharedListener);

    mockDoc.visibilityState = "hidden";
    mockDoc.dispatch("visibilitychange");
    expect(calls).toHaveLength(2);

    calls.length = 0;
    unsub1();

    mockDoc.visibilityState = "visible";
    mockDoc.dispatch("visibilitychange");
    expect(calls).toHaveLength(1);

    calls.length = 0;
    unsub2();

    mockDoc.visibilityState = "hidden";
    mockDoc.dispatch("visibilitychange");
    expect(calls).toHaveLength(0);
  });

  it("does not invoke a subscriber unsubscribed during current event dispatch", () => {
    const { mockDoc, options } = createMockEnvironment({
      visibilityState: "visible",
    });
    const adapter = createWebLifecycleAdapter(options);

    const subRef: { unsub?: () => void } = {};
    const listener1Called = vi.fn(() => {
      subRef.unsub?.();
    });
    const listener2Called = vi.fn();

    adapter.subscribe(listener1Called);
    subRef.unsub = adapter.subscribe(listener2Called);

    mockDoc.visibilityState = "hidden";
    mockDoc.dispatch("visibilitychange");

    expect(listener1Called).toHaveBeenCalledTimes(1);
    expect(listener2Called).not.toHaveBeenCalled();
  });

  it("stops notifying subscribers if adapter is disposed during dispatch", () => {
    const { mockDoc, options } = createMockEnvironment({
      visibilityState: "visible",
    });
    const adapter = createWebLifecycleAdapter(options);

    const listener1 = vi.fn(() => {
      adapter.dispose();
    });
    const listener2 = vi.fn();

    adapter.subscribe(listener1);
    adapter.subscribe(listener2);

    mockDoc.visibilityState = "hidden";
    mockDoc.dispatch("visibilitychange");

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).not.toHaveBeenCalled();
  });

  it("isolates errors thrown by listeners so other listeners still execute", () => {
    const { mockDoc, options } = createMockEnvironment({
      visibilityState: "visible",
    });
    const adapter = createWebLifecycleAdapter(options);

    const faultyListener = vi.fn(() => {
      throw new Error("listener error");
    });
    const normalListener = vi.fn();

    adapter.subscribe(faultyListener);
    adapter.subscribe(normalListener);

    mockDoc.visibilityState = "hidden";
    expect(() => {
      mockDoc.dispatch("visibilitychange");
    }).not.toThrow();

    expect(faultyListener).toHaveBeenCalledTimes(1);
    expect(normalListener).toHaveBeenCalledTimes(1);
  });

  it("permanently disposes adapter: detaches listeners and rejects future subscriptions", () => {
    const { mockDoc, mockWin, options } = createMockEnvironment();
    const adapter = createWebLifecycleAdapter(options);

    const listener = vi.fn();
    adapter.subscribe(listener);

    expect(mockDoc.totalListeners()).toBeGreaterThan(0);
    adapter.dispose();
    expect(mockDoc.totalListeners()).toBe(0);
    expect(mockWin.totalListeners()).toBe(0);

    // Idempotent dispose
    adapter.dispose();

    // Future subscribe is safe no-op
    const afterListener = vi.fn();
    const unsub = adapter.subscribe(afterListener);
    unsub();

    mockDoc.visibilityState = "hidden";
    mockDoc.dispatch("visibilitychange");
    expect(listener).not.toHaveBeenCalled();
    expect(afterListener).not.toHaveBeenCalled();
  });

  it("safely degrades in SSR or missing window/document environments", () => {
    const ssrAdapter = createWebLifecycleAdapter({
      window: undefined,
      document: undefined,
      navigator: undefined,
    });

    expect(ssrAdapter.capabilities).toEqual({
      webEvents: false,
      nativeAppState: false,
    });

    expect(ssrAdapter.getSnapshot()).toEqual({
      visibility: "unknown",
      online: null,
    });

    const listener = vi.fn();
    const unsub = ssrAdapter.subscribe(listener);
    unsub();
    expect(listener).not.toHaveBeenCalled();

    ssrAdapter.dispose();
  });

  it("safely degrades when navigator is missing onLine property", () => {
    const mockDoc = new MockDocument();
    const mockWin = new MockWindow();
    const adapter = createWebLifecycleAdapter({
      window: mockWin,
      document: mockDoc,
      navigator: {},
    });

    expect(adapter.capabilities.webEvents).toBe(true);
    expect(adapter.getSnapshot().online).toBeNull();
  });

  // LC-01 回归测试 1: 工厂创建后尚未订阅期间环境发生变动，getSnapshot 及首次订阅正确对齐最新环境且无漏报
  it("aligns snapshot and internal state when environment changes before initial subscription (LC-01)", () => {
    const { mockDoc, mockNav, options } = createMockEnvironment({
      visibilityState: "visible",
      onLine: true,
    });
    const adapter = createWebLifecycleAdapter(options);

    // 在无监听状态下，外部环境发生改变
    mockDoc.visibilityState = "hidden";
    mockNav.onLine = false;

    // getSnapshot 应当立即反映最新环境
    expect(adapter.getSnapshot()).toEqual({
      visibility: "hidden",
      online: false,
    });

    const events: WebLifecycleEvent[] = [];
    const listener = vi.fn((e: WebLifecycleEvent) => events.push(e));

    // 首次订阅：不应发初始通知，但内部状态已对齐为 hidden/false
    adapter.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();

    // 随后环境恢复为 visible，触发 visibilitychange，必须收到 resume 事件（未被初始 visible 缓存去重拦截）
    mockDoc.visibilityState = "visible";
    mockDoc.dispatch("visibilitychange");

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "resume",
      snapshot: { visibility: "visible", online: false },
    });
  });

  // LC-01 回归测试 2: 全部退订后无监听期间环境变动，getSnapshot 及再次重订阅正确对齐最新环境且无漏报
  it("aligns snapshot and resumes accurately across unsubscribe-detach and re-subscription (LC-01)", () => {
    const { mockDoc, mockNav, options } = createMockEnvironment({
      visibilityState: "visible",
      onLine: true,
    });
    const adapter = createWebLifecycleAdapter(options);

    const initialListener = vi.fn();
    const unsub = adapter.subscribe(initialListener);

    // 全部退订 -> 移除 DOM 监听
    unsub();

    // 在全部退订（无监听）期间，环境变为 hidden 与 offline
    mockDoc.visibilityState = "hidden";
    mockNav.onLine = false;

    // getSnapshot 必须反映无监听期间的环境变动
    expect(adapter.getSnapshot()).toEqual({
      visibility: "hidden",
      online: false,
    });

    // 再次显式订阅
    const events: WebLifecycleEvent[] = [];
    const reListener = vi.fn((e: WebLifecycleEvent) => events.push(e));
    adapter.subscribe(reListener);

    // 订阅不发初始通知
    expect(reListener).not.toHaveBeenCalled();

    // 随后环境再次变回 visible，必须收到 resume 事件
    mockDoc.visibilityState = "visible";
    mockDoc.dispatch("visibilitychange");

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "resume",
      snapshot: { visibility: "visible", online: false },
    });

    // 随后 online 触发，必须收到 connectivity 事件
    mockNav.onLine = true;
    (options.window as MockWindow).dispatch("online");

    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      type: "connectivity",
      snapshot: { visibility: "visible", online: true },
    });
  });
});
