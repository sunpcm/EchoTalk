# 项目概览文档（OVERVIEW）

> 日期：2026-11-16；纯文档一轮。新增 `docs/OVERVIEW.md` 作为首次接手开发者兼产品使用者的入口导览。

- 新增 `docs/OVERVIEW.md`：技术架构（运行时关系图/仓库地图/功能状态表）、使用方法（登录与首次配置 Provider、场景/DocTalk →
  练习 → 结束 → 分析 → 周概览）、开发准备（四进程启动/端口/HTTPS/根 .env/隔离库迁移）、无 Key 验证边界与 SGEC 离线 CLI。
- README 与 docs/README 各加入口链接。
- 事实以 main `d33f236`（SGEC-OFF 已合并 PR194）与源码为准；配置/真实启动/真实使用步骤仅静态核对，未宣称真实 Provider 实测通过。
- 父 Harness 三树 r0 全通过（Vitest 1270/57、pytest 1068/3w/81.00%/83.99s、E2E 258 C129/W129 actual0），源码栅栏稳定。

## R1 收口（评审后修正）

R0 评审指出使用安全与行为表述问题，R1 同轮修正（不新增范围）：删除 `.env.example` 覆盖式复制命令，配置操作改链接 README
并完整列出 `LIVEKIT_URL/LIVEKIT_API_KEY/LIVEKIT_API_SECRET`；按 `conversationSlice`/`EndedConversation` 实际行为修正
结束流程与转录说明（结束先停采音/卸载 Room、失败待重试、不自动回首页、结束视图不渲染完整历史转录）；修正 Mermaid 令牌/dispatch
控制关系、双向媒体与 Worker 读写 PG；修正仓库地图 `lib` 实际文件与分层；澄清周概览在 Dashboard 内、无独立周度学习页；把
「无 Key 只能跑自动化」改为正向说明并给出 Vitest/Fake E2E 命令与端口；四进程命令明确从仓库根执行；§5 登录分别说明 dev token
与 OIDC。源码/测试/配置零改，三树无需重复。
