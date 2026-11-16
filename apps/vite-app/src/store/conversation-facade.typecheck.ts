import type { useConversationStore } from "./conversation";
import type { ConversationStore } from "./conversation";

/**
 * F4 编译期契约（type-only，无任何运行时副作用）。
 * 窄 façade 的 getState/selector 以及导出 ConversationStore 均不得暴露通用协调补丁入口
 * resetWithShellCoordination（它接收任意 object，可写入 appView 等外壳键），也不能通过这些
 * 公共类型读回外壳字段。本文件仅由 `tsc -p tsconfig.json --noEmit` 类型检查执行，不作为 Vitest 用例。
 *
 * 若将 ConversationStore 回退为完整 ConversationSlice（或 getState/selector 随之宽化），
 * 下列 @ts-expect-error 会因「指令未使用」而变成类型错误，从而守住收窄契约。
 */

// 1) 导出 ConversationStore 类型本身不含 resetWithShellCoordination / appView
// @ts-expect-error resetWithShellCoordination 不是 ConversationStore 的键
export type _NoResetKey = ConversationStore["resetWithShellCoordination"];
// @ts-expect-error appView 是外壳字段，不在窄 façade
export type _NoAppViewKey = ConversationStore["appView"];

// 2) getState() 返回窄类型，不应暴露协调入口或外壳字段
type _NarrowState = ReturnType<typeof useConversationStore.getState>;
// @ts-expect-error resetWithShellCoordination 已从窄 façade 收窄
export type _StateReset = _NarrowState["resetWithShellCoordination"];
// @ts-expect-error appView 是外壳字段，不在窄 façade
export type _StateAppView = _NarrowState["appView"];

// 3) selector 参数类型同样不应暴露
type _SelectorState = Parameters<typeof useConversationStore>[0] extends (state: infer S) => unknown
  ? S
  : never;
// @ts-expect-error resetWithShellCoordination 已从窄 façade 收窄
export type _SelectorReset = _SelectorState["resetWithShellCoordination"];
// @ts-expect-error appView 是外壳字段，不在窄 façade
export type _SelectorAppView = _SelectorState["appView"];
