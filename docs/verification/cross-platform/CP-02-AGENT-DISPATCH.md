# CP-02 Agent调度失败本地验证（A12）

契约见[CROSS_PLATFORM_AGENT_DISPATCH.md](../../CROSS_PLATFORM_AGENT_DISPATCH.md)。基线为PR96 squash后的main@344e317，契约946402a，产品cdbe479。只修改共享客户端五文件；服务端、依赖/锁文件、Cloud模式与门禁保持。

## 实现和验证

当前LiveKit连接在同session/gen只dispatch一次；HTTP或无效成功响应失败后立即stop本地音轨、不等待disconnect，清Token/URL并进入dispatch_failed提示。只提供返回主页，服务端记录不伪称结束，可再次明确开始或恢复；零自动POST重试、补偿create/end/token/dispatch、分析轮询。日志固定信息，不回显任意错误内容。

独立7项完整门禁通过：419产品测试（403基线+16）、18构建脚本、格式/lint/typecheck/双构建及6项既有Chromium/Fake API。21私有模拟Room探针覆盖严格dispatched:true、失败关闭、同步stop、请求去重/StrictMode/完整重挂载、旧session/认证revision/principal/卸载结果隔离及失败后真实store显式新启动。同步store标记通知后goHome/end/revision/unmount四失败已在r2关闭。

两个有效变异分别破坏成功响应校验与认证代际校验，行为断言确实失败；逐字节/整树指纹恢复后21探针及完整7门禁再通过。证据仅存本地.review/reports/workflow-dispatch-a12，不将评审探针传给实施方。

后端与main基线无diff，本轮未运行数据库测试或迁移；PR96后端/空库迁移CI为已通过的未变基线证据，不声称本轮再次执行。新增dispatch失败依靠模拟Room验证，既有浏览器E2E不代表真实音轨验证。

## 边界

真实Cloud/Provider、物理麦克风、原生认证和系统生命周期、连接离线与Token失效恢复未验；不能勾选CP-02或三端整体完成。该里程碑仅本地commit/隔离集成，不自动push/merge/deploy，最终集成7门禁结论以本地completion.json为准。

## 工作流记录

最新skill cd09a3a，3/10次尝试，累计1400.71活动秒，用户授权不限时。首次CLI版本仍1.4.5但拒绝已授权模型，agy models却仍列出该ID；保留失败后正式reconcile重试同模型成功，不能据此推断模型下架。r1产品同步可重入缺陷经独立探针返工；报告基线指纹纠正、安全日志一起修复。评审侧错误runner入口均保留并从正确lane复核。

同一会话最后累计agy input669286/output63825/total733111；thinking39150、cache_read14093775单列，不重复加续跑总量，不等同账单/Codex会员额度或净节约。新问题只记项目日志，未自动改全局skill；停止下一模型派发。
