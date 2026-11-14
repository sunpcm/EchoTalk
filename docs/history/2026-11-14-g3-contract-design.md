# 2026-11-14 G3 Agent 与分析错误码契约设计

## 设计产物与范围

[设计正文](../AGENT_AND_ANALYSIS_CONTRACT_DESIGN.md)已独立评审 APPROVED R0，仍待用户确认、未实施。
设计轮 lane 为 `.review/worktrees/g3-agent-analysis-contract-design-20261114`，分支
`codex/g3-agent-analysis-contract-design-20261114`，开工 HEAD 为
`fcc9d6ed519196383d3b929da3a2a4f8d11e5dad`，tree 为 `c3e9fee042583fd9a956c1bea3b534f52f91c30c`，初始干净。

设计清点当前一种应用自有 DataChannel 消息及发送、解析、ownership、状态、诊断与 UI；列九个安全发送码、
五项诊断投影、开放非空接收规则，以及四个分析生产固定码与五项已知策略目录。SDK 标准事件、日志兜底、
动态异常、HTTP detail 和测试伪造值分列，不将它们混为闭集 enum。

推荐 Python 单一人工来源，离线导出 components schema/目录并复用已有 OpenAPI→TS 工具；明确真实分析
OpenAPI 的 string/null、兼容、滚动升级、生成漂移、未来契约测试和有效变异。当前没有创建机器 schema、
生成器或实现；未改变 wire、自动/人工重试、身份隔离或脱敏。完整搜索覆盖379份源文件、61行命中，逐条源码
使用冻结提交永久链接；实施方静态核对94个链接及九码安全文案。

## P2：现有生成工具的可行性与生成头边界

以下 toy 结果由 Harness 转交，非实施方亲跑：Harness 在自有私有合成空 paths/components 容器中，用现有
CLI 生成与 --check 均 exit0；生成头仍写 `backend/openapi.json` 和 `pnpm generate:api-types`。
这仅证明现有工具接受该容器，不是 G3 schema 实现或实际契约测试，亦不证明未来回归已完成。

实施方只读核实冻结源码中 GENERATED_BANNER 位于 generate-api-types.mjs 的 L20–25，并在 L125 固定拼接。
设计 §5/§7 已补：未来只让新入口生成头的来源/再生成指令指向新 schema，使用稳定仓内相对路径；原默认输出
字节与生成算法不变，纳入默认字节、自定义入口和 --check 的生成器回归。本轮脚本和原生成物字节不动。

## Harness 本机门禁、首次失败与限定重放

以下数字全部来自本轮 Harness 交接，非实施方执行或回读私有日志；未读取 reviewer 目录。
15类门禁中14个非浏览器门禁全exit0；完整E2E首轮失败，限定一次完整重放后通过，首失败不覆盖。

| 范围                           | Harness 实际结果                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Vitest                         | 1227 tests / 51 files                                                                                                    |
| Fake API / 类型脚本 / 构建脚本 | 125 / 8 / 21，全部成功                                                                                                   |
| backend pytest                 | 841 passed / 3 warnings / 80.59071729957806%，自身70.61s、命令75.55s                                                     |
| 其他非浏览器门禁               | lint/typecheck/build、API/Provider 导出与类型检查、backend格式/lint及format均exit0；lint132warnings/0errors，format8.74s |
| 首次完整E2E                    | 233pass/1fail；C117/0、W116/1；retry/skip/flaky均0；Playwright71.554199s、命令72.96s                                     |
| 限定一次完整重放               | 234pass/0fail；C117/W117；retry/skip/flaky均0；Playwright63.150139s、命令64.14s                                          |

首失败唯一目标为 WebKit `theme-storage.spec.ts:4`，原断言24：冷启动 storage getter 抛 SecurityError 场景，
期望 warm，实际 cool。该运行的产品源码/测试全部字节未变；**根因未确定、主题未修复**，不能追认与旧主题失败
同因，也不能因一次重放全绿宣称稳定性已证明。没有为此改测试、主题产品口径或增加重放。

Harness 证据索引为 `.review/reports/g3-agent-analysis-contract-design-20261114/G3/reviewer/checks-r0.json`，
以及同目录 `checks-r0replay.json`、`full-e2e-r0.json`、`full-e2e-r0replay.json`；原始 argv、环境和退出码以相应回执为准。
本记录使用主控转交的结果，未自行读取或列目录，不把命令定义冒认为实施方执行。

## 命令与证据来源

Harness 命令的共享入口是本轮 `tools/check.py`。实施方只读核对其命令定义：Vite app 中 `pnpm test`、
`pnpm test:fake-api`、`pnpm test:api-types`、`pnpm check:api-types`、`pnpm test:build`；根目录 Turbo
lint/typecheck/build `--force` 与 `pnpm format:check`；backend 专用 venv 的 Ruff、OpenAPI/Provider export
检查。它们的实际运行回执归上节 Harness 索引，未从定义推断额外执行。pytest/浏览器完整包装 argv 未在交接消息
展开，本文不补造；浏览器和三树均由 Harness 亲跑。

实施方设计阶段实际命令为标准库静态检查，经 ev.sh 在本 lane 包装：

```sh
python3 /Users/sunpcm/code/EchoTalk/.review/reports/g3-agent-analysis-contract-design-20261114/implementer/check_design_r0.py
```

原 `ev-01-design-static-r0.txt` exit1：parser 测试链接写到 L74，实际文件70行；仅修正文档为 L29–L70。
原 `ev-02-design-static-r0.txt` 与 `ev-03-design-inventory-fence-r0.txt` 均exit0，后者现场重扫379份源码，
清单一致、原674份非dotenv tracked文件不变。这是文档行号首失败，不是产品或环境测试失败；原报告/证据保留。

文档收口仅实施方亲跑 Node22/Prettier 四MD格式及标准库范围/旧前缀检查，实际命令为：

```sh
python3 /Users/sunpcm/code/EchoTalk/.review/reports/g3-agent-analysis-contract-design-20261114/implementer/format_docs_r0.py --write
python3 /Users/sunpcm/code/EchoTalk/.review/reports/g3-agent-analysis-contract-design-20261114/implementer/format_docs_r0.py --check
python3 /Users/sunpcm/code/EchoTalk/.review/reports/g3-agent-analysis-contract-design-20261114/implementer/check_docs_r0.py
```

以上均经指定 ev.sh、新ID留证，cwd为同一lane；实际退出码与最终hash见本轮 implementer/report-docs-r0.md。
Prettier 使用本lane依赖与已有 `/Users/sunpcm/.nvm/versions/node/v22.13.1/bin/node`，不安装依赖。
标准库检查不import产品、不访问环境/网络；范围含原卡归档、其他TODO内容、旧归档前缀与其余源码字节。

## 收口、未验证与停止点

同轮收口仅四MD：设计正文、根TODO、todo-done追加后缀、新建本文。原G3设计卡原文仅勾选后归档，
根TODO保留用户确认/实施待办并引用设计§6/§7，明确确认后另拆实施范围和验收。计数无变化，PROJECT_STATUS、
旧月史与其他文档不改；未新增正式用例。文档之外的产品、测试、脚本、依赖、锁、配置原字节保全。

未来 G3 生成器、正式 schema、契约测试、生成器回归和变异均未实施/未运行；实施方没有运行任何生成命令，
Harness toy与已有门禁成功不替代未来工作。真实 LiveKit/Provider/IdP、设备、端到端送达与滚动部署未验证。
实施方续作文档收口时的定向历史检索返回HTTP502，未重试；Harness本轮定向thread_search成功但0命中。
结论依据冻结源码及明确转交证据，不以失败检索补造历史。

本轮小里程碑只交设计PR并收尾CI，暂不merge；此处不预告PR编号、新HEAD或CI成功。实施方完成文档后停Review、
不commit/push；不因APPROVED自行实施，不做H1/I1或下一包。设计仍待用户确认。
