# macOS M1 探针 CI 门禁

本轮仅为 `tools/macos-m1-native-probe` 接入离线回归和真实无签名构建，仍是独立 M1 探针，不进入正式 macOS 客户端或 M2。认证、媒体、公开配置与设备验收边界见 [探针 README](../../../tools/macos-m1-native-probe/README.md) 和 [离线媒体验证](./MACOS-M1-OFFLINE-MEDIA.md)。

最终结果同步：2026-11-03。主控最终组合 21 项检查全部通过，含组合 Node 240、
actionlint/assets 和 54 份原生编译输入一致性审计。B 线真实 Rust 57、无签名 arm64
构建及 Mach-O/plist 证据继续有效，原生 App 未运行。独立 Review 与提交状态以本轮主控
最终报告为准。

## 固定 runner 与入口

`.github/workflows/ci.yml` 新增 `test-macos-probe`，显式使用 `macos-15`，不使用 `latest`。按本轮架构裁定采用 GitHub 标准 arm64 runner，来源为 [GitHub hosted runners 官方清单](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)。该标签不保证底层机器永远不变，入口还会检查实际 Darwin/arm64、Node 精确版本和工具路径；不匹配即失败，不回退到 Intel 或本机配置。

- Node：22.13.1，通过 `actions/setup-node` 显式选择 arm64。
- Rust：1.93.1，安装 minimal 工具链及 `aarch64-apple-darwin` target；准备和检查阶段分别核实 rustc/cargo 的实际版本。
- Tauri CLI：2.12.4；LiveKit SDK：2.17.2；沿用现有 npm/Cargo 锁，不重新解析版本。
- job 上限 60 分钟，子命令有独立有限超时。workflow 仅有 `contents: read`，探针 checkout 不保留 Git 凭据；没有签名、公证、发布、上传 release 或 App 启动步骤。

CI profile 仅由 `scripts/ci.mjs` 显式选择。它检查 GitHub hosted runner 标记、macOS/ARM64、`HOME=/Users/runner`、实际 workspace 和固定工具缓存位置。Node 仅接受 `/Users/runner/hostedtoolcache/node/22.13.1/arm64/bin/node`，Rust 仅接受 `/Users/runner/.rustup/toolchains/1.93.1-aarch64-apple-darwin/bin`。路径布局变化会失败关闭，须独立审查后适配，不能用环境变量提供替代命令或任意路径。

原 `scripts/build.mjs`、`scripts/auth-test.mjs`、`scripts/assets.mjs` 的本地入口继续采用原本机路径和主机检查。设置 `CI=true` 或 GitHub 标记不会切换本地入口。真实子进程测试在本机仍经过本地入口；在 GitHub runner 上使用测试专属的合成 plan 调用真实构建管线，合成 CLI/Mach-O 只验证脚本行为，不作为原生编译证据。

## 准备阶段与离线检查阶段

在探针目录中，workflow 按顺序运行：

```bash
node scripts/ci.mjs prepare
node scripts/ci.mjs
```

这两个命令仅适用于上述受限 GitHub runner，不是本机安装或 App 运行指令。等价 package 入口分别为 `probe:ci:prepare` 和 `probe:ci`；CLI 不接受其他参数或任意命令。

准备阶段先拒绝探针 `.npmrc`、未知 package 字段、额外脚本及偏离固定依赖的 package，再在 lane 的 `.review/m1-native-host/` 下创建隔离 npm/Cargo/target/tmp/编译器缓存。子进程使用明确环境白名单，不继承 token、代理、签名身份、编译器覆盖或用户 npm 配置。已有环境覆盖和祖先 Cargo 配置拒绝规则保留。

准备阶段运行固定 `npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org`，然后执行既有 SDK/许可证/权限验证及缺失输出生成；SDK 必须满足已有精确版本、字节长度和 SHA256。随后以同一个隔离 Cargo home 执行 `cargo fetch --locked --target aarch64-apple-darwin`。仅该 fetch 显式关闭 Cargo offline；准备过程前后都核对锁字节，fetch 前后核对完整输入哈希。成功回执绑定本次探针源文件、两锁、SDK 源及生成输出；重复准备拒绝覆盖回执。

检查阶段要求准备回执存在且与当前输入完全一致，不安装或 fetch。然后依次执行：

1. 全部八个 Node 测试文件，包括新增 `scripts/ci.test.mjs`，保留每文件 5 秒超时。
2. 真实 `cargo test`，固定 manifest、arm64 target、`--locked --offline --jobs 2`，不是 Node fixture。
3. 真实 Tauri debug `.app` 构建，固定 arm64、app bundle、`--no-sign --ci` 及 Cargo `--locked --offline --jobs 2`。

Node 后和原生阶段后都校验输入，防止使用准备后漂移的源码。构建继续保留旧包，要求产生新包，验证 arm64 Mach-O 可执行头、plist 身份/版本/最低系统版本/URL scheme/麦克风说明，并输出二进制、plist、配置、两锁及输入 SHA256。只构建和读取产物，不启动包。

任一阶段非零立即停止并传播真实退出码；超时为 124，信号或未完成子进程为 70。只有完整验证产物后才输出 `ci-passed-built-not-run`。新 job 加入聚合 `CI` 的 `needs` 和显式 success 判断；failure、skipped、cancelled 都不能让聚合成功。原 frontend/backend 两个 job 的名称、步骤和命令保留。

## 回归与证据等级

新增 Node 回归覆盖受限 profile 的 runner/版本/路径/环境拒绝、固定安装和编译命令、准备回执及锁漂移、跨阶段顺序、真实 Node 子进程非零退出的传播、信号/超时、零退出但无产物的拒绝，以及真实 Bash 聚合脚本的三路 success 判定。已有探针 Node/Rust 测试树保留。fixture 会复制显式输入白名单中的 CI 脚本，不放宽为任意脚本目录。

2026-11-02，主控对 B 工作线 r1 源码执行本地受控检查，`checks/native-r1/summary.json` 记录六项均 exit0。以下保留该次真实结果；最终组合审计已确认其 54 份源/SDK/静态输入与组合树完全一致。

| 证据                            | 主控 native-r1 本地结果                                         | 能证明的范围                                         |
| ------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------- |
| 本地 Node 回归                  | 八文件 240 pass，0 fail / skipped / cancelled，exit0            | 脚本、合成 fixture 和退出传播                        |
| 本地真实 Rust 测试              | 57 pass，0 fail / ignored，exit0                                | 当前原生测试源码的真实编译和测试                     |
| 本地真实 unsigned arm64 `.app`  | 真实构建及 Mach-O/plist 验证通过，exit0，收据为 `built-not-run` | 当前新包构建及静态产物验证；没有运行 App             |
| workflow/actionlint             | 真实 actionlint exit0                                           | workflow 静态语法检查，不是远端运行                  |
| SDK/权限生成                    | assets 严格入口 exit0                                           | 受验证的 SDK、许可证与精确权限生成                   |
| 格式                            | native-r1 检查 exit0                                            | 该次输入的格式；本文收口后的格式由主控复核           |
| 远端 GitHub CI                  | 未运行；本轮没有 push                                           | runner 实际可用性、网络和端到端 CI 尚未验证          |
| 真实登录/媒体/TCC/设备/Provider | 未验证                                                          | 不由上述离线或构建结果替代                           |
| 组合 frontend10/backend5 十五项 | 最终组合检查全部通过；Vitest 1003、全 E2E 160、pytest 644       | 证据见下方最终组合结果；独立 Review/提交另由主控绑定 |

本地证据均相对主 checkout 的 `.review/reports/macos-probe-ci-20261102/`：

- 受控检查汇总：`checks/native-r1/summary.json`；完整 ev：`ev/ev-09-native-r1.txt`。
- 八文件 Node 原始日志：`checks/native-r1/03.log`；真实 Rust 原始日志：`checks/native-r1/05.log`。
- 真实 `.app` 构建及 Mach-O/plist 验证收据：`checks/native-r1/06.log`；其中 `tauri-build`、`artifact-plist` 均 childExit0，最终阶段为 `built-not-run`，同时绑定输入和产物哈希。
- actionlint、assets、格式分别见 `checks/native-r1/02.log`、`04.log`、`01.log`，退出码和日志 SHA256 由汇总绑定。

首次失败及修复证据保留在本地评审报告。所有既有本地日志和交付/Review 报告保持原样，保留于 `.review/`，不纳入 Git。

本地构建与组合检查不代替远端 CI 或真实设备验收。依赖准备网络失败或 runner 布局变化仍应记录为环境失败，不能改成测试通过或删除 native 阶段。

## 最终组合结果与输入一致性

主控 `.review/reports/practice-readiness-20261102/checks/combined-final-r0/summary.json`
记录 21 项全部 passed/exit0，含完整 frontend10/backend5 与六项组合检查。

| 最终组合项目             | 结果                                                                                           | 日志                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 完整 frontend10/backend5 | Vitest 1003、Chromium/WebKit 全 E2E 160、pytest 644；78.61% coverage、3 warnings，59% 门禁保持 | `01.log`～`15.log`，计数分别见 `04.log`、`10.log`、`15.log` |
| 组合 actionlint/assets   | 均通过                                                                                         | `16.log`、`17.log`                                          |
| 组合探针 Node            | 240 passed，0 failed/skipped/cancelled                                                         | `18.log`                                                    |
| 原生编译输入审计         | 54 份源/SDK/静态输入与 B 实际编译输入完全一致，绑定原生可执行文件和 plist 哈希                 | `19.log`                                                    |
| 独立 HTTP/浏览器初始化   | HTTP 9 场景零解密/零外网；浏览器 2 个控制场景通过                                              | `20.log`、`21.log`                                          |

表内日志相对上述 `checks/combined-final-r0/`；命令 argv/cwd、输入和日志哈希由对应日志及
summary 绑定。原生输入审计使 B 线真实 Rust 57 和 unsigned arm64 `.app`/Mach-O/plist
结果适用于相同输入的组合树；本次未在 A 重编译，原生 App 未运行。
此前两项有效变异已被真实断言杀死并还原，详见[练习前置检查验证](./PRACTICE-READINESS.md)。

独立 Review 与提交状态以本轮主控最终报告为准。文档同步时尚未合入 main，未 push/部署，
远端 CI 未运行；真实 Provider/LiveKit/IdP、TCC/设备/媒体等外部边界未验。
本次仅同步最终结果，功能代码不变，最终文档格式和字节由主控复核；未融合 next2 候选。
