# MACOS M1 native host：r3 固定 macOS 布局

日期：2026-11-01。lane `/Users/sunpcm/code/EchoTalk/.review/worktrees/macos-m1-20261101`，
分支 `codex/macos-m1-native-host`，HEAD `b6ddb0efd95f57ea4ea8d324f4789210aab0adb4`。
r3 的批准16文件与 frozen-source-r2 相同，dirty 基线指纹
`99661e25afcb7b2c4eb08ae6ff80d0d9aa634490717e71109f49af89158ccc66`。
上轮 offline11 和新增两锁本轮只读。

## 范围与执行分工

只可改 policy.mjs、build.test.mjs、README.md、本文。其余12输入（含build.mjs/Rust/config/web/icon/两锁）只读，不新增文件或功能。不改 main/cp00/其他lane/runtime/history/sharedlock，不读reviewer私有材料；不委派/安装/build/app/commit/push。

**阶段快照（r3实施交付时）**：主控编译/bundler已0，生成约17.98MiB `.app`；实际布局是 `target/aarch64-apple-darwin/debug/bundle/macos/EchoTalk M1 Native Probe.app`，旧wrapper查错bundle/app而返回78，session56377已退出。r3仅对齐固定布局及独立行为回归，完整wrapper成功待主控复验，未运行候选。最终以同批次主控report.md绑定源码/hash的收口状态为准，不因后续状态变化只为措辞重开实施轮。

## 当前证据等级

| 内容                     | 当前结论                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Git/目录/AGENTS          | 本节点核对r3批准dirty16与r2冻结清单一致，其余12输入/offline11只读                                                |
| 官方 native 预检         | 主控声明路径通过；回执明确未查实际权限/网络、未启动模型，不替代本节点工具事实                                    |
| CLI/Rust 版本选择        | 来自主控 versions.json：CLI 2.12.4、tauri =2.12.5、tauri-build =2.7.4、MSRV 1.90；本节点未联网复核               |
| CLI 两包缓存             | 主控 clarification-r0a.md 确认成功；库存命令 exit1 原因为 Rustfmt 不存在，未当缓存失败                           |
| Rustfmt/cargo-fmt        | 工具缺失，未执行、不安装；人工格式核对不能计通过                                                                 |
| Node 测试/精准 Prettier  | 最终源码/文档格式后初步冻结，串行执行；实际统计、hash 与 exit 以实施报告 ev 为准                                 |
| 相邻 offline70           | 可对只读源码运行独立离线回归，未改其断言；执行与否以本轮 ev 为准                                                 |
| package-lock/Cargo.lock  | 主控已原生生成，393 Cargo 包（392依赖）、arm64 fetch/安装成功；本节点只读两锁并绑定 hash，fixture 假锁仅用于测试 |
| Tauri/Rust 原生构建      | 主控编译/打包0，旧wrapper因路径返回78；r3完整入口待主控复验                                                      |
| `.app`/系统/媒体/OIDC    | 未运行候选、无真实能力接线或设备证据，M1 真实硬门禁未通过                                                        |
| 业务 frontend10/backend5 | 本轮不运行、不计通过；未来共享业务仍保留 15 门禁与 59% 下限                                                      |

## 源码与入口

完整操作和接口责任见 [native probe README](../../../tools/macos-m1-native-probe/README.md)。
独立 private npm 包、独立 Cargo `[workspace]`、静态 HTML/CSS 和极小 Builder；一窗口、空 capability permissions、无 IPC handler/插件、CSP 拒绝网络。

r3 将固定输出定位到bundle/macos；新增回归由builder独立按真实厂商布局写产物，而非跟随plan.bundle，要求executeBuild完成plist和Mach-O验证成功。原52项门禁、旧产物/坏产物拒绝逻辑不弱化，无路径扫描或宽松回退。

r2 新 PNG 为 Node 标准库确定性生成的32×32 RGBA纯色构建资源，104 bytes，无外部/私有图像。生成脚本、CRC/解压自核与 hash 在 implementer/r2；validateInputs 增加其文件/safe-path要求，缺失与 symlink 行为回归断言 CLI 调用数0，原50项不弱化。仅补此必需 PNG，不生成整套图标或新增配置。

`probe:test` 是 Node 22 原生测试，有 5 秒单用例上限，不需安装。构建测试用假 CLI/构建资源和隔离 fixture，但 plist 转换、Node 子进程退出/超时为真实本地操作。假 Mach-O header 只验证拒绝/接受逻辑，不证明 native 编译或可运行性。

r1 在未修复实现上实际追加两条真实进程回归，原40项通过、新2项失败（exit1）：build 双流丢失，捕获分支还被 1 MiB maxBuffer 截断。新增回归通过生产 runChild 输出独特双流和 exit37，在外层核完整内容、后步不启动、控制行不粘连。最终测试结果见本轮 r1 ev，不能用原40绿否认该缺陷。

`probe:build` 是实际本地 Tauri CLI wrapper，不接受额外 argv/路径/配置覆盖；锁缺失明确非零。固定 arm64/debug/app/--no-sign/--ci，Cargo 追加 locked/offline/jobs2。路径强制为 lane `.review/m1-native-host/{cargo-home,target,npm-cache,tmp,clang-module-cache,xdg-cache}`；后两者分别绑定 CLANG_MODULE_CACHE_PATH/XDG_CACHE_HOME，规划和创建均检查 safe-path，拒绝调用方覆盖。HOME 原值保留，白名单子环境剔除业务/签名/代理/Rust/npm 覆盖。拒绝 symlink、额外 Tauri config/capability、祖先 Cargo config。

磁盘约 11 GiB 为主控澄清时的观察；源码固定 debug=0、incremental=false、split-debuginfo=off、jobs2、单 target，不扩成 release/universal/dmg/dSYM。实际空间不足须主控保留失败，不清理其他项目。14.0 只是构建声明，不承诺设备兼容。

本次 build 成功须本次生成固定 `.app`，核 plist 和 executable 结构/hash；旧候选只在专用 target 中改名保留，不以旧产物充数。实际 build stdout/stderr 完整继承到本地 ev，无固定 maxBuffer；version/help/plist 捕获用于解析，同时完整转发两流，包括失败和非法响应。控制记录保持固定字段并先换行，不将原始输出或环境塞进 JSON；用户只需摘要，完整工具日志留本地，不以隐私假设抹掉清洁工具诊断。wrapper 70/124 为异常/超时状态，不伪报真实 child exit。实际 native build 和系统能力仍未验收。

## 交付与后续补证

本轮报告/初步源码与工具 hash/真实 ev 只在：

`/Users/sunpcm/code/EchoTalk/.review/reports/macos-m1-native-host-20261101/implementer/r3/`

验收入口 `/Users/sunpcm/code/EchoTalk/.review/reports/tools/ev.sh`。历史保留；r3只格式写4文件、冻结16输入，串行完整Node/offline70/10目标精准格式（12只读输入不写）。停写后主控完整fixed入口及静态bundle检查，wrapper0/候选运行/设备验收分别记证据，不把已有child0当wrapper0。Rustfmt缺失未执行，不安装、不计通过。

原生归档用明确 allowlist 与 `COPYFILE_DISABLE=1` 防 AppleDouble 计数误报，排除 node_modules/Cargo 缓存/target、dotenv、凭据、音频和私有材料。没有实际构建/候选包 hash 就保留未验证；后续录音、真实 IdP/API/LiveKit、系统登录、Cloud 接管和分发分别验收。本阶段不进入正式 M2 工程。
