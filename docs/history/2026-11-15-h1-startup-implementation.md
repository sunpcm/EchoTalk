# 2026-11-15 H1方案A启动编排实施与验收回执

用户已明确确认方案A并授权实施；Harness独立源码Review为APPROVED R0，无代码返修。本记录与归档勾选表示源码工作完成，**不表示全部门禁通过或已发布**：本机基础14/15，完整E2E首次233/1、唯一完整重放仍233/1；H1实施Linux CI/Guard与发布待对应实际回执，不预填实现PR或终点SHA。本轮不修主题、不开始I1/B2。

## 1. 基线与证据来源

实施lane为`.review/worktrees/h1-conversation-startup-implementation-20261115`，branch `codex/h1-conversation-startup-implementation-20261115`，初始干净，HEAD始终为设计合并main `650b3c7d60eee081a32e7ff9170a7fc7d6a11d06`、tree `141e4ec2d5e8be13d9daaca4631bf21dbdc0784b`，index保全。该HEAD用于隔离开发身份核对，不是尚未发布的实施终点。

| 来源                    | 实际内容与归属                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 实施方原生继承节点亲跑  | 源码/指纹/迁移AST自检、新契约及原两份Vitest、typecheck/lint/format；原报告与ev保留，不冒认完整三树或浏览器。                 |
| Harness亲跑/macOS arm64 | 完整Vitest、Fake/API类型/构建脚本、pytest、两次完整E2E、四项有效私有变异与逐字节恢复；来自共享`harness-validation-r0.json`。 |
| Harness回读Linux CI     | 已发布H1设计PR173及最终main650的实际CI/等树回执；来自共享`design-final-main-receipt.json`，不是实施方亲跑CI。                |

两份共享JSON均位于本地`.review/reports/h1-conversation-startup-implementation-20261115/`根目录；实施原报告与格式/范围证据仅在其`implementer/`下，不纳入Git。未读取reviewer目录或私有探针。本次文档不访问外部Nowledge、真实依赖或服务，不追加测试重放。

已发布设计[PR173](https://github.com/sunpcm/EchoTalk/pull/173)的source `22802645bd6b41a1ff4438e2df8fbb384e49c2ed`、CI merge `3efe344fac0431a774c28a47682d6b83efe52789`及main650严格等tree。设计[PR CI43672738464](https://github.com/sunpcm/EchoTalk/actions/runs/43672738464)与[Guard43672738467](https://github.com/sunpcm/EchoTalk/actions/runs/43672738467)六检查success，但其E2E实际为233passed/1flaky（C116passed+1flaky/W117passed，额外retry1、skip0、failed0，3.8m）：Chromium `a11y-focus-touch.spec.ts:57/64`首轮阈值期望≥6、实得5，retry#1通过；根因未知，本轮未修。设计PR pytest895/3warnings/79.71%/54.79s。

最终设计[mainCI43673387467](https://github.com/sunpcm/EchoTalk/actions/runs/43673387467) attempt1五作业success：Vitest1234/52、Fake125、types10/build21、E2E234（C117/W117，实际retry/skip/flaky0，3.7m），pytest895/3warnings/79.71%/63.30s。该已发布Linux基线与下述未发布实施候选分列，不能互相替代。

## 2. 实现与冻结范围

只修改`apps/vite-app/src/store/conversationSlice.ts`并新增同目录`conversationStartup.ts`及`conversationStartup.test.ts`。原runStartup迁入factory，返回原async闭包；API/auth/platform/coordinator/i18n以普通延迟ports在原调用点读取，不新增await/调度层、API实参、abort或重试。factory构造时不读动态值、不订阅、不调API或timer；被返回的runStartup仍是有副作用的编排函数。

原begin_checking同步占槽及写后auth/gen复核、adapter构造后和各await/catch/订阅后门禁、native pending与10秒/Web快路、disabled能力门禁、readinessOnly早退均保留。tracker/options继续slice模块级，原setSession原子updater、常驻readiness auth观察、resume及所有其他公共动作保全；每轮timer/unsubscribe/adapter与cleanup幂等/仅清自身指针归属不变。

| 冻结文件                                              | SHA256                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/vite-app/src/store/conversationSlice.ts`        | `450c6881c3e59bd4079971e7b86b9b92c20b210a59886da7b5ad6a3fe248c228` |
| `apps/vite-app/src/store/conversationStartup.ts`      | `345bf5e10098799b7cafcd625f4b51c8424b1fca15573aae1c391b9981cde47f` |
| `apps/vite-app/src/store/conversationStartup.test.ts` | `7669b7cef91e1ddb09e4756d3de787bca0962ec2dbcd161ae3a30b1bba593ed7` |

两份旧测试零改且实际通过：`conversation.test.ts`120条，SHA256 `c3075b6495e9b383dbe7c1ba81ede985ee1e32896ed208f813dd6a554d27071c`；`VoiceInterface.test.tsx`86条，SHA256 `b7785ac1aead5c8d474d4c08171e7806678fa35e5166f19b9e291a25d8d4ce02`。开工687份非dotenv tracked文件中仅slice改变，其余686份原字节保全；新增恰为上述两文件。文档收口另经本轮授权，源码/旧测试/配置继续冻结。

新测试共15条：12条直接factory契约、3条真实appStore slice接线，沿原barrel mocks。覆盖构造零读取、Web同步阶段与精确API参数/顺序、写后auth变化前adapter零创建、构造后动态依赖、分别读取两次options、native有限等待、readinessOnly、当前token失败一次补偿及成功不补偿、迟到create、旧轮资源与dispose同步重入的寄存器归属、短期cleanup后readiness常驻观察者仍响应换号。

机械等价证明限定于明确port反向映射后的函数体AST：8个await、7个try、7个catch、49个return保持；slice剔除允许的启动区域、类型及必要import后，其余完整文本原字节相同。它不证明所有动态ports接线、运行环境/调度或真实外部依赖等价，也不能单独排除H1与本机E2E失败的关联；真实接线测试和四项变异仅提供各目标的独立证据。

## 3. 实施自测、首失败与修正

实施方所有源码验收经本轮`implementer/ev`新ID运行；`02-vitest-target`首次219passed/1failed（3.56s），两份旧测试206/206，新测试夹具未先建立readinessIssue便直接重检，触发原包装的合法早退。修正为先经真实startSession和503建立错误，再用新adapter成功重检并检验常驻auth观察者；不是原产品RED，没有改原动作或削弱断言。

`03-typecheck`首次exit2，两处TS2345：新增夹具将返回Promise<Session>的endSession mock为undefined；改为合成ended Session。219/1和两处类型错误保留，不以最终通过覆盖。构造探针后续改为记录/透传合法port以命中明确断言；timer用例在factory构造后切换fake timers，锁住调用点读取，最终仍15条。

最终`12-final-vitest-target`221/221、3文件（新15+旧120+86），3.83s；`13-final-typecheck`exit0、4.922s；`14-final-lint`exit0、132warnings/0errors、5.207s；`15-final-format`exit0；`16-final-scope`与`17-handoff-check`exit0。原R0报告及全部首次ev保留，原生节点未启动浏览器、Fake API、pytest、数据库或后台服务。开工辅助本地检索EPERM/exit1亦保留于原报告，不当作产品失败；本次文档不重试检索。

实际亲跑子命令及cwd：app目录`pnpm test src/store/conversationStartup.test.ts src/store/conversation.test.ts src/components/conversation/VoiceInterface.test.tsx`；根目录`pnpm exec turbo run typecheck --force`、`pnpm exec turbo run lint --force`、`pnpm format:check`。原锁环境Node22.13.1/pnpm10.26；三代码路径Prettier写入及静态SHA/AST检查的完整命令在原ev。此次文档仅对五MD进行必要格式/范围核对，具体新ev与耗时以`implementer/report-docs-r0.md`为准，不把它充作缺失的E2E通过项。

## 4. Harness完整三树及门禁

以下均是Harness亲跑macOS结果，由共享JSON转交，非实施方执行。

| 项目                      | 实际结果                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| 源码候选基础门禁          | 14/15成功；失败项为完整E2E，不称全绿。                                                       |
| 完整Vitest                | 1249 passed / 53 files（相较已发布设计1234/52，新增15条/1文件）。                            |
| Fake / API类型 / 构建脚本 | 125 / 10 / 21 passed。                                                                       |
| lint                      | 132warnings / 0errors。                                                                      |
| 完整backend pytest        | 895passed / 3warnings / 79.71%，pytest67.10s，命令71.66s；59%覆盖率门禁通过。                |
| 完整E2E首轮               | 233passed/1failed：C117/0、W116/1；duration66803.75ms=66.80375s；实际retry/skip/flaky均0。   |
| 唯一一次完整E2E重放       | 233passed/1failed：C116/1、W117/0；duration55640.223ms=55.640223s；实际retry/skip/flaky均0。 |

两次失败均为`apps/vite-app/e2e/theme-storage.spec.ts:4`的冷启动storage getter抛SecurityError场景，在24行`toHaveAttribute("data-theme", "warm")`实收cool；失败浏览器前后不同。不能将各次不同浏览器的成功结果拼成234通过，也不继续反复重放。G3设计曾在H1实施前于相同位置发生WebKit warm/cool失败，仅作历史对照，不是本轮实跑原版基线，不证明历史或当前根因相同、不证明主题已修复。源码机械等价也不足以判定无关；根因仍未知，本轮不改主题产品口径或测试。

首轮E2E JSON SHA256为`9070c7441142e23b4d7ad5f5309c63757ac7519ecfe2744a55126c7ddd21f73a`；唯一重放为`de307666d3d25a1037a46f02f6e0dc32ddb0f559feafc5dbdf51331ae4641c69`。这里只引用共享JSON中的统计、失败信息与制品指纹，未读取私有probe或声称查看trace；共享回执未给出的E2E命令耗时不补猜。

## 5. 四项有效私有变异

Harness在自有副本执行，正式lane不变异。以下定位、目标与exit来自共享JSON；确切断言对应上述冻结测试。每项目标RED exit1，逐字节恢复`restored_bytes=true`后新同层测试15/15 GREEN，不将解析、初始化错误、无关失败或全局timeout算有效变异。

| 名称      | 实际变更文件:行                                                             | 确切目标断言                                                                                                                                             | 恢复                                          |
| --------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| postauth  | `apps/vite-app/src/store/conversationStartup.ts:98`，写后auth复核           | `apps/vite-app/src/store/conversationStartup.test.ts:317:48`：`expect(h.ports.createLifecycleAdapter).not.toHaveBeenCalled()`                            | exit1目标RED；restored_bytes=true，15 GREEN。 |
| timeout   | `apps/vite-app/src/store/conversationStartup.ts:280`，native超时边界        | `apps/vite-app/src/store/conversationStartup.test.ts:350:43`：`expect(h.state()._sessionState.phase).toBe("checking_health")`                            | exit1目标RED；restored_bytes=true，15 GREEN。 |
| orphan    | `apps/vite-app/src/store/conversationStartup.ts:465`，当前token异常补偿路径 | `apps/vite-app/src/store/conversationStartup.test.ts:402:49`：`expect(h.ports.api.endSession.mock.calls).toEqual([[session().id]])`，token rejection用例 | exit1目标RED；restored_bytes=true，15 GREEN。 |
| ownership | `apps/vite-app/src/store/conversationStartup.ts:166`，仅清自身tracker指针   | `apps/vite-app/src/store/conversationStartup.test.ts:481:25`：`expect(h.tracker()).toBe(newTracker)`，dispose同步重入控制例                              | exit1目标RED；restored_bytes=true，15 GREEN。 |

这些是已执行的四项；设计原表及实施报告的其他建议仍是计划，不追认已跑readinessOnly/options缓存等未提供回执的变异。正式三代码文件指纹前后稳定。

## 6. 文档收口、未验证与停止点

本轮只更新TODO、状态页、设计页、完成归档并新增本记录。TODO的H1已确认实施卡勾选归档，其他卡不变；todo-done旧前缀逐字节保全。设计页只更新顶部与收口段，冻结原事实、历史源码链接和方案草图保留。状态页四类≤100行，已发布设计Linux与本机实施候选分列。

当前token失败补偿与取消后迟到create/token的既有差异保留，丢弃迟到结果不证明服务端没有孤儿；未统一finally/end、未修全局tracker既有异常策略。真实Provider/LiveKit/IdP、语音、设备、OS权限/原生弹窗、整栈与部署未验；H1设计与实施不勾掉这些边界。I1/B2和其他用户决策仍独立。

源码已独立APPROVED R0；文档交付停Review，Linux实施CI/Guard与发布待对应实测回执。实施方本次未commit/push/PR/merge/部署，未启动服务、浏览器或补实验；完成必要格式/范围检查并确认本任务受管命令终态后停写，等待Harness独立Review。
