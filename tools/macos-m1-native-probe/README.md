# macOS M1：最小 native host 源码

这是独立的 Tauri 2 构建探针，不是完整 M2 客户端。只有一窗口和本地静态“构建探针”页面；没有 JS、业务页面、IPC 命令、插件、OAuth、Keychain、媒体、服务请求或原生生命周期接线。源码存在和 Node 测试通过，都不代表 `.app` 编译、运行或 M1 设备门禁通过。

下述状态为 r3 实施交付时的阶段快照：主控实际编译/打包 childExit0，产出约17.98MiB `.app`；旧 wrapper 查找 `bundle/app` 而实际在 `bundle/macos`，故返回78。r3 只对齐固定 macOS 布局，完整入口成功仍待主控复验。最终以同批次主控 report.md 绑定源码/hash的收口状态为准，后续运行结果不要求为本文措辞另开实施轮。

## 本轮交付与分工

| 项目        | 实际状态                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| 实施节点    | 仅源码/配置、Node 离线测试、精准 Prettier、文档与初交付 hash                                            |
| 依赖所有者  | 主控已完成锁/安装/fetch和编译/打包；r3仅修固定产物布局，等待主控完整wrapper复验，两锁只读               |
| 版本        | 主控提供的官方元数据选择 CLI 2.12.4、tauri =2.12.5、tauri-build =2.7.4、MSRV 1.90；本节点不联网重新核对 |
| 工具        | 固定 Node 22.13.1、现有 Rust/Cargo 1.93.1 绝对路径；Rustfmt/cargo-fmt 缺失，不安装，不计通过            |
| 锁/原生编译 | 主控编译/bundler已0并生成.app，旧入口错路径导致wrapper78；本节点不build或运行候选                       |
| 运行/设备   | 未打开候选 `.app`、未安装 `/Applications`、未录音、未连接真实服务；macOS 14 只作构建目标                |

主控澄清：CLI 和 darwin-arm64 两包缓存已成功，工具库存命令因 Rustfmt 不存在而 exit=1，不能误报 CLI 缓存失败或 Rust 不可用。本节点不读取该库存报告根，也不重复工具命令。约 11 GiB 可用空间只是主控当时观察，不是本节点新盘点或构建足够的保证。

## 目录与安全边界

- `web/`：HTML/CSS 静态页面，无脚本、外链、fetch、远端窗口或媒体。
- `src-tauri/`：独立 `[workspace]` Cargo 包和极小 Builder；不加入根 pnpm workspace，不引用上轮 offline probe 为运行依赖。
- `tauri.conf.json`：固定 main 窗口、禁 devtools、无全局 Tauri JS 对象；inline capability 的 permissions 为空，拒绝任何额外 capability 文件/配置 overlay。
- CSP 默认、脚本、连接、图片、媒体和 frame 均拒绝；只允许本地 CSS。没有 shell/fs/http/opener/Keychain 桥。环境过滤和 CSP 是配置边界，不能当 OS 权限沙箱验收。
- `scripts/build.mjs`：固定 CLI/子环境/产物路径及串行门禁；`policy.mjs` 只装配受限计划与校验输入。模块导出的 plan/runner seam 仅用于 Node 测试，不是 IPC、外部 CLI 配置或可接收任意 URL 的代理。
- package 局部 `.gitignore` 排除 `node_modules/`、Tauri `src-tauri/gen/`、意外 fallback `src-tauri/target/` 和临时日志；不改根 ignore。真正 Cargo 产物强制放 lane `.review`，锁文件保留可跟踪，不能加入 ignore。

未来 offline ports 的随机数、受保护事务、PKCE 交换和凭据操作应迁移到受信 native 端；不要把 `node:crypto` 模块塞入 WKWebView。本轮未开始这些接线，现有 Web/iOS/backend 和已批准 offline 11 文件保持只读。

r2 补框架默认必需的 `src-tauri/icons/icon.png`：32×32、8-bit RGBA、104 bytes，纯色 #42637a，Node 标准库生成并校验 PNG CRC/zlib，无外部图片或品牌改动。生成脚本留在 implementer/r2 证据；PNG SHA256 为 `f5ba8f37b105437f5cd7935a7e0802d573027e55029f7dd87f6f7d72900c2a5e`。validateInputs 对该文件执行存在性/普通文件/safe-path 门禁，缺失或 symlink 在任何 CLI 调用前拒绝；fixture 复制此真实资源。r3图标保持只读。

## Node 离线自测

不需要安装本包依赖。当前 lane：

```bash
cd /Users/sunpcm/code/EchoTalk/.review/worktrees/macos-m1-20261101/tools/macos-m1-native-probe
/Users/sunpcm/.nvm/versions/node/v22.13.1/bin/node \
  --test --test-timeout=5000 scripts/build.test.mjs
```

上面直接执行与 package 的 `probe:test` 相同的真实 Node runner；经 npm 运行时应使用两份不同路径的空 user/global npmrc，同一路径 `/dev/null` 会触发 npm double-loading 错误。测试只在本轮 implementer/r3 的 test-tmp 创建并清理隔离 fixture；fixture 的假锁/CLI/Mach-O header 不是候选锁、依赖解析、可运行程序或实际 native 构建。正常 pipeline 用 CLI/构建替身，但 `/usr/bin/plutil` 对已知合成 plist 的转换和 Node 子进程退出/超时确实运行，候选二进制永不执行。

r3 保留原52断言；新增 builder 独立写入已观察的 `target/aarch64-apple-darwin/debug/bundle/macos/EchoTalk M1 Native Probe.app`，不跟随 plan.bundle 构造路径，executeBuild必须完成plist/Mach-O校验。固定入口不扫描最近文件、不接受任意路径或回退到旧布局。

r1 新增真实 Node 进程测试：经生产 runChild 的实际 build 分支输出超过 1 MiB 的独特 stdout/stderr，外层逐流核完整内容及 exit37、失败后不启动后步；另核捕获工具的双流、非零/非法响应、未换行输出与 JSON 控制行分隔。它们不调用真实 Tauri/Cargo。原 40 项断言保留，测试临时目录移至 r1。

断言实际停止后续阶段、子环境不透传秘密、拒绝覆盖/路径/overlay、锁缺失关闭、不接受旧 `.app`、新产物 plist/arm64 可执行文件结构不符时拒绝，及真实 entry 的参数/缺锁退出。不能用这些测试声称 Cargo、CLI help、签名或物理系统能力已实测。验收经项目固定 ev.sh 留真实退出码。

## 主控后续构建入口

依赖安装不是 wrapper 的动作。主控已按授权完成本独立包真实锁、local node_modules、专用 Cargo 缓存及 arm64 fetch；依据 handoff/dependency-summary.json，本节点只读核两锁 hash，不重复安装/resolve/fetch。任何未来锁缺失仍明确非零，不静默 install、在线解析或回退旧产物。共享 npmrc/lock 不改。

主控可用如下清洁父环境调用与 `probe:build` 相同的真实入口；此命令**本实施节点未运行**：

```bash
cd /Users/sunpcm/code/EchoTalk/.review/worktrees/macos-m1-20261101/tools/macos-m1-native-probe
env -i HOME="$HOME" \
  PATH=/Users/sunpcm/.nvm/versions/node/v22.13.1/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  /Users/sunpcm/.nvm/versions/node/v22.13.1/bin/node scripts/build.mjs
```

HOME 值原样保留。wrapper 不接收额外 argv、路径、配置或环境覆盖；显式 Cargo/TAURI/Node 注入变量会拒绝。子进程只得到白名单：原 HOME、固定 PATH、CI/locale、14.0 目标及以下隔离位置，没有 dotenv、业务 Token、APPLE/TAURI 签名公证环境、代理、Rust flags、编译器 wrapper 或 npm 全局配置。也拒绝祖先 `.cargo/config*` 和独立 CARGO_HOME/config\* 的存在，不读取其内容；文件系统默认用户配置/第三方 build script 行为仍须主控独立审查，不能宣称环境过滤就是文件系统隔离。

| 路径/约束               | 固定值                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Node                    | `/Users/sunpcm/.nvm/versions/node/v22.13.1/bin/node`                                                                                    |
| Rust bin                | `/Users/sunpcm/.rustup/toolchains/stable-aarch64-apple-darwin/bin`                                                                      |
| 根                      | `<lane>/.review/m1-native-host/`，跟随本包物理所在 lane，CLI 不接收覆盖                                                                 |
| CARGO_HOME              | 同根 `cargo-home/`                                                                                                                      |
| CARGO_TARGET_DIR        | 同根唯一 `target/`                                                                                                                      |
| CLANG_MODULE_CACHE_PATH | 同根固定 `clang-module-cache/`；safe-path 校验后创建，不接受调用方覆盖                                                                  |
| XDG_CACHE_HOME          | 同根固定 `xdg-cache/`；safe-path 校验后创建，不接受调用方覆盖                                                                           |
| npm cache / TMPDIR      | 同根 `npm-cache/` / `tmp/`；user/global config 为同根不同路径的空 `empty-user.npmrc` / `empty-global.npmrc`；已有非空文件拒绝且不读内容 |
| target / profile        | 仅 `aarch64-apple-darwin` / debug；dev `debug=0`、`incremental=false`、`split-debuginfo=off`                                            |
| jobs                    | 参数和 CARGO_BUILD_JOBS 固定 2，CARGO_INCREMENTAL=0，CARGO_NET_OFFLINE=true                                                             |

串行调用本地 CLI `--version`（必须 2.12.4）和 `build --help`（10 秒上限），核实际支持 debug/target/bundles/no-sign/ci 及 Cargo 附加参数后，执行：

```text
node <本包>/node_modules/@tauri-apps/cli/tauri.js build
  --debug --target aarch64-apple-darwin --bundles app --no-sign --ci
  -- --locked --offline --jobs 2
```

主控 dependency-summary 已核实际 CLI 2.12.4 version/help 支持上述 flags/Cargo ARGS；本节点没有重复该工具命令或执行原生 build。wrapper 每次仍检查，不满足时停止，禁止自动换 flags、放开 online 或改版本。构建最长 20 分钟，非零状态原值传回、不走后步；启动异常/信号返回 wrapper 70、超时返回 wrapper 124，同时记录 childExit=null 和真实 signal，二者不伪装成真实子进程退出码。超时/异常会对本次 detached 子进程组发送 SIGKILL；不能据此承诺捕获逃逸进程或外部 OS 全量无残留。

旧同名 `.app` 只在自己的 target 中改名为 `.previous-UUID.app` 保留，未删除；CLI 本次必须生成新的固定 bundle。之后只用 plutil 读取固定 Info.plist，核 bundle identifier、binary 名、版本、14.0 最低目标、非 symlink 的可执行 Mach-O arm64 header，输出公开 hash。**不运行 `.app` 或二进制**，不验证签名、公证或设备可用性。

原始工具诊断在本地完整保留，用户聊天只给摘要：实际 build 直接继承 stdout/stderr，交固定 ev.sh 留双流，不受 maxBuffer 截断。固定 version/help/plist 工具捕获用于解析，同时将原始 Buffer 双流完整转发至本地日志（包含非零或无法解析的响应），不套 1 MiB 截断；这些短命令仍有 10 秒上限。大量编译日志走继承分支，不在 wrapper 内累积。

结构化控制记录仍只含固定阶段、工具版本、childExit/signal、wrapper 退出及输入/产物 hash，不把原始诊断或环境塞入这些字段。控制记录前显式换行，避免子进程最后一行未换行时粘连 JSON；不转储环境。日志留存与用户摘要是不同交付，不以减少回显为由抹掉编译证据。本轮修正的是本地 wrapper 缺陷，不是共享 skill 问题。

## 缺口、磁盘与回退

主控已实际编译/打包成功，但完整wrapper因旧布局返回78；r3仅修布局与独立回归，build.mjs/Rust/config/web/icon/两锁等12输入只读，不安装或构建。16文件冻结后交主控完整入口复验；package-lock仅精准检查不写。Rustfmt缺失，人工格式核对不等同原生检查；不生成dmg/release/universal或额外dSYM。

磁盘不足时如实停止，不清理其他项目或系统缓存。失败仅影响本探针源码和专用缓存/target；保留上一候选/证据，不把探针升格为正式产品工程。回退可由主控恢复已审 commit；本节点不执行 Git 集成/删除或应用安装。后续原生归档必须限定源码/原生锁/公开配置/hash，用 `COPYFILE_DISABLE=1` 避免 AppleDouble 计数误报，排除第三方包、缓存、dotenv、凭据、音频和私有材料。

验证记录见 [MACOS-M1-NATIVE-HOST](../../docs/verification/cross-platform/MACOS-M1-NATIVE-HOST.md)。业务 15 门禁本轮不运行；未来共享实现继续保留 frontend10/backend5 与 backend 59% 下限。真实系统登录、双向语音、单端接管、最低 macOS 支持和分发均未验收。
