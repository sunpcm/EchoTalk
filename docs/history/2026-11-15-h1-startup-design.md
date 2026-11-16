# H1会话启动编排抽取：设计R0

2026-11-15设计交付，待独立Review及用户确认；未实施，不启动H1/I1/B2代码。产物见[启动编排抽取设计](../CONVERSATION_STARTUP_EXTRACTION_DESIGN.md)。

## 身份、事实与设计决策

唯一lane `.review/worktrees/h1-conversation-startup-design-20261115`，branch `codex/h1-conversation-startup-design-20261115`；亲查初始干净，HEAD `1f06b03f8ad2abf8184a6491184f76165c226fd4`，tree `85982b79fd531819ecf0d3536f4719e91bbf06a9`，未切分支/拉取/reset/stash/clean/rebase。开工保存685份非dotenv tracked文件哈希，并分别钉住两个旧测试。

推荐只抽slice内runStartup，保留纯状态模型/投影、唯一物理store及facade、readiness常驻auth观察者、resume、end/reset/Room所有权。通过延迟ports调用原barrel绑定；构造时不读API/auth/options，不增加await或调度层。runStartup包含API、timer、订阅及store写，注入依赖不使它变纯。

同步begin_checking先占槽、写后gen/auth复核、adapter建立后再次复核、native10秒与Web快路、disabled能力门禁、health/create/token顺序、readinessOnly零创建及DocTalk意图清理、孤儿补偿与取消后的迟到路径差异，逐项落基线源码永久链接。取消后丢弃结果不等于服务端无孤儿；传输abort/取消后补偿不在本轮改口径。

旧conversation与Voice测试零改“有条件可达”：保留mock/import/公开导出/setter、同步prefix与microtask、动态依赖和cleanup所有权。特别是Voice API mock不完整，不能在factory提前取getCallCapabilities/ApiError；保留延迟方法查找，不要求改旧mock。此为静态设计判断，尚无抽取候选；未来须新增同层契约测试并实际跑原测试。

五项未来变异计划覆盖写后auth之前的adapter零创建、readinessOnly、token失败孤儿补偿、native10000ms及options动态读取。均未运行，至少3项目标断言有效RED并finally字节恢复后GREEN才算未来实施验收，不以初始化/解析错误或全局timeout代替。

## 已发布G3来源（非H1新CI）

Harness共享 `g3-final-main-receipt.json`：G3[PR172](https://github.com/sunpcm/EchoTalk/pull/172)已合并至main1f06b03，source `bc66054e668cd37a4b9136878d9e6b0c14ddf953`、CImerge `5bad2492ad31a22e0f74657758cce9cb9d267902`、main三者等tree85982b7。PR CI43669809532、Guard43669809539首轮6/6 success；[mainCI43670316486](https://github.com/sunpcm/EchoTalk/actions/runs/43670316486)首轮5/5 success。此为Harness回读真实Linux日志/checks，实施方未访问GitHub或冒称执行。

已发布CI数字：Vitest1234/52、Fake125、类型10/构建21；E2E234（C117/W117、实际retry/skip/flaky0，4.0m）；完整pytest895/3warnings/79.71%/43.13s。公开PR已有最终回执，H1状态页按此更新G3现状；旧G3过程不回写。

## H1本机十四门禁（Harness亲跑）

独立共享 `harness-local-tests-receipt.json` 绑定同一HEAD，runner为Harness fresh macOS，author not executor，source_stable=true。14个step为vitest、fake-api、api-types、build-scripts、lint、typecheck、build、check-api-types、openapi、providers、backend-format、backend-lint、pytest、e2e，全部exit0。

| 项目                            | 本轮Harness/macOS实际结果                                          |
| ------------------------------- | ------------------------------------------------------------------ |
| Vitest / Fake / 类型 / 构建脚本 | 1234/52；125；10；21                                               |
| 完整backend pytest              | 895passed，3warnings；pytest63.39s、命令68.16s                     |
| 覆盖率                          | 79.71%，59.0%门禁通过                                              |
| E2E                             | expected234、unexpected0，C117/W117；实际最大retry0、skip0、flaky0 |
| E2E精确时长                     | JSON duration55247.788ms =55.247788s；命令56.58s                   |
| 格式边界                        | 共享回执明确final format尚未运行，须实施方MD停写后由Harness执行    |

共享pytest关键行原样为：`Required test coverage of 59.0% reached. Total coverage: 79.71%`；`895 passed, 3 warnings in 63.39s (0:01:03)`。E2E stats.startTime为 `2026-11-15T03:06:43.172Z`，configured retries为[0,0]，同时另有max_actual_retry=0，不能只用配置冒充实际重试数。

这证明未改源码基线本机树通过，不证明未来抽取候选或任何变异通过；也不替代Linux新H1 PR/main运行。实施方没有跑Vitest、pytest、Fake/HTTP、浏览器或服务，不读数据库凭据。

## 本轮改动、首结果与未验证

仅五MD：新增设计、修改TODO（勾选归档原H1设计卡并留用户确认后实施卡/原实施验收）、更新≤100行四类状态页、todo-done仅追加，以及新增本文。I1/B2/其他TODO卡、全部产品/测试/配置/生成物/锁及其他文档原字节保全。

实施方实际命令仅Node22/已有Prettier写/查这五MD及Python标准库检查范围、源码引用/测试指纹/归档前缀；均通过原ev新ID留证，详细命令/最终hash见本轮 `implementer/report-r0.md`。依赖由Harness按原锁离线准备，实施方没有安装依赖。

首结果保留：定向Nowledge thread检索一次连接本地14242 EPERM，未重试/提权，不作为事实依据；只读检索曾误用旧 `lib/api.ts` / `api/system.ts` / `nativeLifecycle.ts` 路径，rg exit2，随后用rg --files核实API目录barrel和实际lifecycle.ts，未将读路径错误称为产品或测试失败。未访问reviewer/私有probe/旧G3 lane或dotenv。

真实Provider/LiveKit/IdP、设备、原生启动可靠性、取消后的服务端记录、端到端送达/回收、Docker整栈与部署未验；B2政策及I1实现保持独立确认门禁。H1设计未获用户确认具体实现；设计合并授权只适用于APPROVED且CI/Guard绿后的设计集成，不自动启动实施。

停止点：设计源码事实与两个原测试指纹不变；源码和五MD停写在Review，无本轮测试/服务进程。不commit/push，不预告H1设计APPROVED或新CI成功；按既定交接待Harness审阅，I1设计由后续独立包连续推进。
