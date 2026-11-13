import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore, type AppStore } from "./appStore";
import { useConversationStore, type ConversationStore } from "./conversation";

/**
 * 从完整 AppStore 状态剥离外壳键与内部协调动作，得到不携带
 * resetWithShellCoordination 的窄 ConversationStore 替换体。
 */
const stripCoordination = (state: AppStore): ConversationStore => {
  const {
    appView: _appView,
    goHome: _goHome,
    openDocChatSetup: _openDocChatSetup,
    resetWithShellCoordination: _resetWithShellCoordination,
    ...conversation
  } = state;
  void _appView;
  void _goHome;
  void _openDocChatSetup;
  void _resetWithShellCoordination;
  return conversation;
};

/** 模块加载时的完整初始状态，用于测试间恢复，避免显式覆盖协调动作等污染下一用例。 */
const initialAppStoreState = useAppStore.getState();

describe("F4 窄 façade 协调入口收窄", () => {
  afterEach(() => {
    useAppStore.setState(initialAppStoreState, true);
  });

  it("replace=true（object）省略 resetWithShellCoordination 后仍保留内部协调动作", () => {
    useAppStore.setState({ appView: "session" });
    useAppStore.setState((state) => ({
      ...state,
      connectionState: "active",
      sessionId: "f4-obj-session",
      token: "tok-obj",
      wsUrl: "wss://lk.test",
    }));

    const before = useAppStore.getState();
    const goHomeRef = before.goHome;
    const openDocChatSetupRef = before.openDocChatSetup;
    const resetWithShellCoordinationRef = before.resetWithShellCoordination;

    useConversationStore.setState(stripCoordination(before), true);

    const after = useAppStore.getState();
    expect(after.appView).toBe("session");
    expect(after.goHome).toBe(goHomeRef);
    expect(after.openDocChatSetup).toBe(openDocChatSetupRef);
    expect(after.resetWithShellCoordination).toBe(resetWithShellCoordinationRef);
    expect(after).toMatchObject({
      sessionId: "f4-obj-session",
      token: "tok-obj",
      wsUrl: "wss://lk.test",
      connectionState: "active",
    });

    expect(() => after.goHome()).not.toThrow();
    expect(useAppStore.getState()).toMatchObject({
      appView: "dashboard",
      selectedScenario: null,
    });
  });

  it("replace=true（function）省略 resetWithShellCoordination 后仍保留内部协调动作", () => {
    useAppStore.setState({ appView: "session" });
    useAppStore.setState((state) => ({
      ...state,
      connectionState: "active",
      sessionId: "f4-fn-session",
      token: "tok-fn",
      wsUrl: "wss://lk.test",
    }));

    const before = useAppStore.getState();
    const goHomeRef = before.goHome;
    const openDocChatSetupRef = before.openDocChatSetup;
    const resetWithShellCoordinationRef = before.resetWithShellCoordination;

    useConversationStore.setState((state) => stripCoordination(state as AppStore), true);

    const after = useAppStore.getState();
    expect(after.appView).toBe("session");
    expect(after.goHome).toBe(goHomeRef);
    expect(after.openDocChatSetup).toBe(openDocChatSetupRef);
    expect(after.resetWithShellCoordination).toBe(resetWithShellCoordinationRef);
    expect(after).toMatchObject({
      sessionId: "f4-fn-session",
      token: "tok-fn",
      wsUrl: "wss://lk.test",
      connectionState: "active",
    });

    expect(() => after.openDocChatSetup()).not.toThrow();
    expect(useAppStore.getState()).toMatchObject({ appView: "doc-chat-setup" });
  });

  it("显式提供的 resetWithShellCoordination 在 replace=true 时不被覆盖", () => {
    const custom = vi.fn();
    useAppStore.setState((state) => ({ ...state, resetWithShellCoordination: custom }), true);

    expect(useAppStore.getState().resetWithShellCoordination).toBe(custom);
  });
});
