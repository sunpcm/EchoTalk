# EchoTalk 功能、进度与待办总账（唯一事实来源）

> 本文是产品负责人唯一需要查看的“功能/子功能/当前进度/未验收/待办/卡点/开单”正本。
> 根目录 [`README.md`](./README.md) 保留项目入口、开发启动/配置命令、目录与安全边界；
> [`docs/README.md`](./docs/README.md) 只做文档导航，不维护第二份进度。
> 过时状态页、阶段计划与旧决策准备已归档到
> [`docs/`](./docs/archive/2026-11-21-document-consolidation/)，
> 只作原时点历史，不再作为当前状态权威。
> 有效技术契约、操作手册、验收证据与历史记录仍保留在 `docs/` 原位置，作为实施参考与证据，不承载“当前是否完成”的口径。

## 状态口径

每条小功能或待办，用四档**分别**标注，不用一个词代替全部：

- **代码（Code）**：源码/迁移/脚本/配置是否已存在于当前 `main` 或指定 PR 分支。
- **自动化（Auto）**：单元/Vitest/Playwright/pytest/合成 PG 等本地或 CI 自动化是否已跑通，并绑定提交。
- **真实验收（Real）**：真实 IdP、LiveKit、Provider、设备、媒体、生产数据、部署是否已验证。
- **交付（Delivery）**：代码是否已合入主线；是否已通过正式发布、上架或部署。合入
  `main` 只代表已合入主线，不代表已部署或上架。

“代码已做”不等于“自动化通过”；“自动化通过”不等于“真实验收”；“发布候选通过”不等于“已发布”。
未验证一律写“未验/待验”，不写“已完成”“已通过”“已上线”。

小功能状态格使用 `代码/自动/真实/交付` 四档标签；“全量矩阵”仅指 PR203 候选分支的历史全量
回归，不代替未单独追溯项目的逐项自动化证据。历史矩阵继续绑定
`main@8c2c1b995f76a98772665d070586cf98e25385fe` 与 `PR203@cce1d5de`（2026-11-21 核对）；
2026-11-26 当前验收 worktree 基线为 `ccc258442be841a59bb19a3f1c9b061fe55b7d1e`。

## 当前版本与 PR/main 关系

- 唯一主仓 `sunpcm/EchoTalk`；实时 `origin/main` = `8c2c1b995f76a98772665d070586cf98e25385fe`。
- 已合入 `main` 的关键 PR（按时间）：
  - [PR195](https://github.com/sunpcm/EchoTalk/pull/195) `dac4d25`：Overview 概览文档。
  - [PR196](https://github.com/sunpcm/EchoTalk/pull/196) `da37683`：下一阶段决策准备。
  - [PR197](https://github.com/sunpcm/EchoTalk/pull/197) `73ab94d`：B1 / 平台 / 周报时长 / 场景目标。
  - [PR199](https://github.com/sunpcm/EchoTalk/pull/199) `5d36412`：Chromium Promise GC 测试夹具修复。
  - [PR202](https://github.com/sunpcm/EchoTalk/pull/202) `8c2c1b9`：B2 学习事件 / 无 Key 资产。
- 当前 open PR 共 2 条：
  - [PR142](https://github.com/sunpcm/EchoTalk/pull/142)（历史 Draft，head `2de5184`）：A4a 只读查询控制器。相关只读 data 能力后来已通过 PR149 进入 `main`，本 PR 剩余旧分支差异待核对，由用户决定关闭或保留，不自动 merge/close，也不是“A4a 还没开发”。
  - [PR203](https://github.com/sunpcm/EchoTalk/pull/203)：SGEC 接线，当前验收基线
    `ccc2584`，open/unmerged；新修复候选未合 `main`，远端 CI 以实际 PR head 为准，
    **不得写成已合 main 或已上线**。
- 2026-11-21 曾暂停 iOS 及全部后续产品开发；2026-11-23 已改为有界恢复：受控读取凭据状态 →
  两次固定只读 GET → 仅按实测做最小修复 → 真实验收 → 再判断新功能。总产品验收预算为
  **10 USD**，仅限隔离验收范围并沿用既有逐步授权；不部署、不扩 iOS、不自动启动服务或超预算。
- 2026-11-26 凭据来源：专用 1Password Environment 已整理为唯一 6 字段；旧重复
  Environment 已确认无挂载并进入可逆归档路径。SGEC 进程统一复用单一
  `SILICONFLOW_API_KEY`；本页不记录 Key、账号 ID 或 Environment ID。
- 2026-11-26 只读鉴权：中国站目录 `GET /v1/models?sub_type=chat` 返回 `200`，列出 59 个模型且
  `Qwen/Qwen3-30B-A3B-Instruct-2507` 在列；STT `200`、TTS `200`、LiveKit 过滤房间查询成功。
  同一有效 Key 对历史 `GET /v1/user/info` 返回 `410`，该地址仅保留诊断；另一个旧 Key 返回
  `401`，不能与本次有效 Key 的结果混淆。
- 2026-11-26 生产凭据校验：SiliconFlow `verified`、TTS `verified`；STT 本次为
  `timeout`，其先前独立 GET 曾返回 `200`，不能据此声称 Provider 已失效。
- 2026-11-26 SGEC 实际发送：选定模型一次 POST 返回 HTTP `402`，错误为
  `sgec_llm_transport_failed`，没有有效响应；按
  [官方错误码 FAQ](https://docs.siliconflow.cn/docs/userguide/faqs/error-code)，`402` 表示
  账户欠费，应充值后再试，本轮不自充。本机受限 `.env` 已完成受控注入实测（不记录路径或
  密钥）；目录实际列出的公开 free 模型 `Qwen/Qwen2.5-7B-Instruct` 一次 POST 也返回 HTTP
  `402`。原模型与 free 均无有效推理响应；此前 exit `9` 只是历史未确认试次，不再重试或充值。
- 上述状态只证明鉴权/目录与本轮请求边界。正确 SDK HTTP context 后，Cartesia
  `sonic-3` 合成 16 帧/1.61 秒通过；该音频交给 Deepgram `nova-3` 未识别出文本，
  独立本机 16k、2.053 秒合成句识别通过且预期词语完全匹配。初次两次 `APIConnectionError` 是
  harness 缺少 `http_context.open()`，不作为 Provider 失败。完整双向 LiveKit 媒体、账本、
  Gold、付费金额及完整 SGEC 链路仍未验，不能计为完成。

## 历史验证矩阵（PR203 候选分支，主控 2026-11-21 实际回读）

以下数字只绑定 PR203 分支 `cce1d5de`，不等同 `main`，也不证明真实外部依赖已验收。

2026-11-23 历史最小修复节点（继续绑定 `cce1d5de`）：backend 全树 1778 passed / 3 warnings /
coverage 81.90%（PG 15.19 专用库）；Vitest 1429、Playwright 326 通过，前端/依赖相关文件
相对该历史 baseline 逐字节未改。另有 132 项定向纯测试、22 项私有探针（原 2 RED 现 GREEN）、
运行时 4 变异 + 前检 4 变异均杀死并原字节恢复为 GREEN。这组历史自动化不证明真实 API。

2026-11-26 当前候选的 backend 全树为 1787 passed / 3 warnings / coverage 81.94%
（PG 15.19 专用库从 tmpfs 空库重建，未变更迁移源码）；独立定向 90、私有 17、Vitest 1429、
Playwright 326 已通过。另有 3 项私有变异（旧 URL、redirect、旧 gate）均
GREEN→RED→恢复 GREEN。远端 CI 以 PR 实际 head 为准，不能用上述历史或局部结果替代。

| 项目                | 结果                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| backend pytest      | 1729 passed / 3 warnings / 82.05% coverage                                                      |
| SGEC PG 定向        | 53 passed（SGEC 21 + 原 pipeline 32）                                                           |
| SGEC 纯模块         | 106 passed                                                                                      |
| 独立 pure / PG 探针 | 95 / 10 passed                                                                                  |
| 私有变异            | 5 项有效变异杀死并原字节恢复                                                                    |
| 文档原 Python smoke | 7 正负例通过                                                                                    |
| 前端 Vitest         | 1429 passed                                                                                     |
| Fake API            | 141 passed                                                                                      |
| build               | 47 passed                                                                                       |
| API types           | 10 passed                                                                                       |
| Playwright E2E      | 326 = Chromium 163 + WebKit 163，0 retry/skip/flaky                                             |
| 远端 CI             | [44895438421](https://github.com/sunpcm/EchoTalk/actions/runs/44895438421) 五 delivery job 成功 |
| PR Guard            | [44895438379](https://github.com/sunpcm/EchoTalk/actions/runs/44895438379) 成功                 |

> iOS job 仅无签名 Simulator 编译，macOS 仅 probe，不等于真机/正式客户端/分发。

## 使用流程

1. 选择推荐场景或导入 DocTalk 文本，进入会话。
2. 实时语音练习：LiveKit WebRTC + Agent STT→LLM→TTS，实时转录与反馈。
3. 结束后，会话结束事务创建唯一分析 Job，独立 Worker 领取并回写发音/语法评估与 BKT 知识状态。
4. 在 Dashboard 查看每日/周进度、周语法 Top3、技能掌握度与课程推荐。
5. 基础轨用服务端 Provider 配置；自定义轨在设置填写 BYOK 密钥并验证保存。

## 目录技术图

```text
apps/vite-app/                  React + TypeScript + Zustand，共享产品 UI（Web/iOS）
  src/components/               组件（auth、dashboard、session、review、doc-chat、settings、shared）
  src/data/                     只读查询控制器与数据访问 hooks
  src/platform/                 平台识别、地址与生命周期适配
  ios/                          Capacitor iOS 工程
backend/                        FastAPI + SQLAlchemy / Alembic
  livekit_agent/                LiveKit Agent：STT → LLM → TTS
  workers/analysis_worker.py    PostgreSQL 持久化分析任务 Worker
  services/                     分析、BKT 知识追踪、课程与设置等业务
  data/                         版本化离线教学语料（teaching_materials.json）
packages/configs/               共享工具配置
tools/macos-m1-native-probe/    可行性认证探针，非正式桌面工程
docs/                          架构、契约与验收资料
```

目录入口：[大功能总览](#大功能总览) · [小功能明细](#小功能明细) ·
[可行动待办表（23 项）](#可行动待办表23-项未完成--未验收) · [GitHub open issues 索引](#github-open-issues-索引17-条2026-11-21-只读快照) ·
[产品待裁定事项](#产品待裁定事项)。

## 大功能总览

| 域    | 大功能                     | 代码   | 自动化         | 真实验收                   | 交付       | 稳定 ID 前缀 |
| ----- | -------------------------- | ------ | -------------- | -------------------------- | ---------- | ------------ |
| AUTH  | 用户身份、账号与隐私       | 部分   | 部分           | 真实 IdP/原生登录未验      | 已合入主线 | `AUTH-`      |
| DASH  | 首页、课程与会话历史       | 已实现 | 已通过         | 未验                       | 已合入主线 | `DASH-`      |
| VOICE | 实时语音与教学反馈         | 已实现 | 部分           | 真实媒体/语音未验          | 已合入主线 | `VOICE-`     |
| DOC   | DocTalk 文档会话           | 已实现 | 已通过         | 真机文件选择未验           | 已合入主线 | `DOC-`       |
| SESS  | 会话可靠性与跨端           | 部分   | 部分           | Cloud 真实接管未验         | 已合入主线 | `SESS-`      |
| ANAL  | 分析、发音、语法与 SGEC    | 部分   | 部分           | 真实 Provider/发音未验     | SGEC 未合  | `ANAL-`      |
| BKT   | BKT 与学习事件             | 已实现 | 已通过（合成） | 生产真实数据未验           | 已合入主线 | `BKT-`       |
| GOAL  | 场景目标                   | 已实现 | 已通过（合成） | 真实教学/gold 未验         | 已合入主线 | `GOAL-`      |
| WEEK  | 周报与学习趋势             | 部分   | 部分           | 未验                       | 已合入主线 | `WEEK-`      |
| BYOK  | BYOK、设置、UI 与诊断      | 部分   | 已通过         | Provider 轮换/设备读屏未验 | 已合入主线 | `BYOK-`      |
| PLAT  | iOS / macOS / 工程与未来项 | 部分   | 部分           | 真机/签名/分发未验         | 部分       | `PLAT-`      |

## 小功能明细

每域一张表，列：稳定 ID、已做内容、代码归属（可点源码/测试）、自动化与真实边界、剩余项。
“已合入主线”只表示代码已合入 `main`，不代表已部署、上架或已验收。

### AUTH 用户身份、账号与隐私

| 稳定 ID   | 已做内容                                                                                                      | 代码归属                                                                                                                    | 自动化与真实边界                                                                                    | 剩余项                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `AUTH-01` | 开发/生产认证互斥：`AUTH_MODE=dev` 显式 token 与 `oidc` 互斥                                                  | [config.py](backend/config.py)、[test_config_security.py](backend/tests/test_config_security.py)                            | 代码：已实现<br>自动：全量矩阵<br>真实：未验<br>交付：已合入主线；未部署/上架                       | 真实 IdP 联调                                                                |
| `AUTH-02` | OIDC Code+PKCE，后端 `issuer/audience/JWKS` 校验，按 `(issuer, subject)` 隔离                                 | [auth.py](backend/auth.py)、[auth.ts](apps/vite-app/src/lib/auth.ts)、[test_auth.py](backend/tests/test_auth.py)            | 代码：已实现<br>自动：全量矩阵<br>真实：未验<br>交付：已合入主线；未部署/上架                       | 真实 IdP 联调                                                                |
| `AUTH-03` | 独立 macOS auth-only 探针已有系统浏览器/Keychain/PKCE/state/nonce/冷暖回跳/401 隔离及已安装包历史冷暖成功记录 | [探针 README](tools/macos-m1-native-probe/README.md)、[AUTH 验证](docs/verification/cross-platform/MACOS-M1-NATIVE-AUTH.md) | 代码：探针已实现<br>自动：历史全量矩阵<br>真实：历史局部实机；当前未验<br>交付：未接产品 UI、未上架 | 未接共享产品 UI；iOS/正式原生认证集成、产品长期凭据/自动续期与真机组合未完成 |
| `AUTH-04` | 隐私导出 `GET /api/user/data-export`，返回本人结构化 JSON，排除密钥与原始外部响应                             | [user.py](backend/routers/user.py)、[test_user_data_export.py](backend/tests/test_user_data_export.py)                      | 代码：已实现<br>自动：全量矩阵<br>真实：生产数据未验<br>交付：已合入主线；未部署/上架               | 前端管理入口、生产数据验证                                                   |
| `AUTH-05` | 整账号删除 `DELETE /api/user/account`，按依赖与生命周期锁清理，不删外部 IdP 账号                              | [user.py](backend/routers/user.py)、[test_user_account_deletion.py](backend/tests/test_user_account_deletion.py)            | 代码：已实现<br>自动：全量矩阵<br>真实：生产删除未验<br>交付：已合入主线；未部署/上架               | 前端管理入口、生产数据验证                                                   |

### DASH 首页、课程与会话历史

| 稳定 ID   | 已做内容                                                                     | 代码归属                                                                                                                                                                                               | 自动化与真实边界                                                                      | 剩余项              |
| --------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------- |
| `DASH-01` | 三顶层视图 Dashboard / doc-chat-setup / VoiceInterface，无 React Router      | [App.tsx](apps/vite-app/src/App.tsx)、[Dashboard.tsx](apps/vite-app/src/components/dashboard/Dashboard.tsx)                                                                                            | 代码：已实现<br>自动：全量矩阵<br>真实：未验<br>交付：已合入主线；未部署/上架         | —                   |
| `DASH-02` | 推荐场景、活动会话、每日/周进度、周语法 Top3、技能树、设置/DocTalk 入口      | [Dashboard.tsx](apps/vite-app/src/components/dashboard/Dashboard.tsx)、[WeeklyProgress.test.tsx](apps/vite-app/src/components/dashboard/WeeklyProgress.test.tsx)                                       | 代码：已实现<br>自动：全量矩阵<br>真实：未验<br>交付：已合入主线；未部署/上架         | —                   |
| `DASH-03` | 只读 data 层：只读查询、加载/空/错误、局部重试、认证 revision 与迟到响应隔离 | [readonly-query.ts](apps/vite-app/src/data/readonly-query.ts)、[readonly-query.test.ts](apps/vite-app/src/data/readonly-query.test.ts)、[契约](docs/FRONTEND_DATA_LAYER_CONTRACT.md)                   | 代码：已实现<br>自动：全量矩阵<br>真实：未验<br>交付：已合入主线；未部署/上架         | —                   |
| `DASH-04` | 自适应课程：读薄弱技能，离线版本化教学目录按 CEFR 到 i+1 确定性排序          | [material_catalog.py](backend/services/material_catalog.py)、[test_curriculum.py](backend/tests/test_curriculum.py)、[rag_service.py](backend/services/rag_service.py)                                 | 代码：已实现<br>自动：全量矩阵<br>真实：未验<br>交付：已合入主线；未部署/上架         | 无外部 RAG/向量服务 |
| `DASH-05` | 教学目录 10 条材料，其中 3 条有 goals                                        | [teaching_materials.json](backend/data/teaching_materials.json)、[test_curriculum.py](backend/tests/test_curriculum.py)                                                                                | 代码：已实现<br>自动：全量矩阵<br>真实：教学内容未验<br>交付：已合入主线；未部署/上架 | —                   |
| `DASH-06` | 会话列表/详情/active/daily/weekly，owner-scoped，completed 即计 1 次         | [sessions.py](backend/routers/sessions.py)、[test_session_pagination.py](backend/tests/test_session_pagination.py)、[test_session_active_discovery.py](backend/tests/test_session_active_discovery.py) | 代码：已实现<br>自动：全量矩阵<br>真实：未验<br>交付：已合入主线；未部署/上架         | —                   |

### VOICE 实时语音与教学反馈

| 稳定 ID    | 已做内容                                                                                | 代码归属                                                                                                                                                                                                                                                     | 自动化与真实边界                                                                                              | 剩余项                      |
| ---------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `VOICE-01` | LiveKit WebRTC + Agent STT→LLM→TTS；Deepgram/Cartesia/SiliconFlow/OpenRouter/Silero VAD | [pyproject.toml](backend/pyproject.toml)、[livekit_agent](backend/livekit_agent)、[test_livekit_agent.py](backend/tests/test_livekit_agent.py)                                                                                                               | 代码：基础语音已实现<br>自动：全量矩阵；项目未单独核验<br>真实：待验<br>交付：已合入主线；Cloud 接线/部署待验 | 真实媒体质量                |
| `VOICE-02` | 会话建立：readiness→创建→本地签发 Token→Room→dispatch，H1 启动 factory                  | [sessions.py](backend/routers/sessions.py)、[conversationStartup.ts](apps/vite-app/src/store/conversationStartup.ts)、[test_session_connect_policy.py](backend/tests/test_session_connect_policy.py)                                                         | 代码：已实现<br>自动：全量矩阵；项目未单独核验<br>真实：未验<br>交付：已合入主线；未部署/上架                 | 真实链路                    |
| `VOICE-03` | 字幕/Agent 错误/安全结束/分析状态                                                       | [ChatSubtitles.tsx](apps/vite-app/src/components/session/ChatSubtitles.tsx)、[ChatSubtitles.test.tsx](apps/vite-app/src/components/session/ChatSubtitles.test.tsx)、[VoiceInterface.test.tsx](apps/vite-app/src/components/session/VoiceInterface.test.tsx)  | 代码：已实现<br>自动：全量矩阵<br>真实：未验<br>交付：已合入主线；未部署/上架                                 | 真实媒体                    |
| `VOICE-04` | 转录持久化与幂等/冲突校验                                                               | [transcript_sink.py](backend/livekit_agent/transcript_sink.py)、[test_transcript_idempotency.py](backend/tests/test_transcript_idempotency.py)                                                                                                               | 代码：已实现<br>自动：全量矩阵<br>真实：未验<br>交付：已合入主线；未部署/上架                                 | 真实媒体                    |
| `VOICE-05` | 情绪启发式：文本犹豫词/发言时间窗估算，`anxiety>0.6` 换鼓励 prompt                      | [emotion_analyzer.py](backend/services/emotion_analyzer.py)、[test_emotion_analyzer.py](backend/tests/test_emotion_analyzer.py)、[test_livekit_agent.py](backend/tests/test_livekit_agent.py)                                                                | 代码：启发式与提示已实现<br>自动：全量矩阵；项目未单独核验<br>真实：未验<br>交付：已合入主线；未部署/上架     | 非声学/临床，不等于周度趋势 |
| `VOICE-06` | 回答建议 UI 单实例，文本聊天/推荐走现有 LLM 服务                                        | [AnswerRecommendations.tsx](apps/vite-app/src/components/session/AnswerRecommendations.tsx)、[AnswerRecommendations.test.tsx](apps/vite-app/src/components/session/AnswerRecommendations.test.tsx)、[test_llm_service.py](backend/tests/test_llm_service.py) | 代码：已实现<br>自动：全量矩阵<br>真实：外部质量未验<br>交付：已合入主线；未部署/上架                         | 外部生成质量                |
| `VOICE-07` | 实时打断/弱网/蓝牙路由/来电/锁屏                                                        | [RoomSession.tsx](apps/vite-app/src/components/session/RoomSession.tsx)、[roomAudio.ts](apps/vite-app/src/components/session/roomAudio.ts)                                                                                                                   | 代码：部分能力有平台适配<br>自动：局部覆盖，全量矩阵不代替设备<br>真实：未验<br>交付：未达到设备交付          | 真实设备验收                |

### DOC DocTalk 文档会话

| 稳定 ID  | 已做内容                                                                                     | 代码归属                                                                                                                                                           | 自动化与真实边界                                                                              | 剩余项           |
| -------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------- |
| `DOC-01` | 本地 txt/md 读取、草稿、自定义 prompt、取消/错误/空文件/大小与编码约束，正文上限 50,000 字符 | [DocChatSetup.tsx](apps/vite-app/src/components/doc-chat/DocChatSetup.tsx)、[DocUploadCard.test.tsx](apps/vite-app/src/components/doc-chat/DocUploadCard.test.tsx) | 代码：已实现<br>自动：全量矩阵<br>真实：未验<br>交付：已合入主线；未部署/上架                 | —                |
| `DOC-02` | 文档原文随会话 context 存 PG，Agent 动态系统提示用文档上下文                                 | [schemas/conversation.py](backend/schemas/conversation.py)、[test_livekit_agent.py](backend/tests/test_livekit_agent.py)                                           | 代码：已实现<br>自动：全量矩阵；项目未单独核验<br>真实：未验<br>交付：已合入主线；未部署/上架 | —                |
| `DOC-03` | 不支持 PDF/Word 解析、知识库上传索引                                                         | —                                                                                                                                                                  | 代码：范围外<br>自动：不适用<br>真实：iOS 文件选择未验<br>交付：未交付                        | iOS 真机文件选择 |

### SESS 会话可靠性与跨端

| 稳定 ID   | 已做内容                                                                                                                                                                                            | 代码归属                                                                                                                                                                                          | 自动化与真实边界                                                                                                               | 剩余项                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `SESS-01` | 创建/结束幂等、活动会话发现、显式恢复、失败重试、token 失败清理、dispatch 归属、旧会话不复活                                                                                                        | [sessions.py](backend/routers/sessions.py)、[session_idempotency.py](backend/services/session_idempotency.py)、[conversationStartup.test.ts](apps/vite-app/src/store/conversationStartup.test.ts) | 代码：已实现<br>自动：全量矩阵<br>真实：待验<br>交付：已合入主线；未部署/上架                                                  | 真实媒体                                                            |
| `SESS-02` | Cloud 单端占用原语 claim/heartbeat/release + 独立 controller 已实现；`CALL_LEASE_MODE` 默认 disabled，[conversationStartup.ts](apps/vite-app/src/store/conversationStartup.ts) 在非 disabled 时拒绝 | [call_capabilities.py](backend/routers/call_capabilities.py)、[call_leases.py](backend/services/call_leases.py)、[test_call_leases.py](backend/tests/test_call_leases.py)                         | 代码：部分；原语已实现，产品 Cloud 启动/恢复/UI 未接线<br>自动：局部及全量矩阵<br>真实：未验<br>交付：已合入主线；Cloud 未交付 | 产品共享启动/恢复/UI 接线，Cloud 多端真实接管/旧端媒体撤销/失效清理 |
| `SESS-03` | platform 薄适配、webLifecycle/lifecycle，native App 状态薄适配、就绪门禁、Room 中断停轨源码存在                                                                                                     | [platform](apps/vite-app/src/platform)、[lifecycle.test.ts](apps/vite-app/src/platform/lifecycle.test.ts)、[RoomSession.tsx](apps/vite-app/src/components/session/RoomSession.tsx)                | 代码：部分<br>自动：全量矩阵；项目未单独核验<br>真实：真机组合未验<br>交付：已合入主线；未完成                                 | 系统认证/安全存储/麦克风能力接口及真机组合                          |

### ANAL 分析、发音、语法与 SGEC

| 稳定 ID   | 已做内容                                                                                                                                                                | 代码归属                                                                                                                                                                                 | 自动化与真实边界                                                                                                                                                                                                        | 剩余项                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `ANAL-01` | 持久化分析 Job：会话结束事务建唯一 Job、Worker 领取、有限重试、stale 恢复、队列诊断；成功 Job 不开放重分析                                                              | [analysis_worker.py](backend/workers/analysis_worker.py)、[test_analysis_jobs.py](backend/tests/test_analysis_jobs.py)、[test_analysis_worker.py](backend/tests/test_analysis_worker.py) | 代码：已实现<br>自动：全量矩阵<br>真实：未验<br>交付：已合入主线；未部署/上架                                                                                                                                           | —                                                   |
| `ANAL-02` | 发音 Provider `DemoMockPronunciationProvider`（文本模拟音素）；`USE_MOCK_ELSA=False` 为 not_called/disabled，不调真实 Provider、不阻断语法                              | [assessment_providers.py](backend/services/assessment_providers.py)、[test_assessment_providers.py](backend/tests/test_assessment_providers.py)                                          | 代码：仅文本模拟<br>自动：全量矩阵<br>真实：未验<br>交付：已合入主线；真实发音未交付                                                                                                                                    | 真声学 ELSA/第三方评分                              |
| `ANAL-03` | 语法评估：DemoRule 文本规则；真实 SGEC 经 `GrammarProvider` 提供 source/provider/model_version/synthetic/confidence；synthetic 不写真实知识                             | [assessment_providers.py](backend/services/assessment_providers.py)、[test_assessment_providers.py](backend/tests/test_assessment_providers.py)                                          | 代码：Demo 已实现；真实语法在 PR203<br>自动：历史矩阵绑定 `cce1d5de`；11/26 定向结果见验收状态<br>真实：鉴权局部通过，SGEC POST HTTP 402 且无有效响应<br>交付：Demo 已合入主线；真实语法未交付                          | 账户欠费充值/真实推理/version、人工 gold=0          |
| `ANAL-04` | SGEC 离线契约（**仅**结构 validator、CLI、24 合成候选）已合 main PR194                                                                                                  | [sgec_offline.py](backend/services/sgec_offline.py)、[test_sgec_offline.py](backend/tests/test_sgec_offline.py)、[CLI](backend/scripts/evaluate_sgec_offline.py)                         | 代码：已实现<br>自动：全量矩阵<br>真实：不调用真实 Provider<br>交付：已合入主线；未部署/上架                                                                                                                            | 不含 adapter/transport/wiring                       |
| `ANAL-05` | SGEC 接线：Adapter、OpenAI-compatible Provider、HTTPS transport、严格 JSON/超时/取消/关闭、整批拒绝/duplicate/unknown/blank/confidence 保真；validator 改用模型目录鉴权 | [PR203](https://github.com/sunpcm/EchoTalk/pull/203)、[test_sgec_adapter.py](backend/tests/test_sgec_adapter.py)、[test_sgec_pipeline.py](backend/tests/test_sgec_pipeline.py)           | 代码：PR203 validator 修复候选待 Review<br>自动：历史矩阵绑定 `cce1d5de`；11/26 backend 全树 1787 passed / 3 warnings / coverage 81.94%<br>真实：四家鉴权局部通过；SGEC HTTP 402，无有效响应<br>交付：PR203 未合入 main | 账户欠费、成功推理、完整语音媒体/账本/Gold/付费金额 |
| `ANAL-06` | 未实现：发音真实评估的音频切片采集设计                                                                                                                                  | —                                                                                                                                                                                        | 代码：未实现<br>自动：未测试<br>真实：未验<br>交付：未交付                                                                                                                                                              | 全部                                                |

PR202 已合入主线的无 Key 预备资产（合成候选与待标模板，非人工 gold；本任务人工 gold=0）：
[SGEC 24 条合成候选](docs/evaluation/sgec_candidates.v1.json)、
[场景目标 24 条合成候选](docs/evaluation/goal_candidates.v1.json)、
[24 条待标模板](docs/evaluation/goal_annotation_template.v1.json)、
[盲标指南](docs/GOLD_ANNOTATION_GUIDE.md)、
[真实流程受控工具](backend/scripts/real_flow_acceptance.py)（plan/probe/verify/execute 计划、探测、校验、执行阶段）。
这些资产为后续真实 API 与人工标注提供准备；现有离线脚本不证明真实链路通过，真实环境仍未验。

2026-11-26 validator 存在两层不同门禁，详细契约见
[SGEC API 验收 §5](docs/SGEC_API_ACCEPTANCE.md#5-sgec-api-脱敏只读前检)：生产
`ProviderValidationService` 对 `GET /v1/models?sub_type=chat` 只要求 HTTP `200`；
`siliconflow_preflight execute` 在 `200` 之外还要求合法 schema 与选定模型在列。历史
`/v1/user/info` 仅作前检诊断，`410`/`401`/网络失败都不否定已通过的新目录门禁。

### BKT 与学习事件

| 稳定 ID  | 已做内容                                                                                                                      | 代码归属                                                                                                                                                                                                      | 自动化与真实边界                                                                               | 剩余项                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------- |
| `BKT-01` | 10 项 SEED_SKILLS、bkt-v1 四参数冻结；synthetic 事件记账但不读/建/改真实知识状态                                              | [bkt_model.py](backend/services/knowledge/bkt_model.py)、[test_bkt_model.py](backend/tests/test_bkt_model.py)                                                                                                 | 代码：已实现<br>自动：全量矩阵<br>真实：教学质量未验<br>交付：已合入主线；未部署/上架          | 真实教学质量                            |
| `BKT-02` | B2 学习事件：幂等键、Job→User 锁序、同事务、七键 coverage、unmapped 跳过、来源版本非空门禁、ALWAYS identity+shape 约束        | [PR202](https://github.com/sunpcm/EchoTalk/pull/202)、[test_b2_learning_event_write.py](backend/tests/test_learning_event_write.py)、[test_b2_ledger_hardening.py](backend/tests/test_b2_ledger_hardening.py) | 代码：已实现<br>自动：全量矩阵及合成 PG<br>真实：生产数据未验<br>交付：已合入主线；未部署/上架 | 生产真实数据                            |
| `BKT-03` | replay：RR READ ONLY、watermark、算法版本映射、完整批次校验                                                                   | [test_b2_learning_event_replay.py](backend/tests/test_b2_learning_event_replay.py)、[test_learning_event_replay.py](backend/tests/test_learning_event_replay.py)                                              | 代码：已实现<br>自动：全量矩阵及合成 PG<br>真实：未验<br>交付：已合入主线；未部署/上架         | —                                       |
| `BKT-04` | 失败重试沿同 Job 幂等，不开放成功后重分析                                                                                     | [analysis_jobs.py](backend/services/analysis_jobs.py)、[test_analysis_jobs.py](backend/tests/test_analysis_jobs.py)                                                                                           | 代码：已实现<br>自动：全量矩阵<br>真实：未验<br>交付：已合入主线；未部署/上架                  | —                                       |
| `BKT-05` | 隐私导出/删除已适配事件                                                                                                       | [test_user_data_export.py](backend/tests/test_user_data_export.py)、[test_user_account_deletion.py](backend/tests/test_user_account_deletion.py)                                                              | 代码：已实现<br>自动：全量矩阵<br>真实：生产维护未验<br>交付：已合入主线；未部署/上架          | 备份恢复不复活删户                      |
| `BKT-06` | 开发期口径：不承接旧测试 Job/状态、不 baseline/回填、不从 knowledge_states 倒推；新真实观察从 p_init=.1 开始；无 cutover 准入 | [test_b2_ledger_hardening.py](backend/tests/test_b2_ledger_hardening.py)、[B2 契约](docs/B2_LEDGER_CONTRACT.md)                                                                                               | 代码：开发期口径已实现<br>自动：全量矩阵及合成 PG<br>真实：未验<br>交付：生产另定；未交付      | 真实用户迁移/retention/生产清理另定计划 |

### GOAL 场景目标

| 稳定 ID   | 已做内容                                                                                                                       | 代码归属                                                                                                                                                                                                                | 自动化与真实边界                                                                       | 剩余项          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------- |
| `GOAL-01` | 版本化 catalog、事务 snapshot、append-only run/results、evidence 顺序/digest、deterministic-goal-v2、四终态、失败/重试独立呈现 | [goal_rules.py](backend/services/goal_rules.py)、[test_goal_evaluation.py](backend/tests/test_goal_evaluation.py)、[test_session_goal_snapshot.py](backend/tests/test_session_goal_snapshot.py)                         | 代码：已实现<br>自动：全量矩阵及合成 PG<br>真实：未验<br>交付：已合入主线；未部署/上架 | 真实教学        |
| `GOAL-02` | 结果摘要只给达成/已评/总数 + unknown/not_assessed，不显示百分比                                                                | [use-session-goals-query.ts](apps/vite-app/src/data/use-session-goals-query.ts)、[api.goals-view.test.ts](apps/vite-app/src/lib/api.goals-view.test.ts)、[goal-results.spec.ts](apps/vite-app/e2e/goal-results.spec.ts) | 代码：已实现<br>自动：全量矩阵<br>真实：未验<br>交付：已合入主线；未部署/上架          | —               |
| `GOAL-03` | include_goals opt-in；3/10 目录有目标                                                                                          | [teaching_materials.json](backend/data/teaching_materials.json)、[test_goal_rules.py](backend/tests/test_goal_rules.py)                                                                                                 | 代码：已实现<br>自动：全量矩阵<br>真实：gold=0，未验<br>交付：已合入主线；未部署/上架  | 真实教学/gold=0 |

### WEEK 周报与学习趋势

| 稳定 ID   | 已做内容                                                                                    | 代码归属                                                                                                                                                                                                      | 自动化与真实边界                                                                              | 剩余项                 |
| --------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------- |
| `WEEK-01` | rolling7 按本地自然日、started_at 归属；次数/每日历史/grammarTop3，Top3 排除 demo/synthetic | [sessions.py](backend/routers/sessions.py)、[test_session_weekly_progress.py](backend/tests/test_session_weekly_progress.py)、[test_weekly_grammar.py](backend/tests/test_weekly_grammar.py)                  | 代码：已实现<br>自动：全量矩阵<br>真实：未验<br>交付：已合入主线；未部署/上架                 | —                      |
| `WEEK-02` | 已记录会话时长 opt-in + 合计与每日三态显示，指标是 ended_at-started_at                      | [sessions.ts](apps/vite-app/src/lib/api/sessions.ts)、[sessions.py](backend/routers/sessions.py)、[WeeklyProgress.duration.test.tsx](apps/vite-app/src/components/dashboard/WeeklyProgress.duration.test.tsx) | 代码：已实现<br>自动：全量矩阵；项目未单独核验<br>真实：未验<br>交付：已合入主线；未部署/上架 | 不等于有效说话时长     |
| `WEEK-03` | 未实现：掌握度环比/发音/焦虑/语速趋势                                                       | —                                                                                                                                                                                                             | 代码：未实现<br>自动：未测试<br>真实：未验<br>交付：未交付                                    | 全部（口径与真实输入） |
| `WEEK-04` | 未实现：下周重点与会后到下一通练习的完整闭环                                                | —                                                                                                                                                                                                             | 代码：未实现<br>自动：未测试<br>真实：未验<br>交付：未交付                                    | 全部                   |

### BYOK、设置、UI 与诊断

| 稳定 ID   | 已做内容                                                                         | 代码归属                                                                                                                                                                                                                             | 自动化与真实边界                                                                                                        | 剩余项                         |
| --------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `BYOK-01` | 设置持久化/水合/草稿/校验、free 默认 custom、多 Provider Key 并行验证、失败短路  | [user.py](backend/routers/user.py)、[user_settings_service.py](backend/services/user_settings_service.py)、[test_settings_parallel_validation.py](backend/tests/test_settings_parallel_validation.py)                                | 代码：已实现<br>自动：全量矩阵<br>真实：Provider 校验未验<br>交付：已合入主线；未部署/上架                              | Provider 校验/轮换与可用性     |
| `BYOK-02` | Fernet 版本化 keyring/懒解密、role 目录、显示 metadata、SDK 连接策略/错误码映射  | [test_settings_lazy_decryption.py](backend/tests/test_settings_lazy_decryption.py)、[provider_registry.py](backend/livekit_agent/provider_registry.py)、[test_provider_registry.py](backend/tests/test_provider_registry.py)         | 代码：已实现<br>自动：全量矩阵<br>真实：轮换/撤销未验<br>交付：已合入主线；未部署/上架                                  | 真实轮换/撤销                  |
| `BYOK-03` | 三主题暖/冷/暗、持久化/同步、键盘焦点、safe area/动态视口/字号/触控目标/取消动效 | [SettingsAppearance.tsx](apps/vite-app/src/components/settings/SettingsAppearance.tsx)、[theme-contrast.spec.ts](apps/vite-app/e2e/theme-contrast.spec.ts)、[theme-transitions.spec.ts](apps/vite-app/e2e/theme-transitions.spec.ts) | 代码：主题与局部可访问性<br>自动：全量矩阵<br>真实：产品 WCAG/设备读屏/深色实测未验<br>交付：已合入主线；未完成设备验收 | 全产品 WCAG/设备读屏/深色实测  |
| `BYOK-04` | i18n 脚手架：中文文案集中 zh-CN.ts 和 skillLabels                                | [zh-CN.ts](apps/vite-app/src/i18n/zh-CN.ts)、[no-hardcoded-copy.test.ts](apps/vite-app/src/i18n/no-hardcoded-copy.test.ts)                                                                                                           | 代码：单语言脚手架<br>自动：全量矩阵<br>真实：多语言未验<br>交付：已合入主线；正式 i18n 未交付                          | 正式 i18n 框架/语言切换/多语言 |
| `BYOK-05` | SettingsDiagnostics 本地脱敏诊断导出及白名单 record                              | [SettingsDiagnostics.tsx](apps/vite-app/src/components/settings/SettingsDiagnostics.tsx)、[SettingsDiagnostics.test.tsx](apps/vite-app/src/components/settings/SettingsDiagnostics.test.tsx)                                         | 代码：已实现<br>自动：全量矩阵<br>真实：未验<br>交付：已合入主线；未部署/上架                                           | 非自动上传遥测/线上监控        |

### PLAT iOS / macOS / 工程与未来项

| 稳定 ID   | 已做内容                                                                                                       | 代码归属                                                                                                                                                                                                 | 自动化与真实边界                                                                             | 剩余项                                       |
| --------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `PLAT-01` | iOS Capacitor 共享 React：工程/AudioSession/safearea/生命周期/build+sync/CI Simulator                          | [App.xcodeproj](apps/vite-app/ios/App/App.xcodeproj)、[Info.plist](apps/vite-app/ios/App/App/Info.plist)、[capacitor.config.ts](apps/vite-app/capacitor.config.ts)                                       | 代码：部分<br>自动：CI Simulator<br>真实：真机未验<br>交付：未签名；未上架                   | 真机登录/音频/中断/签名/TestFlight，当前暂停 |
| `PLAT-02` | macOS：生产 Web 产物/同步脚本、Tauri M1 认证/媒体探针、native probe CI                                         | [探针 README](tools/macos-m1-native-probe/README.md)、[AUTH 验证](docs/verification/cross-platform/MACOS-M1-NATIVE-AUTH.md)                                                                              | 代码：探针<br>自动：探针 CI<br>真实：局部历史证据<br>交付：未接产品 UI；未发行               | 未接产品 UI，未发行桌面客户端                |
| `PLAT-03` | 工程：Node22/pnpm10.26、Python3.12/uv0.9.18、依赖锁/角色分组、Docker 分离、PG 持久队列、Compose 一次性迁移 DAG | [pyproject.toml](backend/pyproject.toml)、[Dockerfile](backend/Dockerfile)、[docker-compose.yml](docker-compose.yml)、[test_compose_startup_contract.py](backend/tests/test_compose_startup_contract.py) | 代码：已实现<br>自动：全量矩阵<br>真实：整栈未验<br>交付：已合入主线；未部署                 | 真实整栈起栈/宿主入口/生产                   |
| `PLAT-04` | CI 门禁：单元/E2E/PG、OpenAPI/Agent 漂移、iOS/macOS 编译、mass deletion guard                                  | [ci.yml](.github/workflows/ci.yml)、[PR Guard](.github/workflows/pr-guard.yml)                                                                                                                           | 代码：已实现<br>自动：PR203 CI 成功<br>真实：设备/生产未验<br>交付：已合入主线；分支保护未核 | required-check 分支保护配置未核验            |
| `PLAT-05` | 未实现：数字人前端与音视频同步                                                                                 | —                                                                                                                                                                                                        | 代码：未实现<br>自动：未测试<br>真实：未验<br>交付：未交付                                   | 全部                                         |
| `PLAT-06` | 未实现：Android/Windows 平台最小验证                                                                           | —                                                                                                                                                                                                        | 代码：未实现<br>自动：未测试<br>真实：未验<br>交付：未交付                                   | 全部                                         |
| `PLAT-07` | 未实现：后台语音/跨设备接力/托盘/全局快捷键/自动更新                                                           | —                                                                                                                                                                                                        | 代码：未实现<br>自动：未测试<br>真实：未验<br>交付：未交付                                   | 全部                                         |

## 可行动待办表（23 项：未完成 / 未验收）

每项给稳定任务 ID，标明关联模块、当前状态、下一步与验收条件、卡点/前提、是否待用户裁定。
“本地 ID”指未在 GitHub 单独开单，仅在本总账维护；11/23 的有界恢复不等于扩大 iOS 或其他待裁定范围。

| 任务 ID    | 关联模块                | 当前状态                                                                     | 下一步与验收条件                                                                                                                                                                                                          | 卡点/前提                            | 待裁定 |
| ---------- | ----------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------ |
| `AUTH-T1`  | AUTH-03                 | 独立 macOS 探针已实现，产品集成未完成                                        | 原生认证/长期凭据/并发续期接入共享产品，验证账号切换、取消/错误回调、音频安全清理；真机组合闭环                                                                                                                           | 真实 IdP、iOS 设备；产品暂停         | 是     |
| `AUTH-T2`  | AUTH-04/05              | API 已实现，前端入口未接                                                     | 前端导出/注销入口，生产数据验证                                                                                                                                                                                           | 产品 UI 决策                         | 是     |
| `VOICE-T1` | VOICE-01/07、SESS-01/02 | 基础语音已实现、待真实验收；Cloud 多端接管待接线                             | `CALL_LEASE_MODE=disabled` 时独立验收基础语音：真实 IdP→LiveKit/Agent 双向语音→结束→分析→报告全链路，5 分钟 5 轮，并覆盖失败类（拒绝权限/弱网/中断/重启/账号切换）；Cloud 多端接管部分在完成 SESS-T1 后再验（含双端冲突） | 真实密钥/设备/媒体                   | 是     |
| `SESS-T1`  | SESS-02                 | 原语+独立 controller 已实现，产品 Cloud 启动/恢复/UI 未接线                  | 产品共享启动/恢复/UI 接线；Cloud 多端真实接管/旧端媒体撤销/失效清理                                                                                                                                                       | 真实环境                             | 是     |
| `DOC-T1`   | DOC-03                  | 真机文件选择未验                                                             | DocTalk 真机文件导入，验证取消不丢草稿、读取失败/空文件/编码/超限提示                                                                                                                                                     | iOS 设备                             | 是     |
| `ANAL-T1`  | ANAL-03/05              | PR203 待合；最小修复在分支 Review；鉴权/目录局部通过，真实推理被账户欠费阻塞 | 按“受控读取→两 GET→按实测最小修复→真实 API smoke/人工 gold→新功能”推进；成功推理须先完成账户充值边界，人工 gold 仍为 0                                                                                                    | 账户欠费；10 USD 隔离预算；gold 标注 | 是     |
| `ANAL-T2`  | ANAL-06                 | 未实现                                                                       | 设计音频切片采集（存储/保留期/授权/删除）                                                                                                                                                                                 | 隐私口径                             | 是     |
| `BKT-T1`   | BKT-06                  | 真实生产未验                                                                 | 另定生产变更计划（迁移/维护窗口/备份恢复）                                                                                                                                                                                | 生产授权                             | 是     |
| `GOAL-T1`  | GOAL-01/03              | 技术已实现，真实教学未验                                                     | 人工 gold 与真实教学泛化                                                                                                                                                                                                  | 教学标注                             | 是     |
| `WEEK-T1`  | WEEK-03/04              | 未实现                                                                       | 明确有效时长/掌握度环比/发音/焦虑语速/下周重点口径并实现                                                                                                                                                                  | 指标口径与真实输入                   | 是     |
| `BYOK-T1`  | BYOK-01/02              | 新 Key 已隐藏更新但账号锁定；尚无确认 HTTP                                   | 真实 Provider 校验与凭据轮换/撤销，验证脱敏、失败短路、不静默回退                                                                                                                                                         | 原生解锁；旧 Key 两 401 不足         | 是     |
| `BYOK-T2`  | BYOK-04                 | i18n 框架未实施                                                              | 正式 i18n 框架、语言切换、多语言                                                                                                                                                                                          | 范围决策                             | 是     |
| `BYOK-T3`  | BYOK-03                 | 深色可读性/设备读屏未验                                                      | 全产品可访问性审计，覆盖暖/冷/暗深浅主题的对比度、键盘与读屏；真实 iOS/macOS 设备读屏、深色模式实测；以真实 IdP/LiveKit/媒体环境可用为前提                                                                                | 产品恢复后的设备与真实环境授权       | 是     |
| `PLAT-T1`  | PLAT-01                 | iOS 暂停                                                                     | 真机登录/音频/中断/签名/TestFlight                                                                                                                                                                                        | 设备、签名；已暂停                   | 是     |
| `PLAT-T2`  | PLAT-02                 | macOS 未接产品 UI                                                            | CP-03 方案定案后接产品 UI 与设备验证                                                                                                                                                                                      | 设备证据                             | 是     |
| `PLAT-T3`  | PLAT-04                 | required-check 未核                                                          | 核验分支保护与 mass-deletion guard 配置                                                                                                                                                                                   | 仓库管理权限                         | 是     |
| `PLAT-T4`  | PLAT-03                 | 真实整栈未验                                                                 | 真实 Compose 起栈/宿主入口/生产部署，验证发布回滚与回退                                                                                                                                                                   | 环境与部署授权                       | 是     |
| `PLAT-T5`  | PLAT-05                 | 未实现                                                                       | 数字人前端与音视频同步 + 独立设计                                                                                                                                                                                         | 范围决策                             | 是     |
| `PLAT-T6`  | PLAT-06/07              | 未实现                                                                       | Android/Windows/后台语音/接力等按需立项                                                                                                                                                                                   | 产品范围                             | 是     |
| `OPS-T1`   | 工程                    | 遗留                                                                         | WebKit weekly-grammar 偶发：先复现并确认根因，修复后 WebKit 无重试重复 ≥20 次全过，不放宽断言/不增重试                                                                                                                    | 复现与根因                           | 否     |
| `OPS-T2`   | 部署                    | 未验                                                                         | #102 Chroma CVE 旧部署适用性核验；部署日志 Key 排查与轮换                                                                                                                                                                 | 部署环境                             | 是     |
| `OPS-T3`   | 工程                    | 遗留                                                                         | 本地 worktree 清理                                                                                                                                                                                                        | 用户决定                             | 是     |
| `OPS-T4`   | 依赖/安全               | 未做                                                                         | SDK 升级（LiveKit/OpenAI/Vite/Vitest/TS）与 Turn Detector/language_hint 评估；#200/#201 补丁候选只作待核建议，不自动升级依赖                                                                                              | RF-12 前置；#30/#116/#127            | 是     |

## GitHub open issues 索引（17 条，2026-11-21 只读快照）

来源为主控实时只读搜索，完整标题/链接/正文见 `.review/reports/docs-single-source-20261121/OPEN-ISSUES.json`（仅原时点本地证据）。#30、#102 为工程/安全适用性，其余 15 条是 research 情报资料。

| Issue                         | 链接                                          | 性质       |
| ----------------------------- | --------------------------------------------- | ---------- |
| #30 实时语音栈现代化评估      | https://github.com/sunpcm/EchoTalk/issues/30  | 工程评估   |
| #102 ChromaDB CVE 适用性核验  | https://github.com/sunpcm/EchoTalk/issues/102 | 安全适用性 |
| #115 产品与场景竞品简报 11-02 | https://github.com/sunpcm/EchoTalk/issues/115 | research   |
| #116 实时语音情报 11-03       | https://github.com/sunpcm/EchoTalk/issues/116 | research   |
| #120 学习科学与反馈 11-04     | https://github.com/sunpcm/EchoTalk/issues/120 | research   |
| #123 工程与安全 11-05         | https://github.com/sunpcm/EchoTalk/issues/123 | research   |
| #126 周收敛 11-06             | https://github.com/sunpcm/EchoTalk/issues/126 | research   |
| #127 实时语音栈选型结论 11-06 | https://github.com/sunpcm/EchoTalk/issues/127 | research   |
| #130 产品与场景竞品简报 11-09 | https://github.com/sunpcm/EchoTalk/issues/130 | research   |
| #132 实时语音情报 11-10       | https://github.com/sunpcm/EchoTalk/issues/132 | research   |
| #135 学习科学与反馈 11-11     | https://github.com/sunpcm/EchoTalk/issues/135 | research   |
| #146 工程与安全 11-12         | https://github.com/sunpcm/EchoTalk/issues/146 | research   |
| #156 周收敛 11-13             | https://github.com/sunpcm/EchoTalk/issues/156 | research   |
| #189 产品与场景竞品简报 11-16 | https://github.com/sunpcm/EchoTalk/issues/189 | research   |
| #198 实时语音情报 11-17       | https://github.com/sunpcm/EchoTalk/issues/198 | research   |
| #200 工程与安全 11-19         | https://github.com/sunpcm/EchoTalk/issues/200 | research   |
| #201 周收敛 11-20             | https://github.com/sunpcm/EchoTalk/issues/201 | research   |

> research issue 正文里的历史版本（如 `livekit-agents 1.4.3`）与过往“未实现”不自动代表本树；本树当前固定 1.6.10。#200/#201 补丁候选只能作待核建议，不自动升级依赖；语音质量/延迟/费用 benchmark 未做，不引用厂商数字冒充本项目成绩。

## 产品待裁定事项

- 有效说话时长、掌握度环比、发音/焦虑/语速趋势、下周重点的指标口径与数据来源。
- 发音真实评估的会话音频切片采集（存储、保留期、授权、删除）。
- 真实生产变更计划（迁移、维护窗口、备份恢复、法定保留、真实数据授权）。
- 阶段 C 预发布环境（账号、密钥、费用）。
- 原生系统认证/Keychain、macOS 方案定案（CP-03）、真实 IdP 配置。
- required-check 分支保护与防 bot 推送的仓库配置。
- Android/Windows、数字人、后台持续语音等后置候选是否进入范围。
- open PR142 剩余差异：由用户决定关闭或保留。

## 维护规则

- 根 `README.md` 记录已验证现状、开发启动/配置命令与安全边界，不承载待办。
- `docs/README.md` 只做文档导航，不维护第二份进度。
- 功能/进度/待办/卡点/开单只在本页维护；历史归档见 `docs/`。
- 稳定 ID 用于跨文档追踪，新增小功能或待办沿用 `{域}-{NN}` 或 `{域}-T{NN}` 顺序，不重复、不删除历史 ID。
