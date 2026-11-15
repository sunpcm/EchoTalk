# 2026-11-15 遗留台账对账（LGR，纯文档）

本轮为纯文档收口，白名单七 MD；源码/测试/配置/锁与所有其他路径严格原字节。实施与独立评审分离，
Harness 亲跑完整门禁并独立调查偶发（weekly-grammar 无重试复验、theme-storage 对照），后续共享实测。
71 未勾项是开工 HEAD 快照的待办清单，不是 71 个 Bug：其中既有「未设计/未实施候选」「后续维护候选」，
也有「待真实环境/设备」「待产品或权限裁定」与「部分完成」，分类见下表。

## 范围与基线

- 唯一 lane：`.review/worktrees/legacy-ledger-reconciliation-20261115`，branch
  `codex/legacy-ledger-reconciliation-20261115`，开工亲核干净 HEAD
  `76d9d6ba8c3ad72cf2c0671344ff48b617faea0f`、tree `019b24392f3c16ce5bfa34dff38b412935bfa938`。
- 白名单七 MD：`TODO.md`、`docs/PROJECT_STATUS.md`、`docs/history/todo-done.md`、本文件、
  `docs/verification/cross-platform/CP-06-CI-QUALITY-GATES.md`、
  `docs/verification/cross-platform/MACOS-PROBE-CI.md`、
  `docs/verification/cross-platform/IOS-SIMULATOR-CI.md`。
- 全源码/测试/配置/锁零改由 Harness 独立证明，不只在本文列 I1 四路径；实施方未读 reviewer
  私有目录/探针，只读 `R/shared/` 可共享实测（`target-evidence.json`、`main-ci-current-read.json`、
  `baseline-todo-inventory.json`、`native-current-inheritance.json`、`lgr-r1fresh-gates.json`）。

## 已核实发布基线（I1 实施 PR176）

- 设计 [PR175](https://github.com/sunpcm/EchoTalk/pull/175) → main `312a8f8`；实施
  [PR176](https://github.com/sunpcm/EchoTalk/pull/176) source
  `7f272cdb8845822010ae6658c8e1fc3a3913ec22` / CImerge
  `5e5c1f8466649248428ded72db979f73eb2172c7` / main
  `76d9d6ba8c3ad72cf2c0671344ff48b617faea0f`、tree `019b24392f3c16ce5bfa34dff38b412935bfa938`。
- PR/Guard CI 首轮六 success（[43686352704](https://github.com/sunpcm/EchoTalk/actions/runs/43686352704) /
  [43686352698](https://github.com/sunpcm/EchoTalk/actions/runs/43686352698)）；
  [mainCI 43686992533](https://github.com/sunpcm/EchoTalk/actions/runs/43686992533) 首轮五 success，
  jobs：frontend 132729437844、ios-build 132729437984、macos-probe 132729437994、backend 132729438046、CI 132730896705。
- Linux：Vitest 1249/53、Fake 125/types 10/build 21、E2E 234（C117/W117，retry/skip/flaky0，4.5m）、
  pytest 957/3warnings/80.63%（73.52s）。I1 实施候选（Harness/macOS）同计数，pytest 80.83s（命令 85.74s）、
  E2E 61.89s；本轮 LGR fresh macOS 17 门禁的 pytest 为 70.48s（命令 74.89s）、E2E 54.74s，见文末「门禁与停写」，
  三者分列，不把 I1 80.83s 冒成本轮 70.48s。

## 全量对账（baseline 71 未勾项，逐行映射）

分类：✅已完成可归档 · 🔶部分完成 · 🛠可直接修 · ⚖待产品或权限裁定 · 🌐待真实环境/设备 · 🆕未设计/未实施候选 · 📌后续维护候选。
按来源行号逐项保留（可合并去重，但每来源 ID 都在）。行号为开工 HEAD 76d9d6ba 的 `TODO.md` 行号。

| 行号 | 分类 | 摘要 / 剩余                                                                           |
| ---- | ---- | ------------------------------------------------------------------------------------- |
| 22   | ⚖    | B2 学习事件表：五问待裁，历史无法补录                                                 |
| 25   | ⚖    | 阶段 C 预发布：账号/密钥/费用待裁                                                     |
| 32   | ⚖    | 启动在途 + 两处文案（已确认全实施，实施待做）                                         |
| 40   | 🌐   | R2-09 平台接缝：`utils/env.ts` 已删，CP-03/04 设备证据待                              |
| 45   | 🔶   | R2-10 硬编码文案：迁移+扫描完成，标题/UUID 已确认、实施待做                           |
| 48   | 🌐   | R2-11 会话中界面：真实 LiveKit 待                                                     |
| 51   | 🌐   | R2-12 macOS 构建：CP-03 阻断                                                          |
| 55   | 🛠   | R2-13 组件归位：纯 `git mv`，排 R2-07 后                                              |
| 57   | 🔶   | R2-14 Compose：已确认采用方案 B、实施待做                                             |
| 69   | 🔶   | RF-04 远端证据核对：CP-06 §6 已更新；required check 403 未核                          |
| 74   | 🔶   | 周报剩余指标：会话次数+Top3 已，时长/环比口径待                                       |
| 79   | 🌐   | 语法 LLM SGEC：真实 Provider 需 Key                                                   |
| 81   | ⚖    | goals[]+Task Completion：产品口径待                                                   |
| 82   | ⚖    | 发音真实评估：切片采集待设计                                                          |
| 83   | 🌐   | 部署日志 Key/#102：需部署环境                                                         |
| 84   | 🌐   | 1.8.x/Turn Detector：等 RF-12                                                         |
| 90   | 🔶   | weekly-grammar 偶发：80/80 定向重验；历史 5/1、根因未知保留                           |
| 94   | ✅   | iOS CI 预下载有限重试：`ios-ci.mjs` 3 次/240s + mainCI ios-build success，已归档      |
| 97   | 🔶   | 防 bot 误合并：pr-guard.yml 已加，label/required check 待                             |
| 101  | ⚖    | worktree 清理：57 注册（.review 48），用户决定                                        |
| 112  | 🌐   | 宿主 HTTP：容器 loopback 已验，宿主入口未验                                           |
| 113  | 🌐   | 真实 Provider/IdP/LiveKit 等：整栈未启                                                |
| 130  | 🌐   | 宿主 HTTP（重复）：同上                                                               |
| 132  | 🌐   | 真实 Provider 等（重复）：同上                                                        |
| 148  | 🌐   | Key 后再验真实：5 分钟 5 轮语音等未验                                                 |
| 163  | 🌐   | 真实外部验收：新增 Linux/Docker 不替代真实服务                                        |
| 211  | 🔶   | RF-04 CI 真实性：CI 执行核销（main76 五 jobs 绿）；required check 403 待              |
| 240  | 🔶   | RF-05 精简基础设施：镜像 before 缺                                                    |
| 262  | 🔶   | RF-06 清理前端模板：组合/发布待                                                       |
| 280  | 🔶   | RF-07 可复现依赖：整栈/发布待                                                         |
| 309  | 🔶   | RF-08 迁移与时间语义：生产迁移/性能待                                                 |
| 326  | 🔶   | RF-09 LiveKit Agent：真实 LiveKit 待                                                  |
| 357  | 🔶   | RF-10 Provider Registry：真实 Provider 待                                             |
| 401  | 🌐   | RF-12 独立 SDK：前置未齐                                                              |
| 414  | 🆕   | 练习时长：口径未设计/未实现                                                           |
| 415  | 🆕   | p_mastery 环比：历史数据/口径未设计                                                   |
| 416  | 🆕   | 发音趋势：未设计/未实现                                                               |
| 417  | 🆕   | RAG 下周重点：未设计/未实现                                                           |
| 418  | 🆕   | 焦虑指数+语速趋势：未设计/未实现                                                      |
| 419  | 🆕   | i18n 框架：未设计/未实现                                                              |
| 420  | 🆕   | 数字人前端：未设计/未实现                                                             |
| 421  | 🌐   | 深色主题可读性补验：完整环境待                                                        |
| 450  | 🌐   | CP-01 平台适配：原生能力待设备                                                        |
| 454  | 🌐   | CP-02 恢复/占用/离线：真实链路待                                                      |
| 455  | 🌐   | 单设备占用/过期释放/接管：双端竞争真实链路待                                          |
| 456  | 🌐   | 真实离线/Token 失效/系统中断：真实链路待                                              |
| 462  | 🌐   | CP-03 macOS 比较：设备证据待                                                          |
| 463  | 🌐   | 候选最小语音/授权回跳：麦克风/音频/耳机/断网/休眠待                                   |
| 464  | 🌐   | macOS 方案决策：验证后定案                                                            |
| 468  | 🌐   | CP-04 Web OIDC+原生：真实 IdP/设备待                                                  |
| 469  | 🌐   | 原生 Keychain 续期/撤销/401：并发续期待                                               |
| 470  | 🌐   | IdP 回调白名单/audience：pairwise subject 待核                                        |
| 471  | 🌐   | 登录失效清理：账号切换隔离待                                                          |
| 475  | 🌐   | CP-05 恢复流程统一：真实链路待                                                        |
| 476  | 🌐   | iOS 音频中断/路由：来电/锁屏/蓝牙待                                                   |
| 477  | 🌐   | 手机视口/键盘/safe area：窄屏/横屏/大字号待                                           |
| 478  | 🌐   | 桌面窗口缩放/键盘导航：真机待                                                         |
| 479  | 🌐   | DocTalk 文件导入：真机待                                                              |
| 483  | 🔶   | CP-06 Linux CI 双浏览器：CI 绿；完整真实链路待                                        |
| 484  | 🔶   | CP-06 macOS runner：iOS/macOS CI 绿；CP-03/真机/签名待                                |
| 485  | 🌐   | 三端真实链路矩阵：真实 IdP→报告待                                                     |
| 486  | 🔶   | CP-06 诊断信息：本地一期已 Review；外部异常联动待                                     |
| 487  | ✅   | Native Room 夹具：A83 receipt + 当前继承/运行证据，已归档（`d8c9ff9` 非祖先事实保留） |
| 496  | 🌐   | CP-07 Web HTTPS/WSS：真实环境待                                                       |
| 497  | 🌐   | iOS Archive/签名/TestFlight：生产构建待                                               |
| 498  | 🌐   | macOS CP-03 决策交付：签名/公证待                                                     |
| 499  | 🌐   | 版本/OS/限制/回滚记录：发布边界待                                                     |
| 503  | 📌   | 简化 Room 快照：A19 P2 后续维护候选（非废弃）                                         |
| 505  | 📌   | 减少 start/resume 重复：A18 维护候选（非废弃）                                        |
| 507  | ⚖    | Android/Windows：产品确认后独立验证                                                   |
| 508  | ⚖    | 后台语音/跨设备/托盘：明确需求后单独设计                                              |

统计：✅ 2 · 🔶 16 · 🛠 1 · ⚖ 8 · 🌐 35 · 🆕 7 · 📌 2，共 71，与 baseline 未勾项一致。
I1 实施发布回执已另附 `todo-done.md`（不并入 71 未勾项）。baseline71 分类是开工快照，下列「后发生裁定」不伪装成开工时已确认。

## 集中裁定项（开工快照）

需用户裁定的项（证据/推荐/代价见 `R/implementer/decisions-r0.md`，此处给公开摘要）：
B2 五问、启动在途与两处文案、阶段 C 预发布、worktree 清理（57/48）、防 bot 误合并 label/required check、
goals[]+Task Completion 产品口径、发音切片采集边界、部署日志 Key/#102 环境访问。

## 后发生裁定（R2，2026-11-15）

用户在 R2 复核阶段实际裁定，写入当前 TODO 为「已确认、实施待做」，不先勾：

- 三处产品修改全部按推荐实施：实时 `isStarting`（活动会话订阅期更新启动态，先写挂载后启动态变化再触发 resume 的回归用例）、
  设置抽屉标题「自定义模型设置」→「设置」、活动会话行 UUID 仅展示行内前 8 位（不再展示完整 UUID）。
- R2-14 采用方案 B：公开 `/api/health` + 专用一次性迁移成功作为启动依赖，保留用户级 ready 认证。
  原「匿名 `/api/health/ready`」不能直接做匿名 healthcheck 的原因：`backend/routers/health.py:25–29` 的 ready
  端点 `Depends(get_current_user)`，需用户级认证；方案 B 用公开 `/api/health` 规避该认证依赖。
  禁止实际迁移/整栈/部署，B2 等原门禁不变。

## Native Room 夹具归档（R2）

Native Room 回归夹具卡由「当前继承待核」转为归档：parent 亲查当前 main76d9d6ba 的两个目标用例
（保存当前 DOM 实例、等待该实例 callback 登记）与旧 A82 的 AST 条款完全一致（wait1/owner1），同步停轨 act 内
原断言保全；fresh 当前 VoiceInterface 86 通过、全 Vitest 1249/53 通过（`native-current-inheritance.json`）。
此证据不依赖 `d8c9ff9` 祖先关系；非祖先事实与更正仍保留。不追认历史完整因果，真实 Room/设备其他卡仍独立未勾。

## 完成卡移入归档（R2a 机械补件）

R2 终审指出两张已完成卡仍以 `[x]` 留在根 TODO，`todo-done.md` 仅有回执/说明而无原卡正文。R2a 已把 iOS
有限重试卡与 Native Room 夹具卡两张【完整块】从根 TODO 移入 `todo-done.md` 末尾，`[x]` 勾选与原文逐字保留，
旧 91,043 字节前缀守恒，根 TODO 不再保留这两张完成卡。同轮更正两处机械事实：根 TODO 工作树统计为
「本仓 57 注册 worktree，其中 `.review/worktrees` 48」；`PROJECT_STATUS` 17 门禁枚举去掉重复 E2E，剩余 11 项。

## 门禁与停写

实施方仅文档校验（Prettier + 静态检查，经 `ev.sh` 留证）。本轮 Harness 已亲跑 fresh macOS 全部 17 项现存门禁
exit0（vitest/fake-api/api-types/build-scripts/lint/typecheck/build/check-api-types/openapi/providers/
backend-format/backend-lint/pytest/e2e/format/agent-contract/agent-types），source 前后字节不变；三测试树计数
Vitest 1249/53、E2E 234（C117/W117，retry/skip/flaky0，54.74s）、pytest 957/3warnings/80.63%（70.48s，命令 74.89s），
与已发布 main76/Linux 同计数、不同耗时（Linux pytest 73.52s）。首工具失败为复制 markdown helper 的 first ownership
guard 拒绝，已保留并纠正；markdown baseline/candidate 各 12 处既失效、无新增 broken/parse/unchecked，parser 173→174 files。
`source_writes_stopped=true`；停 Review，不 commit/push/merge，不接下一包。
