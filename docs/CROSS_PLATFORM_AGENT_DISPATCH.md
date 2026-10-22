# CP-02 Agent 调度失败处理（A12）

## 1. 范围

本轮落实TODO中“UI明确展示Agent调度失败及可恢复操作”的调度HTTP失败部分。仅disabled现有通话链路；Cloud门禁、后端及API原语保持。本地模拟验收不等同真实Provider、原生设备或完整断网/Token过期恢复通过。

## 2. 调度与归属

LiveKit连接成功后，当前sessionId/sessionGen最多发送一次dispatch POST；重复onConnected、重渲染和StrictMode effect重放不得重复请求。开始新代际才允许新的显式调度。无ID/Token、非connecting/active、过期房间或已卸载组件回调不得发送；在途成功/失败必须核对sessionId、sessionGen以及来源精确认证principal/revision，旧结果不能影响新会话。既有全局认证清理保持，不弱化为只检查subject。组件卸载后迟到结果不能更新当前store或重新采音。

API成功仅接受对象且dispatched严格true（现有后端响应）；false、缺失或错误类型视同失败。未知HTTP结果不视同没有执行，也不自动重试或补偿POST。

## 3. 失败与用户恢复

当前调度的HTTP502/409/503、网络失败、无效成功响应均失败关闭：立即停止本Room本地音轨并卸载房间、清除Token/URL，展示本地化“AI服务启动未确认，音频已停止”的提示及返回主页操作。不得回显原始异常message/detail/Token；不宣称服务端会话已结束，不自动end/create/token/dispatch，不启动分析轮询。失败文案说明返回后可从活动记录明确恢复；沿用已有恢复确认和重新校验，不新增即时重试dispatch按钮、不自动采音。

失败后旧onConnected/onError/onDisconnected及setActive不得复活房间。返回主页后可显式开始新会话/恢复已有会话。成功路径维持原界面。DataChannel已有agent_error行为兼容，不借本轮重做所有连接告警。

## 4. 验收

覆盖502/网络/错误响应，音轨stop不依赖disconnect Promise，零自动重试/补偿/分析轮询；重复连接回调去重（pending及成功后）；旧结果在结束、返回主页、新会话、卸载、principal/revision变化后隔离；失败后主页/下一显式操作可用。保留全部产品测试、build脚本、质量门禁和Chromium Fake API回归，由主评审补独立模拟Room探针及有效变异。固定服务端响应形状必须查真实API，旧测试{status:'dispatched'}是假fixture，应改成{dispatched:true}而非放松产品校验。
