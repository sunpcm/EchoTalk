# CP-02 / CP-05 Web连接中断本地验证（A13）

契约见[CROSS_PLATFORM_CONNECTION_FAILURE.md](../../CROSS_PLATFORM_CONNECTION_FAILURE.md)。基线A12@82b363c，契约0cbc554，产品97e4c75。共享客户端五文件，无后端/依赖/锁文件/Cloud模式变化。

SDK onError、全部onDisconnected原因、Web suspend/pagehide/hidden/offline在当前Room已有Token时停止本地音轨，不等待disconnect；清Token/URL并卸载房间，进入connection_failed安全提示，仅返回主页后明确恢复/新开始。初始hidden/offline不挂Room，unknown/null不误判离线；页面/网络恢复不自动采音、reload、签Token、dispatch或重试写请求，不声称服务端已结束，不进入分析轮询。DataChannel既有失败边界保持。

## 独立验证

441产品测试（419+22）、18构建脚本、28A13及21A12私有探针、6既有Chromium/Fake API、完整7项质量门禁通过。CON-01卸载SDK/effect旧回调、CON-02旧身份onConnected、CON-03过期store动作提前清新启动tracker、CON-04渲染到订阅快照空窗四类共7独立失败已关闭。覆盖精确issuer/subject/revision、组件存活与代际、初始快照、已清理监听、挂起dispatch结果失效以及失败后真实store显式开始可用。

两有效变异分别删除effect存活门禁、屏蔽订阅后快照，以实际状态/Room断言失败；逐字节/指纹恢复后49探针及完整7门禁再通过。最终隔离集成结论以本地completion.json为准。评审首版探针语法错误0收集已纠正，原日志保留，未当作产品失败。

后端无diff，本轮未跑数据库/迁移，PR96后端/空库CI只是未变基线。SDK模拟错误包括Token拒绝场景，但真实Token过期、物理麦克风、网络/Provider、原生系统事件未验；6既有浏览器E2E也不代表真实音轨验收，不勾选三端或CP-02整体。

## 工作流事实

最新skill cd09a3a、3/10次。r0/r1常规质量通过但同一会话最终ERROR stream interrupted，原错误/原流均保留，无reparse洗掉。r2在同账本/模型/预算冷启动，只补完整交付，源码与r1一致，成功形成完整SUCCESS且未知行0/无拒绝。此恢复有效，但原因未证实，不外推为所有CLI错误都应冷启动。

账本活动2545.09秒，r0墙钟1745.74与单调1349.23秒不同；可能宿主暂停/时钟变化，原因未核实，不作精确模型计算/计费推断。agy按会话取最后累计后相加：旧会话1087795、新会话68148，总1155943；input1009778/output146165，thinking106130/cache_read17542002单列，不能等同Codex额度节省。完整Codex任务用量未测，不报节省率。

用户要求顺利时连续进入下一里程碑，更新日志/文档供集中查看，不因常规里程碑自动停止。已新授权下载锁定Playwright对应webkit-2336，安装与空白页冒烟通过，依赖和锁文件不变；下一阶段补双浏览器测试，仍不push/merge/deploy。问题与证据仅本地.review/reports/workflow-connection-a13，不自动修改通用skill。
