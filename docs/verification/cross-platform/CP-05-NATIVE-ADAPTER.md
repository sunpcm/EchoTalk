# CP-05 原生生命周期薄适配器（A16）

产品 `bcf008c` 独立 APPROVED，契约见[原生生命周期](../../CROSS_PLATFORM_NATIVE_LIFECYCLE.md)。新增统一工厂，仅明确Capacitor iOS选官方App；Web/Tauri/SSR仍Web，未修改消费者。whenReady、有效异步注册、事件相对查询起点的版本仲裁、读取失败后有效事件恢复、原生/Web保守交集及迟到句柄清理已验证。

## 验证事实

独立七项门禁：509产品测试/24文件（原生适配器37项）、18构建脚本、22双浏览器（Chromium/WebKit各11）、22私有探针通过。两个有效变异分别破坏iOS工厂选择与Web hidden交集，产生真实行为失败；恢复后22探针通过。NAT-01/02/03/04均关闭。r5短报告路径错误为P2：实际是apps/vite-app/src/platform/lifecycle.ts、lifecycle.test.ts、index.ts，已按Git及hash核验，未为此再调用模型。

本地iOS development与production模式均用保留域名example.test及无秘密OIDC示例配置build+sync通过；不连接服务。sync发现官方@capacitor/app@8.1.2并生成SPM CapacitorApp依赖及AppPlugin类注册。为避免提交临时development webDir，最终由production示例build+sync生成，保留原dist/ios/production路径；未手改生成逻辑。最终隔离集成七门禁以本地completion.json为准。

证据仅本地.review/reports/workflow-native-a16：approved-source-r5.json、b/review-r5.md、reviewer-checks、private-final-r5.log、private-restored.log、mutations、ios-checks、ios-production-config-checks、integration-checks及completion.json。模型报告不代替评审/原始日志。

## 工作流与未验边界

skill a42fde9本地两端同步，66项离线回归通过；长任务等待、最小时序验收、绝对路径入口及增量恢复已更新。原r2/r3终止ERROR connection reset完整保留；r3网络失败明确分类，r4 CLI版本漂移在模型前阻断，受限固定现场1.4.6后同模型新会话r5完整交付。旧7门禁经源码及日志hash双向复核复用，独立及集成检查仍完整执行，累计5次模型尝试，未重置账本。

新问题记本地issues.md：报告精简丢产物路径、仅补交付与源码无进展计数的区别、shell初始化返回值及CLI版本漂移。尚未证明净Codex额度节省。消费者/通话尚未接入此原生适配器，下一步只读消费者后再通话链路；不得声称整个CP-05完成。未Xcode编译/签名、真实OS事件、真实IdP/媒体/Provider、数据库或Linux CI验收；不push/deploy。
