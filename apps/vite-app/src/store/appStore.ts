import { create } from "zustand";
import {
  createConversationSlice,
  normalizeConversationSessionPatch,
  type ConversationSlice,
  type ConversationSliceCoordinator,
} from "./conversationSlice";
import { initialNavigationSlice, type NavigationSlice } from "./navigation";

export interface AppStore extends ConversationSlice, NavigationSlice {
  /** 重置会话切片、清理场景选择并返回 Dashboard */
  goHome: () => void;
  /** 原子重置会话切片并进入 DocChat 设置入口 */
  openDocChatSetup: () => void;
}

const coordinator: ConversationSliceCoordinator<AppStore> = {
  beginConnectingPatch: () => ({ appView: "session" }),
  credentialsReadyPatch: () => ({ appView: "session" }),
  startupClosedPatch: () => ({ appView: "dashboard" }),
  isRoomOwningState: (state) => state.appView === "session",
};

const conversationSet = (partial: object | ((state: ConversationSlice) => object)): void => {
  useAppStore.setState(
    (state) => (typeof partial === "function" ? partial(state) : partial) as Partial<AppStore>,
  );
};

export const useAppStore = create<AppStore>((_set, get) => ({
  ...initialNavigationSlice,
  ...createConversationSlice(conversationSet, get, coordinator),
  goHome: () => {
    get().resetWithShellCoordination({
      appView: "dashboard",
      selectedScenario: null,
    });
  },
  openDocChatSetup: () => {
    get().resetWithShellCoordination({ appView: "doc-chat-setup" });
  },
}));

/** 兼容名称：导航测试与夹具必须引用同一个物理原子容器。 */
export const useNavigationStore = useAppStore;

const rawSetState = useAppStore.setState;
type AppStoreSetState = typeof useAppStore.setState;

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

/** Keep direct setState fixtures on the same atomic model/projection path. */
const setStateWithSessionProjection = (
  partial: AppStore | Partial<AppStore> | ((state: AppStore) => AppStore | Partial<AppStore>),
  replace?: boolean,
): void => {
  if (replace === true) {
    rawSetState((state) => {
      const replacement = (typeof partial === "function" ? partial(state) : partial) as AppStore;
      const normalized = normalizeConversationSessionPatch(state, replacement) as AppStore;
      // 窄 façade 只携带会话切片字段；replace 时补回外壳/导航键与内部协调动作，
      // 除非调用者显式提供它们（保留 AppStore 完整 replacement 语义）。
      if (normalized === state) {
        return normalized;
      }
      const withShell = { ...normalized } as AppStore;
      if (!hasOwn(withShell, "appView")) withShell.appView = state.appView;
      if (!hasOwn(withShell, "goHome")) withShell.goHome = state.goHome;
      if (!hasOwn(withShell, "openDocChatSetup")) {
        withShell.openDocChatSetup = state.openDocChatSetup;
      }
      if (!hasOwn(withShell, "resetWithShellCoordination")) {
        withShell.resetWithShellCoordination = state.resetWithShellCoordination;
      }
      return withShell;
    }, true);
    return;
  }

  rawSetState((state) => {
    const patch = typeof partial === "function" ? partial(state) : partial;
    return normalizeConversationSessionPatch(state, patch);
  });
};

useAppStore.setState = setStateWithSessionProjection as AppStoreSetState;
