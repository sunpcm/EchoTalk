# 已有会话显式恢复本地里程碑（2026-10-22）

## 行为与边界

产品`ca7ecb0`独立APPROVED：Dashboard活动记录可选择“恢复练习”，展示目标与语音/麦克风提示，取消无请求；确认绑定选择时身份/revision，复核前台/在线、目标和启动/结束互斥后恢复已有会话。固定能力→详情→健康→Token顺序，零创建/补偿结束/自动重试；只有disabled模式、对应active且ended_at=null的详情以及非空Token/URL成功才发布同ID进入现有VoiceInterface。Cloud继续失败关闭，无接管。

认证及操作代际、后台/离线/reset/goHome取消在store与组件两层隔离。旧请求仍pending时立即释放恢复控件，允许新的明确选择/确认；旧成功/失败/finally不能清理新操作或泄露旧错误，真正end POST在途不会被生命周期事件释放。没有Token持久化、自动恢复或后台采音。此前组件只读文件头已纠正。权威契约为CROSS_PLATFORM_SESSION_DISCOVERY §3。

## 独立验证

- 403产品Vitest（基线371，新增32）、18构建脚本、格式/lint/类型/双构建通过。
- 39私有探针覆盖API顺序/零create、Cloud/错误详情与Token、身份/revision、同步取消、各await失效、旧finally、新操作推进、恢复/结束/新建互斥和4种取消后的UI可操作。
- Chromium6既有+4恢复场景通过；能力请求保持挂起证明确认后零create/媒体前请求顺序，Cloud/结束详情无Token，后台/离线回前台可重新明确操作。手机确认和错误态截图、无横向溢出及页面身份/非空/无框架遮罩等核验通过。仅分发真实DOM事件，不声称真实OS后台或媒体完成。
- 两项有效变异分别破坏同步取消前的首条API门禁和reset/goHome后的UI槽位释放，均被产品行为断言捕获。源码逐字节/指纹恢复后完整quality及39探针再通过。零命中变异锚点与错误文案探针失败保留并纠正，未修改产品迎合夹具。
- 后端本任务未改；专用库身份/ready/schema前检后269/73.72%证据按无源码变化复用，无迁移。

完整交付、失败、修复、截图和最终集成结果保留在本地`.review/reports/workflow-recovery-a11/`。最终集成门禁以completion.json为准，本文不提前宣称尚未执行的最终检查成功。

## 工作流观察

经历REC-01同步取消、REC-03旧UI回调归属、REC-04取消后UI仍锁住三类产品修复；还保留首轮目录枚举拒绝、单轮超时和旧报告读取拒绝。每次均按账本保留历史，没有用CLI SUCCESS冒充合格交付。确定回执实际传入required_reads、run_id及项目pointer/summary/status/log；最终交付无拒绝，未扩大权限。

用户将本任务总尝试改10并暂时关闭CLI/外层/累计时间停止，保留耗时、无进展和独立评审。实际6次尝试、累计2552.22活动秒；同一会话最后累计input1734884/output172809/total1907693，cache_read23653519、thinking108044单列，不将续跑累计逐轮相加，不折算Codex会员扣减或声称净省额。通用skill当前cd09a3a，本轮不自动修改skill。

本地提交/隔离集成，无push/deploy、真实IdP/Cloud/Provider/麦克风和iOS/macOS原生状态验收；不能据此勾选CP-02或三端整体完成。至此停止下一产品派发，后续可评估任务拆分、路径交接及返工成本。
