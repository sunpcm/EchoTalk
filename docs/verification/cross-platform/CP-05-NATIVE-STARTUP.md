# CP-05 原生启动与显式恢复（A18）

产品`91f80d2`独立APPROVED，契约见[原生启动](../../CROSS_PLATFORM_NATIVE_STARTUP.md)。startSession/resumeSession先保留共享槽位，再初始化统一生命周期实例和等待原生就绪；pending零外部请求，就绪后和每await/同步set副作用前精确核对来源。原生就绪等待10秒失败退出/清理/可显式重试；不影响agy CLI不限时策略。原生后台/离线/认证失效或取消立即作废旧意图，旧setup/ready/timer/Token不影响新操作，不自动重放写或伪造服务端结束。

## 已验证

独立七门禁：547产品/24文件、18构建脚本、22 E2E（Chromium/WebKit各11），30私有探针通过。START-01当前意图认证复核失效仍卡checking与START-02初始化重入重复capabilities/token均修复；覆盖开始/恢复、初始化挂起/失败/后台、10秒退出后重试、旧ready与新槽位、goHome/同principal revision、同步set取消、原生setup取消重开、API多阶段迟到结果与Web unknown兼容。

两个有效变异分别跳过就绪等待（19行为失败）及延长就绪窗口（2个settled断言失败），恢复源码后30通过。首次resume夹具缺ended_at:null被正确拒绝，原失败保留，修正后才判定产品缺陷。最终集成七门禁以本地completion.json为准。

证据仅本地.review/reports/workflow-native-startup-a18：approved-source-r2.json、b/review-r2.md、reviewer-checks、private-r1.log、private-restored.log、mutations及integration-checks/completion.json。只三文件产品改动，不改UI/platform/API/auth/后端/依赖锁。

## 流程与边界

同账本3次尝试；r1产品修复后质量通过，终止SUCCESS但新版checkpoint事件schema未知，有限解析器失败关闭。旧记录保留，不临时放宽；r2同模型冷启动仅补交付，完整SUCCESS/exit0无拒权，旧检查经源码及8证据hash前后核验复用，独立验收仍完整执行。最终短报告使用真实绝对产物路径，避免前轮P2目录误报。

维护候选已由 A18P2 收口：测试全局注入 setter 与 start/resume 重复编排已在回归保护下移除，详见下方「A18P2 维护收口」。时序矩阵帮助集中发现缺陷，但本轮仍发生产品返工和格式补交成本，不证明净 Codex 额度节省。新问题只记本地 issues 及 TODO，不自动继续改 skill。

「Room 仍使用 Web 生命周期，A19 需解决挂载前原生就绪门禁与已连接音轨中断」为 A18 当时时点表述；该 A19 后续已由 [CP-05 原生 Room 门禁](./CP-05-NATIVE-ROOM.md) 独立完成。不能把本轮当原生采音完整链路。真实 OS/Provider/IdP、Xcode/签名、数据库和发布未验。旧「不 push/deploy」为 A18 当时交付时点表述；本卡 A18P2 仅当前任务分支提交与推送，不开 PR、不合并、不部署。A16 的本地 iOS build+sync 只证明当时产物，本轮未重新 sync，后续设备验收前需重建。

## A18P2 维护收口（模块资源实例隔离）

在 A18 已验收契约之上，仅做维护候选收口：把模块级可变 `currentStartupTracker`、`testingLifecycleOptions` 与全局测试注入 `_setLifecycleOptionsForTesting` 全部移除；`createConversationSlice` 工厂只拥有自己的 tracker/adapter/监听/计时器，`isNativeIos()` 直接读 `detectPlatform()`，`createLifecycleAdapter()` 改为无参调用。start/resume 的重复生命周期编排抽成实例内最小公共 `runStartupLifecycle`，两动作复用同一 tracker 创建、cleanup 与就绪 guard，公共动作签名/返回值/状态机、认证 principal/revision/代际、Cloud disabled 能力门禁、原生 10 秒 deadline、先去重槽位再初始化及同步通知重入、旧回调/就绪/timeout/finally 隔离与全部请求顺序/取消不新增 end POST 语义均不变。

新增 `conversationLifecycleIsolation.test.ts` 用真实 `createConversationSlice` 构造两个独立 Zustand 物理容器，覆盖 start/start、start/resume、resume/start、resume/resume 与 cancel/late 隔离：第二实例不得 dispose/退订第一实例，取消/完成一实例不影响另一实例资源，各自 late 结果不能写其他实例。旧测试文件改用局部 `vi.mock("@/platform")` + `detectPlatform`/`createLifecycleAdapter` mock 控制 native/Web 分类与 adapter 事实，旧 expect 链保持，native pending 零请求/10 秒/认证与代际门禁不削弱。新增回归失败路径补异常安全 test-owned finally cleanup。R1 将 `runStartupLifecycle` 由 async 改为同步返回（`awaitNativeReady` 仅 native 分支异步等待 ready），恢复 Web 零额外 await，并修新 fixture 类型。具体计数与门禁/变异证据见 [PROJECT_STATUS.md](../../PROJECT_STATUS.md) A18P2 小节。
