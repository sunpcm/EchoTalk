# CP-05 原生启动与显式恢复（A18）

产品`91f80d2`独立APPROVED，契约见[原生启动](../../CROSS_PLATFORM_NATIVE_STARTUP.md)。startSession/resumeSession先保留共享槽位，再初始化统一生命周期实例和等待原生就绪；pending零外部请求，就绪后和每await/同步set副作用前精确核对来源。原生就绪等待10秒失败退出/清理/可显式重试；不影响agy CLI不限时策略。原生后台/离线/认证失效或取消立即作废旧意图，旧setup/ready/timer/Token不影响新操作，不自动重放写或伪造服务端结束。

## 已验证

独立七门禁：547产品/24文件、18构建脚本、22 E2E（Chromium/WebKit各11），30私有探针通过。START-01当前意图认证复核失效仍卡checking与START-02初始化重入重复capabilities/token均修复；覆盖开始/恢复、初始化挂起/失败/后台、10秒退出后重试、旧ready与新槽位、goHome/同principal revision、同步set取消、原生setup取消重开、API多阶段迟到结果与Web unknown兼容。

两个有效变异分别跳过就绪等待（19行为失败）及延长就绪窗口（2个settled断言失败），恢复源码后30通过。首次resume夹具缺ended_at:null被正确拒绝，原失败保留，修正后才判定产品缺陷。最终集成七门禁以本地completion.json为准。

证据仅本地.review/reports/workflow-native-startup-a18：approved-source-r2.json、b/review-r2.md、reviewer-checks、private-r1.log、private-restored.log、mutations及integration-checks/completion.json。只三文件产品改动，不改UI/platform/API/auth/后端/依赖锁。

## 流程与边界

同账本3次尝试；r1产品修复后质量通过，终止SUCCESS但新版checkpoint事件schema未知，有限解析器失败关闭。旧记录保留，不临时放宽；r2同模型冷启动仅补交付，完整SUCCESS/exit0无拒权，旧检查经源码及8证据hash前后核验复用，独立验收仍完整执行。最终短报告使用真实绝对产物路径，避免前轮P2目录误报。

维护候选：测试全局注入setter与start/resume重复逻辑，后续在回归保护下处理。时序矩阵帮助集中发现缺陷，但本轮仍发生产品返工和格式补交成本，不证明净Codex额度节省。新问题只记本地issues及TODO，不自动继续改skill。

当前Room仍使用Web生命周期，A19需解决挂载前原生就绪门禁与已连接音轨中断；不能把本轮当原生采音完整链路。真实OS/Provider/IdP、Xcode/签名、数据库和发布未验；不push/deploy。A16的本地iOS build+sync只证明当时产物，本轮未重新sync，后续设备验收前需重建。
