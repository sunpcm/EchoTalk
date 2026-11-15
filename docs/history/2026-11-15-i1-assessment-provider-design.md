# 2026-11-15 I1评估提供方设计 R0

本轮仅交[评估提供方设计](../ASSESSMENT_PROVIDER_DESIGN.md)，候选R0待独立Review与用户确认，**未实施**。接口、coverage、文件拆分与未来验收是推荐方案，不以方案取舍作为等待用户提前裁定的阻断；未发现必须暂停的权威冲突。设计完成卡归档不等于I1实现完成、B2政策确认或真实发音已接入。

## 1. 身份、范围与事实

唯一lane `.review/worktrees/i1-assessment-provider-design-20261115`，branch `codex/i1-assessment-provider-design-20261115`，开工干净；HEAD `0f7a5e57f809f8566efc39ca582bdc95fc260dfc`、tree `eeb37709c6e8802092eb8a25ba8fb5b799965d39`。五MD白名单为新设计、TODO、状态页、完成归档及本记录。全部源码/测试/配置/锁/生成物零改，旧history与todo-done旧前缀保全；H1旧lane/报告不写。

阅读权威文档及真实analysis_service/models/exercise/analysis_jobs/worker/响应模型和现有单元/PG/monkeypatch测试，源码事实使用冻结提交的永久blob链接。设计逐项核对文本参考音素/TH替换/NW评分、语法规则与纠正、NULL metadata、独立幂等及flush、事务/重试/BKT，不把ELSA开关名称当作已有网络客户端证据。

## 2. 设计产物与边界

推荐一个新assessment_providers模块、两个窄Protocol和标准库值对象，demo_mock与demo_rule仅做当前文本计算；选择/ORM/独立幂等/flush留analysis_service，Job/worker/BKT原所有权不变。较小替代为两个计算函数加值对象，取舍和未来精确文件/测试范围在设计§1/§6，均待用户确认，没有实施代码。

发音demo metadata保持`demo_mock/None/demo-phoneme-rules-v1/True/0.0`，语法保持`demo_rule/None/demo-grammar-rules-v1/True/0.5`；旧NULL、False、0.0与原id不被当前选择器补写或覆盖。输入仅TranscriptAssessmentInput.text，不能据Protocol承诺直接接真实音频Provider；真实音频来源、权限、切片/保留/删除与设备验证需另行授权。

coverage按方向记录实际not_called/evaluated/failed、count和reused：evaluated0不等于未调用，旧行复用不伪装新调用；语法零行没有持久完成标记，重复调用仍实际计算。无用户转录保留None/原Job失败，关闭发音仍可语法零结果成功；混合来源按实际行保留，BKT不改用coverage。typed coverage短期仅调用内存，重启不可查，不构成B2审计或历史补录。

异常/取消保持原类型、code、retryable及Job回滚/失败/stale语义。现有事务事件缓冲失败时会丢弃，因此拟议独立同步coverage观察点仅记录计算诊断，不叫Job成功/已提交事件，不输出原文、凭据、任意异常正文或Provider自由字符串。真实调用失败不转空成功、不静默synthetic fallback；计算完成与事务提交分开。观察点及接口均未实现。

未来直接契约、真实service/Job/PG接线和有效变异计划覆盖metadata/NULL、TH与position、zero→not_called、failed→success、取消/部分回滚、独立幂等、旧结果复用、synthetic进BKT及诊断canary。当前候选不存在这些新测试/变异，不能以本轮冻结代码基线通过追认方案已验。

## 3. 三类验证来源分列

| 阶段/执行者                      | 真实结果                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1已发布Linux main，Harness回读  | [PR174](https://github.com/sunpcm/EchoTalk/pull/174) source `7f499f2a2e2292c59e3f2d33386cfb11781510cf`、CI merge `4166bde73332cbbf4f27206f887a8c2eec594bee`与main0f7a严格等tree；[PR CI43677251600](https://github.com/sunpcm/EchoTalk/actions/runs/43677251600)/[Guard43677251555](https://github.com/sunpcm/EchoTalk/actions/runs/43677251555)首轮六success；[mainCI43677877043](https://github.com/sunpcm/EchoTalk/actions/runs/43677877043) attempt1五success。 |
| Linux main实际计数               | Vitest1249/53、Fake125、types10/build21；E2E234、C117/W117、实际retry/skip/flaky0、4.0m；pytest895/3warnings/**79.68%**/52.49s。                                                                                                                                                                                                                                                                                                                                    |
| H1 PR及历史本机                  | PR pytest895/3warnings/79.71%/65.19s，PR E2E234/0retry；历史H1本机79.71%，完整E2E首次233/1、唯一重放233/1，均theme-storage:24 warm/cool。旧记录原样保留，不把两次拼成234或追认同因。                                                                                                                                                                                                                                                                                |
| I1本轮Harness亲跑macOS，冻结代码 | 14源码门禁全部success，前后字节一致；Vitest1249/53、Fake125、types10/build21；完整pytest895/3warnings/79.71%，pytest75.46s、命令80.30s。                                                                                                                                                                                                                                                                                                                            |
| I1本轮完整E2E                    | 234passed/0failed，C117/W117；实际retry/skip/flaky均0，configured retries0，JSON duration80394.227ms=80.394227s，failures[]；制品SHA256 `17be3e2668845170c2c898978d8782029fa93c188e328e840cc3fe4c520252fb`。                                                                                                                                                                                                                                                        |
| I1实施方                         | 只读源码、文档写作与必要Markdown/格式/范围核验；没有运行三树、浏览器、DB或服务。最后五MD由Harness停写后独立验，不预报最终Review或新PR/CI成功。                                                                                                                                                                                                                                                                                                                      |

Linux main79.68%与PR/本机79.71%差0.03个百分点，原因未归因，59%门禁不变；不能把PR或本机数值复制到main。I1本轮234通过与H1旧233/1属不同阶段，不证明主题已修复或稳定性已确立。

来源为本轮报告根共享`h1-final-main-receipt.json`和`harness-validation-r0.json`，由Harness提供；不是实施方亲跑或reviewer私有材料。初次读到H1 main仍in_progress时未预报成功；收到完成增量后按更新回执补齐。本轮I1冻结代码验证没有新增正式用例数，未来I1实现仍未运行。

## 4. 首次检查、文档保护与停止点

本节点ev01曾以通用词发起本地Nowledge CLI连接，127.0.0.1:14242返回EPERM/exit1，搜索未完成、无检索结果用于设计；与父任务被自动审批拒绝而未运行的查询区分。此后不重试、不换词/入口/Agent，不外发项目材料。本地registry提示也不作为当前源码依据。

静态定位曾误用不存在的schemas/exercise.py与backend/analysis_worker.py，依rg文件清单修正到schemas/assessment.py及workers/analysis_worker.py，未执行模块；第一次多文件MD补丁因状态表空格不匹配而未写入，改用明确章节范围替换。它们不是产品/测试失败，不隐藏为测试通过。必要文档校验的实际命令、exit与指纹保存在本轮implementer/report-r0.md及ev，三树不重复执行。

ev03的首次永久链接行号检查exit1：新设计将test_analysis_service.py范围写到140行，而该文件实际138行；修正为111–138，源码/测试零改。ev04全仓Markdown基线与候选各12处既有失效，新增失效/解析错误/未核验项均0；旧失效不在本轮扩大修复。后续最终复核保留新ID，不覆盖首失败。

TODO将原I1设计卡勾选归档，并保留清晰的用户确认/另拆实施待办；其他卡不变。todo-done只追加设计完成卡，旧字节前缀保留；状态页四类≤100行，计数/来源分列；新设计与本记录之外不新增文件到仓库。

当前仅设计，未获I1具体实施确认。不落B2事件，不解其切换/旧Job/retention/重新分析/bkt-v1五问；不改DB/HTTP/OpenAPI/前端，不做真实Provider、音频采集、权限或设备验证。完成报告后停写Review，不commit/push/PR/merge/部署，不继续检索、日志或实验。
