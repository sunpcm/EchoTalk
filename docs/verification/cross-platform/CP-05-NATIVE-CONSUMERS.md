# CP-05 原生只读消费者（A17）

产品`d1a69d1`独立APPROVED。ActiveSessions与usePollingAssessment改用统一createLifecycleAdapter，默认Capacitor iOS消费官方App状态。每effect独立实例、订阅后取快照和局部活性清理；原生pending/失败/后台不GET，恢复只读一次并合并在途请求，旧响应/错误/finally隔离。原有Web unknown/null、分析退避与知识请求在途范围保持，不自动重放结束/恢复/start/token/dispatch/retryAnalysis或采音。

## 验证

独立七门禁：525产品/24文件、18构建脚本、Chromium/WebKit各11项，0skip。35私有探针（27 Web+8原生组合）覆盖真实默认factory入口、pending/失败到有效事件恢复、原生后台覆盖DOM、旧挂起释放、迟到错误/结果、身份revision、实例清理及零自动写。两消费者分别强制回Web的两个变异各触发7个真实行为失败；恢复后35探针通过。初次探针错误API名造成8个fixture beforeEach失败，原记录保留，改正确listActiveSessions后才形成裁定。

仅四个约定产品文件改动，契约见[原生消费者](../../CROSS_PLATFORM_NATIVE_CONSUMERS.md)。完整本地证据在.review/reports/workflow-native-consumers-a17，包括approved-source-r0.json、b/review-r0.md、reviewer-checks、private-r0-corrected.log、private-restored.log、mutations；最终隔离集成以integration-checks及completion.json为准。未重跑iOS sync，A16 build+sync仅证明当时生成接线，不能冒充本轮设备证据。

## 遗留和边界

P2：hook头部仍称Web；初始native未查询时列表显示空状态，后续体验任务区分“尚未查询”和“服务端确认空”。已记TODO，不为P2开模型返工。实际Room/通话启动仍待A18；连接等待视图当前无直接取消，后续原生就绪等待必须有可达退出，避免永久占位。

本轮同模型首轮完整交付，账本651.89秒；外部会话最后累计total321330，缓存与思考另列，非Codex节省证明。应用skill a42fde9最小时序矩阵与固定入口，原生假插件/本地Fake API不等于真实OS、IdP/Provider/媒体；未数据库、Xcode、签名或发布，不push/deploy。整体CP-05仍未完成。
