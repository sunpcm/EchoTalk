# 遗留维护批次最终收口（DOC）— 文档交付与对账记录

> 日期：2026-11-16；任务包：DOC（最终遗留对账与版本化复核材料，纯文档）。分支 `codex/legacy-final-docs-20261116`；
> 开工 HEAD `4c364ceacbe25ce9fc2f6ddfe91a5312e825c0b4`（EV PR187 source，父已审）。本文件记录 9 份 Markdown 收口
> 的范围、验收、首失败、未验边界、计划外/工具失误与新旧依据；不冒充发布 PR/main CI，不预填 DOC 终点 SHA。

## 范围

仅 9 份 Markdown，源码/测试/两配置/依赖锁/DB/迁移零改：

1. `TODO.md`：逐项对账；RF-04「远端证据核对」已满足的 CI 执行部分移出归档（CP-06 §6 已有证据），required check
   权限仍单列于 RF-04 主卡未核；RF-07 区分软件 17 门禁已全过（前端 Vitest/Fake/types/build/E2E + backend pytest）
   与真实整栈未验（Docker compose 实际拉起与迁移、镜像体积/冷启动测量、真实 Provider/LiveKit/设备、部署）。
   B2/设备/产品待裁/GC/weekly 历史未知及 R2-14 真实运行保持未勾；A18/A19 为后续专项维护候选（非已证缺陷），本轮不启动。
2. `README.md`：旧 `e35d89b`/11-01 基线改为指向状态页当前核验；目录树补 `src/`（App/Dashboard）、
   `src/data/`（只读查询 hooks）、`lib/api.generated.ts`（真实 OpenAPI 生成的 HTTP API 类型）、
   `lib/agentAnalysis.generated.ts`（G3 同源生成契约，Python 单源）、`backend/data/teaching_materials.json`。
3. `docs/ARCHITECTURE.md` §7：迁移/Compose 风险改「静态已实现、整栈未验证」，明确 `/api/health` 仅 liveness、
   迁移成功由独立 `echotalk-migrate` 以 `service_completed_successfully` 作 DAG 门禁（非 CPB 新公开端点），
   保留 liveness 非持续 DB readiness、初次启动依赖非独立重启保证；原生认证/真实环境边界未重写。
4. `docs/PROJECT_STATUS.md`：四类 ≤100 行；最终代码冻结点 EV main + PR/main CI 回执；macOS 亲跑与 Linux 回读分列。
5. `docs/verification/cross-platform/CP-06-CI-QUALITY-GATES.md`：追加 §7 当前主线门禁/证据留存与 required-check 未核边界。
6. `docs/history/todo-done.md`：旧前缀逐字节保全，追加 DOC 归档段。
7. `docs/history/2026-11-15-legacy-product-polish.md`：追加 ACT wire 精度澄清，旧正文保全。
8. 本文件。
9. `docs/reviews/2026-11-16-legacy-maintenance-review-input.md`：云端独立复核材料。

## 验收（父 Harness 亲跑 + Linux 回读，实施 Agent 未跑三树）

实施 Agent 仅做 Prettier/Markdown 自检与静态检查；三树/门禁/变异由父 Harness 在各包**原 lane** 分阶段亲跑，
本 DOC 三树本次另记（Vitest 1260/55、pytest 962/3warnings/80.63%/74.48s、E2E 258 C129/W129 retry/skip/flaky0），
Linux CI 为回读，
命令见 [Agent 评审手册 §2](../agent-review-loop.md)。最终代码冻结点为 EV main `bf4becd`（PR187，tree `c2e7ddfa`，
与 source `4c364cea` / CI merge `546090c6` 完全一致）。PR177–187 已按门禁逐包合并：PR CI 43737757005 首六 success、
Guard 43737757038 success，最终 mainCI 43738720996 首五 success。PR 与 main 两份实际归档均已 MCP 实际下载核
SHA/CRC/原生 JSON/PNG（非只看日志元数据，不贴临时下载 URL）：PR artifact 14171327756（SHA256 `60ae87e6…`，
14725526 字节，143 文件/142 PNG/trace0）、main artifact 14171881434（SHA256 `45573d73a…`，14705831 字节，
143 文件/142 PNG/trace0 main 全绿）；两者原生 `playwright-report/results.json` 均 expected 258 / C129 / W129 /
retry0 / skip0 / flaky0，142 PNG（含 ACT 320px 200% 双浏览器截图）。PR CI 日志 E2E 5.7m、pytest
962/3warnings/80.63%/61.36s；main CI 日志 E2E 5.4m、pytest 962/3warnings/80.63%/60.64s。上一已发布 main
为 CPB `53d2a409`（tree `cec480de`，mainCI 43737179366 首五 success：Vitest 1260/55、Fake 125、types 10、build 21、
E2E 258 C129/W129 retry/skip/flaky0 4.7m、pytest 962/3warnings/80.63%/50.50s）。

## 首失败（如实保留，不据后续绿追认）

- READ PR179 / ST PR180 首轮 CI 257pass/1flaky/retry1（旧 `a11y-focus-touch.spec.ts` seen>=6 得 5）；A11Y PR181
  修正后其 PR/main 首轮 258/0，只修确定前提缺口、非证得根因。
- READ2 PR182 首轮 CI 257pass/1flaky/retry1（session-flow:109 helper4 `page.evaluate` Promise GC）；SF 只读调查无已证根因。
- theme-storage 两次 233/1 warm/cool、weekly-grammar 5/1、启动视图测试前提（ST）历史根因未知，保持开放。

## 未验边界（按执行者/环境分列）

真实 Provider/LiveKit/IdP、真实设备/TCC/OS 下拉、Docker 整栈、实际迁移、签名与部署均未运行；未读写 `.env`、
未新增依赖。执行环境分列：实施 Agent 本轮只写 MD，不连 DB/不迁移；父 Harness 在本机指定专用 PG 已亲跑 backend pytest，
CI 以空合成库 alembic upgrade 单列，不称所有环境零迁移。CI 绿不证明历史根因已修；SF/weekly 未知继续保留。

## 有效变异分类

生产代码变异（目标 RED → 恢复 GREEN）：TS store/settings.ts、READ SettingsProviderFields.tsx（opacity/boundary/focus 三项生产 UI；settings-readability.spec.ts:76 font 为测试前提非生产）、
READ2 SettingsAppearance.tsx:36（swatchWithin/dotWithin/textWithin，6 RED/24 GREEN）、ACT（useActiveSessionsLifecycle/
SessionRow/useSessionEndFlow）、CPB docker-compose.yml（:55/:73/:139）。受控时序反例（非生产代码变异，单列）：
ST/A11Y/ST2 的延迟/连接前提对照。无变异明列：LGR、DASH、DOC（纯文档/跨文件搬运 byte-AST 同源）。精确位置与断言见
`docs/reviews/2026-11-16-legacy-maintenance-review-input.md` §5。

## 计划外 / 工具失误

无计划外源码改动。旧 `cloud-evidence-draft.md`/`remaining-ledger-draft.md` 中「CPB/EV 待发布」与「A18/A19 可直接小修」
为过程草稿口径，本文件以父核 `shared/doc-evidence-input-r0.json` 与 `shared/cpb-final-evidence.json` 为准：
CPB 已 COMPLETE，A18/A19 为专项维护候选。

## 文档新旧依据

- 新事实：`shared/doc-evidence-input-r0.json`（9 包 freeze + 主链父提交 + A11Y 真实 baseline）、
  `shared/cpb-final-evidence.json`（CPB mainCI 首五 success + keylines）、`shared/act-wire-scope-clarification.json`、
  `shared/read-r2-final-evidence.json`。
- 旧依据：各包 `freeze.json`/`DELIVERY.md`/`pr-body.md`、`R/prior-architecture-freezes.json`；历史句不回改。

## 未完成分类与需要用户裁定的集中清单（待未来处理，不伪造已提问/获批）

- **需用户产品/权限裁定**：阶段 C 预发布环境；RF-04 required check 配置（GitHub 只读 403/INVALID_ARGUMENT，不证明不存在）；
  防 bot 推送误合并 label；本地 worktree 清理；周报「练习时长」口径；场景 `goals[]`+Task Completion；发音真实评估。
- **需真实设备/环境**：R2-09/11/12、SGEC C-2、部署侧日志、CP-01~CP-07、真实 IdP/LiveKit、5 分钟 5 轮语音。
- **明确不做/延后**：B2（历史无法补录仅时效性标记）；R2-13 其余目录延后（Roadmap §7）；1.8.x/RF-12 前置；Android/Windows；后台语音。
- **未知继续保留**：SF（session-flow GC 无已证根因）；weekly-grammar 历史 5/1 根因未知。

停 Review；本文件为文档收口，不 commit / stage / push / merge。
