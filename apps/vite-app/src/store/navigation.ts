/** 顶层视图枚举。该切片只保存页面状态，不创建独立物理 store。 */
export type AppView = "dashboard" | "session" | "doc-chat-setup";

export interface NavigationSlice {
  /** 当前顶层视图 */
  appView: AppView;
}

export const initialNavigationSlice: NavigationSlice = {
  appView: "dashboard",
};
