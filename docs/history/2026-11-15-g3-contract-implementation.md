# G3 Agent / 分析同源契约实施：验收草稿

截至2026-11-15：设计已获用户确认并授权实施；R1测试finding已关闭，**整包尚未APPROVED、完整backend pytest尚未运行**。本稿不表示完成，不勾选或归档TODO，不预填实现PR/CI或终点SHA。设计与兼容约束见[契约设计](../AGENT_AND_ANALYSIS_CONTRACT_DESIGN.md) §5–7。

## 基线、来源与实施范围

- 设计清单的事实冻结于 `fcc9d6ed519196383d3b929da3a2a4f8d11e5dad`，原永久链接与兼容要求保留。
- 设计[PR171](https://github.com/sunpcm/EchoTalk/pull/171)已合并至main `0e706801316ea0c529a5eb1098f5cf808a1a9d67`，tree `9f904e0c9ec8724b73cf7e096df789c83bad8233`。实施开工HEAD `6339fadc0f7ca37bcd47a410fc1bad7953b262f2` 与之严格等树；Harness在实施方R0停写后校准HEAD，源码/index保全。这个HEAD是基线，不是实现终点。
- 唯一实施lane为 `.review/worktrees/g3-agent-analysis-contract-implementation-20261115`，branch `codex/g3-agent-analysis-contract-implementation-20261115`。当前为隔离WIP，未发布实现PR、未运行实现CI。
- 本文Harness数字、变异及工具首失败由可共享的 `.review/reports/g3-agent-analysis-contract-implementation-20261115/stage-evidence-r1.json` 转交。实施方未读取reviewer目录或私有probe，未把转交数字称为亲跑。
- 实施方命令与字节核验来自同包 `implementer/report-r0.md`、`report-r1.md`、`ev/` 及 `final-scope-r1.json`，均仅本地留证、不纳入Git。设计Linux CI来自Harness日志回读，不是新macOS运行。

## R0：实现与首次检查

实现Python纯契约单一人工来源、离线components容器与TS生成物；生产调用方引用适用目录/普通str别名或安全构造。TS生成器仅为新入口opt-in适配来源头和再生成命令，保留旧默认及旧自定义调用字节、原生成算法；现有CI作业增加漂移检查，不改矩阵、权限或重试。

分别保留九码安全发送、开放未知非空码接收、五码诊断、五项分析已知目录（四个当前生产码、一个policy-only）与三项人工不可重试。producer仍为type/code/message、原静态中文、topic/reliable、两级fallback及publish后disconnect；receiver仍为own字段、ECMAScript trim只判空并返回原值、额外字段丢弃及原TextDecoder语义；分析公开code仍为string/null，自动重试和人工策略不合并。身份/Room所有权、日志脱敏及原重试状态机不变。

R0共30路径（22份tracked修改、8份新增）；原676份非dotenv tracked中654份保全。未改真实OpenAPI/API TS、Fake、全部E2E、依赖/锁/迁移/数据库结构及受保护旧测试。规范化同源引用与普通str别名、忽略docstring后74个原生产函数AST等价；mapper委托与payload构造两项预期变化另审，不把AST等价当运行时通过。

实施方亲跑经ev固定非服务入口：Vitest1231/52（最终12.24s）、API生成器10/10、typecheck、lint、Ruff格式/lint、Prettier、真实API TS及相关导出--check。两隔离输出一致；非法JSON/缺失/过期--check拒绝且不改旧文件；旧生成器对照在实施方自有临时副本。未运行pytest、Fake/HTTP、浏览器或服务。

首次记录保留：

- 实施方R0 lint首轮1error/132warnings：lib测试反向导入components，命中分层规则。把receiver对照移回组件测试后0errors/132warnings；未禁规则、未加豁免。原证据为 `implementer/ev/ev-08-lint-r0.txt`，恢复检查在15。
- 实施方清洁旧生成器对照出现Darwin/xcodebuild缓存路径探测提示，仍exit0、字节对照通过；不是设备或产品失败。原证据在18。
- Harness评审辅助AST脚本首轮拼写错误exit1，修正后74等价/2预期变化；属辅助工具失败，不伪装为产品RED。
- Harness变异runner首次在实际duplicate RED/GREEN之后因记账断言失败；旧日志保留，修正v2后才形成8项有效目标命中。不能把记账失败混充变异有效性。

## R1：仅测试返修与独立关闭

R0评审为CHANGES REQUESTED：删除重复enum校验后旧纯契约30/30仍绿；移除code own guard后旧parser26项仍绿；诊断canary只声明却未实际传入调用。这些是测试缺口，不据此声称发现生产行为回归。

仅修改三份测试：exporter追加12例重复目录/投影、文案映射缺失/多余及未知/不一致投影负例，先直接断言validator拒绝，再要求真实CLI --check非零、错误来源正确且临时输入字节保全；parser为type/code/message各补真实JSON继承反例，finally恢复原型、恢复后断言并保留own对照；诊断九码+未知矩阵实际传message canary，检查精确输出键、无message及序列化无泄漏。

实施方R1亲跑Vitest1234/52（14.49s；parser29/29，诊断契约2/2）、typecheck、lint0errors/132warnings、前后端格式和后端lint，全exit0；未运行后端用例或变异。经ev27核验，三测试外681份现存文件字节保全，原Python/receiver用例保留；生产/生成物/配置全部保持R0字节。

Harness随后独立确认两条P1与P2关闭：Vitest1234/52；只执行两份新增非DB纯契约模块42/42（8.17s），**不等于完整pytest**。私有变异后的正式/私有684文件最终逐字节还原，正式lane未变异。

## Harness分阶段结果与已发布设计CI

已发布[mainCI43621702202](https://github.com/sunpcm/EchoTalk/actions/runs/43621702202)对应设计基线0e70680，结论success；不是实现CI。

| 项目               | 已发布设计CI（Harness回读Linux日志）    | 未发布G3候选（Harness/macOS亲跑）                       |
| ------------------ | --------------------------------------- | ------------------------------------------------------- |
| Vitest             | 1227/51                                 | 1234/52                                                 |
| Fake API           | 125                                     | 125                                                     |
| API生成器          | 8                                       | 10                                                      |
| 构建脚本           | 21                                      | 21                                                      |
| 完整E2E            | 234，C117/W117，retry/skip/flaky0，4.1m | 234，C117/W117，retry/skip/flaky0，52.0237s；命令53.30s |
| 完整backend pytest | 841/3warnings/80.59%，60.65s            | 未运行，等待指定PG恢复或启动授权                        |
| 新增纯后端契约子集 | 不适用                                  | 42/42，8.17s，仅两份非DB模块                            |

候选完整E2E属于R0亲跑，R1生产及全部E2E原字节；不冒称在R1新跑全树。Harness共享回执另确认新JSON/TS --check各exit0，lint132warnings/0errors。分阶段已过门禁不计作15项全完成，不用已发布841或纯契约42代填候选完整pytest/覆盖率。

## 八项有效私有变异

均由Harness在自有副本执行：目标断言RED（exit1）、恢复GREEN（exit0），`restored_bytes=true`；正式lane不变异。语法错误、工具记账错误、全局超时或无关失败不算有效命中。

| 变异                                  | 实际变更文件:行（私有副本）                                         | 确切目标断言或门禁                                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| duplicate：删除exporter去重校验       | `backend/export_agent_analysis_contract.py:138`                     | `test_invalid_catalog_projections_fail_validator_and_preserve_cli_input`：直接 `pytest.raises(exporter.AgentAnalysisContractExportError)` 未抛异常而RED，不以CLI stale比较代替validator断言。                                                   |
| owncode：删除receiver的code own guard | `apps/vite-app/src/components/conversation/agentErrorMessage.ts:22` | `parseAgentErrorMessage > rejects an inherited code field while accepting own fields`：`expect(inheritedResult).toBeNull()` RED。                                                                                                               |
| rawmessage：mapper返回raw message     | `backend/livekit_agent/error_mapper.py:57`                          | `test_actual_mapper_and_safe_builder_exact_payload`：首个静态文案元组断言 `assert (safe_code, message) == (code, EXPECTED_MESSAGES[code])` RED；builder第二道安全构造仍保留，不能称实际发送payload泄漏。                                        |
| closedreceiver：接收端code改九码闭集  | `apps/vite-app/src/components/conversation/agentErrorMessage.ts:18` | `retains a non-empty unknown string code for existing UI compatibility`：未知码接受断言 `toEqual({ code: "UNKNOWN_PROVIDER_CODE", message: "未知错误" })` RED。                                                                                 |
| diagnosticnine：诊断扩为九码          | `apps/vite-app/src/lib/agentAnalysisContract.ts:11`                 | `restricts diagnostic logs for all nine emitted codes and unknown codes`：`expect(result?.agent_code).toBe(diagnostic.includes(code) ? code : "unknown")` RED，五码外的四个已知码必须为unknown。                                                |
| closedhttp：分析HTTP别名改enum        | `backend/schemas/session.py:8`                                      | `test_open_analysis_alias_schema_and_real_http_optional_default`：实际 `AnalysisStatusResponse.model_json_schema()` 的 `error_code` 去掉 `title/default` 后与tracked schema的开放string/null对照断言RED（测试L118–126）；不是DB或ASGI请求断言。 |
| staletypes：生成TS加入过期字节        | `apps/vite-app/src/lib/agentAnalysis.generated.ts:6`                | `generateApiTypes --check`：`Generated API types are stale`，只读生成漂移门禁RED。                                                                                                                                                              |
| unsupported：schema加入不支持关键词   | `backend/agent_analysis_contract.py:132`                            | `export_agent_analysis_contract.py --check`：`stage=serialization error_type=AgentAnalysisContractExportError`，对应生成门禁RED。                                                                                                               |

这8项已实际独立核验；设计§7其他建议（例如其他own guard、重试/落库变化）未因此自动获得“变异通过”结论，不扩大已执行清单。

## 未验边界与本次文档草稿

指定专用PG容器据共享阶段回执仍为exited，完整backend pytest未运行；须等用户恢复或明确授权启动，再由Harness核验库身份受控执行。不得换库、迁移、取应用库凭据或自行启动服务。当前没有候选完整后端计数或覆盖率，整包不能APPROVED。

真实Provider/LiveKit/IdP、设备、Docker整栈与部署未验证；topic和JSON形状不证明发送者身份，typed分析异常的开放code/截断message不因此完成持久化脱敏。未擅自调整这些产品口径，也未开始H1/I1/B2。

本次仅获准文档草稿：TODO的G3保持unchecked、设计标用户已确认/实现验收中、状态页分列来源，并新建本文。旧history和todo-done原字节保全，不归档G3。实施方只做四MD格式及字节/链接/行数自检，命令与结果在同包 `implementer/report-docs-draft-r0.md`；不重跑三树或服务。

本次实施方续作Nowledge thread检索一次，连接本地14242遇EPERM，未重试/提权，不据此判断产品或历史。文档开工的一次附带读取误用lane内相对`.review`路径导致文件未找到；真正的684文件基线核验此前已成功，未把这次读路径错误记作验收通过。所有首结果保留。

停止点：源码/测试/配置/生成物冻结，四MD草稿停写在Review；无实现PR/CI/终点SHA，不commit/push。完整pytest实测和最终归档留待后续明确证据与最终Review，当前不称完成。

## 2026-11-15 最终本机测试补齐回执（晚于草稿R0/R1）

时点：本节收到共享 `final-pytest-receipt.json` 后追加，晚于上文docs-draft-r0/r1的停写回执。上文“指定PG仍exited”“完整pytest未运行”“不勾选/不归档”等是当时草稿状态，原始正文及8项变异定位表全部保留，不再代表本节补齐后的现状。

用户已恢复专用库。主控本轮转交Harness亲自核验的环境为：镜像 `postgres:15.19-alpine`、label `echotalk-a1-20261111`、loopback5432；库身份 `echotalk_test|echotalk|150019|c06_transcript_events`。实施方没有启动或访问数据库，也未取凭据、换库或执行迁移。

Harness随后亲跑完整backend pytest（lane Python3.12.12），共享回执记录受控入口为 `backend/.venv/bin/python tools/check.py _pytest`，实际运行 `pytest.main` 完整树及 `--cov=. --cov-report=term-missing`：

| 项目        | 最终本机实测（Harness亲跑，非实施方执行） |
| ----------- | ----------------------------------------- |
| 收集/通过   | collected895，895passed                   |
| 警告        | 3warnings                                 |
| 覆盖率/门禁 | 79.71%，门禁59%通过                       |
| 时间        | pytest47.14s；命令53.90s                  |
| 退出/稳定性 | exit0；测试前后source字节稳定             |

本机完整895与原设计Linux CI的841/3warnings/80.59%分列，旧数字不改写；覆盖率下降0.88个百分点，原因未知，不能编造为新增代码、测试或平台造成。先前42/42仅是纯契约子集，现在已另有完整树实测，不将两者相加或互相替代。

此前Harness14门禁、R1 Vitest1234/52、Fake125、类型10/构建21、新JSON/TS漂移检查及8项有效私有变异证据保留；本次只补跑完整pytest。R0 E2E仍为234（C117/W117、实际retry/skip/flaky0、52.0237s/命令53.30s），生产及全部E2E在R1字节不变，不冒称本次重跑浏览器或全部门禁。

唯一新增实测依据为 `.review/reports/g3-agent-analysis-contract-implementation-20261115/final-pytest-receipt.json`，SHA256 `9b6361feb8d16c27fe0794a9e6f7d32834e09209d44ba03d828291a924f850fb`。本节只读取共享回执，不读取其中指向的reviewer日志或私有probe。远端main据主控转交仍为0e706801316ea0c529a5eb1098f5cf808a1a9d67，非实施终点；实现PR及最终mainCI尚未发布，不预填编号、SHA或APPROVED结论。

按本轮用户授权，将G3实施卡勾选移入todo-done，完成的是实施及本机验证材料收口，最终独立Review与发布验证仍待后续。其他TODO卡、H1/I1/B2用户决策边界、真实Provider/LiveKit/IdP/设备/整栈/部署未验边界保持不变。

本次实施方只修改五份获准MD并执行文档格式/范围检查；源码、测试、配置、生成物继续冻结，没有启动服务、浏览器或pytest。报告为同包 `implementer/report-docs-final-r0.md`，源码与文档停写在Review，不commit/push。此前停机、首失败和草稿回执均原样保留。
