/**
 * 集中管理用户状态与跨 Store 账号数据清理。
 * 由 AuthGate 等顶层生命周期组件调用，避免 Auth 模块与 Stores 产生循环引用。
 */

import { useAppStore } from "@/store/appStore";
import { useSettingsStore } from "@/store/settings";
import { useAssessmentStore } from "@/store/assessment";
import { clearDiagnosticBuffer } from "@/lib/diagnostics";

/**
 * 清理全部用户相关 store 的数据与在途请求归属。
 * 1. conversation: 执行 goHome，重置视图并使 A3 会话代际失效及清空 LiveKit Token
 * 2. settings: 执行 reset，递增独立操作代际并取消主题在途防抖
 * 3. assessment: 执行 reset，递增独立操作代际并清空评估与知识状态
 * 4. diagnostics: 先同步清空内存记录和复制归属，不依赖设置 UI 挂载
 * 重复调用保持幂等。
 */
export function clearUserSessionData(): void {
  clearDiagnosticBuffer();
  useAppStore.getState().goHome();
  useSettingsStore.getState().reset();
  useAssessmentStore.getState().reset();
}
