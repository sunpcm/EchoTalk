# 2026-11-14 G2 主题对比度 CI 收尾

G2 [PR169](https://github.com/sunpcm/EchoTalk/pull/169)已squash至main
`b8a9baddff8a3102b8ef3815afead90667aa351a`，tree `7a90bb5c2a8c54326fc106d27b9e92a443527519`。
本轮只修[theme-contrast.spec.ts](../../apps/vite-app/e2e/theme-contrast.spec.ts)的确定主题输入与水合/样式前提，
代码独立APPROVED R0；候选实测与已发布mainCI失败分开记录。候选发布验证另以对应PR/main运行核对，不预告成功或猜新编号。

## 原失败与仍未知的历史因果

以下运行信息由主控交接Harness证据，非实施方亲跑或直接回读CI日志：

- PR169首次CI：230pass/3flaky/1fail，全为WebKit深色theme-contrast；同source失败作业重放234pass，
  retry/skip/flaky0。source为 `1a8dbed210cd66554d31cce91941b12e814f33c4`，与squash main tree相同。
- [mainCI43594803847](https://github.com/sunpcm/EchoTalk/actions/runs/43594803847)再次failure：
  **230pass/1flaky/3fail**，同一类；后端841passed/3warnings/80.59%，50.85s。重放GREEN不覆盖这些首失败。
- 原spec116/150对比度断言失败；错误文字rgb(237,235,230)、自身透明背景、ratio1.12，重试另有中间色。
  无可下载CI Playwright artifact，未读trace。扫描实际查找不透明祖先，报文却显示文字自身背景，不能据“透明”判假失败。
- Harness本机c5与候选dashboard-error-dark原用例各20/20，未复现不排除竞争，也不证明G2无关。

静态确认的缺口是旧helper晚emulate reduce、只写DOM，未建立settings水合/DOM/store及样式已生效的前提；
G2默认共享settings还可改变后例GET输入。产品CSS本来已有reduce=0规则，不能只说漏等250ms。

Harness额外三格受控对照：c5前置真实UI cool PUT404→后Context GETwarm；G2候选PUT200→GETcool；
候选不同fixture PUT200→目标GETwarm。**三个原目标AA断言均通过**，扫描时均dark、reduce=true、
body/root背景23,24,27、无活跃transition。它只证明共享输入通道，不是同类CI RED的复现。
历史CI具体因果仍未知；本轮依据已确认的测试前提缺口修正，不追认某触发就是PR/main首失败原因。

## 最小候选与保全

唯一实施lane `.review/worktrees/g2-theme-contrast-ci-followup-20261114`，分支
`codex/g2-theme-contrast-ci-followup-20261114`，开工HEAD为上述b8，tree7a90，工作树干净。
冻结spec SHA-256：`c8cd45e60496d26238375e310925245839b43a6fd5dfcab3099332534cabde3a`。

- 导航前设置reduce与本地主题；仅本spec用完整合法14字段GET夹具固定同一主题，启动及抽屉重新GET均一致，
  非GET继续原链。不新增隔离基础设施、不回退Fake为stateless/404、不改全局fixture。
- 检查loading=false、settings.theme/store.theme/DOM同目标、媒体reduce及相关computed样式终值、零活跃CSSTransition，
  再执行原扫描；没有sleep、rAF正确性假设或轮询对比度直到绿。
- 原18独立用例、21次AA调用（main18/抽屉3）、UI断言与扫描算法字节保全；其他672份已记录文件原字节。
  产品配色/语义、其他测试/fixture/config、依赖/锁未改，未新增正式用例。

## Harness本机验收与私有变异

以下全为Harness亲跑，代码字节前后稳定；实施方只跑静态/格式，不冒认浏览器、压力或三树：

| 范围            | 实际结果                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| 14非浏览器门禁  | 全部exit0；Vitest1227/51、Fake125、types8/build21；pytest841/3warnings/80.59%，自身62.77s/命令67.08s；format7.37s |
| 完整双浏览器E2E | 234/0，C117/W117，retry/skip/flaky0；54.884196s/命令55.83s                                                        |
| 目标18×2×10     | 360/360，C180/W180，retry/skip/flaky0；97.765687s                                                                 |

14非浏览器门禁加完整E2E共15项通过。两次有意义变异仅在Harness自有副本，备份恢复，正式lane从未变异：

- 私有 `styles.css:132` 给dark main p/button错误前景，保留的原AA `spec204` 真断言捕获。
- 私有GET fixture `spec34` 强制warm，新增就绪 `spec95` 真断言捕获。

恢复后目标360及完整234均GREEN，正式代码前后稳定。后一变异验证新屏障能挡住错误输入；
前一变异验证原AA仍捕获坏配色，不能用就绪屏障掩盖产品终态对比度RED。

## 首失败、未验证与计划外边界

- 据主控交接，依赖准备曾有沙箱内三次offline缺包首失败；获授权缓存环境按原锁offline安装582包/0download，
  独立Python3.12.12/101包完成。它们是环境准备证据，不算产品RED；实施方没有自行重装或读取其他lane私有日志。
- 实施自测格式、TypeScript解析/字节与OpenAPI夹具静态检查均exit0；未运行浏览器或三树。早先G2的监听EPERM/
  125cancelled、首次完整214/20及D1/T1/P1/W1等历史首失败仍保留[月史](./2026-11.md)原字节，不被此次全绿抹去。
- 本机通过不等于新Linux CI通过，发布验收另看对应运行；本轮不猜新PR编号、提交HEAD或CI结果。
- Provider大字号深色P2、真实方向键/OS popup、真实LiveKit/Provider/IdP、设备/部署仍未验收；
  本轮不做产品改色，不勾掉这些等待项。旧两条具名UUID偏差与显式Fake合成边界不变。
- 无计划外源码修复；G2原卡已归档，本轮只追加CI收尾补充完成卡，不重加active TODO。

本阶段仅写状态页、todo-done新后缀与本文，原月史不改；文档报告与证据在本轮implementer目录。
文档停在Review，source_writes_stopped=true；不commit/push/PR/merge/部署，不启动下一包。
