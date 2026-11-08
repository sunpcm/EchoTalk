# iOS Simulator 无签名编译门禁

本轮为 CP-06 增加独立 `test-ios-build` job：普通 PR 在不提供发布密钥的情况下，
构建共享 React 前端、显式同步 Capacitor，然后真实编译 arm64 iOS Simulator `.app`。
只有退出成功且新包通过静态产物验证，才输出 `ios-simulator-built-not-run`。

## 本次验证记录（2026-11-03）

B commit `d5b2414c33cc3db053daa5afbaa6f9d4a0575eba` 的 tree 等于本地 `e96e6b9`。
[CI 41581791010 / job 125738079003](https://github.com/sunpcm/EchoTalk/actions/runs/41581791010/job/125738079003)
主控已回读 frontend/backend/macOS/iOS/CI 五 jobs 全绿；真实无签名 arm64 Simulator 编译包含 SPM/Web/sync、全包 Mach-O/plist/public/static no-sign 校验。
built-not-run 的 binarySha256 为 `c4d26fc6abf0f7a1bffc8b3ffbfb2bfdf449645e3082eda1091b98ab32a7e0e7`。
这是 B 子集，不是最终 A 诊断组合；记录时最终 A 尚未发布，其最终 head CI 以 PR #119 和主控报告为准，旧 r0/r1 失败保留。
主控补充 format/B r2 Node 28/布局检查通过；本节点未自行执行，以下先前待 CI 口径以本更新为准。
App 未启动，未签名、未验设备语音或部署；以上为本次验证记录，不作实时交付状态声明。

## 工具和权限边界

- job 使用 `macos-15`，固定 Node `22.13.1`、pnpm `10.26.0`；`contents: read`，
  checkout 不保留凭据，没有 secrets、发布写权限或 `continue-on-error`。
- 2026-11-03 查询的 [GitHub 官方 macOS 15 镜像清单](https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md)
  列有 Xcode `26.0.1`（`17A400`）和 `iphonesimulator26.0`。清单是可变来源，
  不代表远端 job 已执行。入口显式选择 `/Applications/Xcode_26.0.1.app/Contents/Developer`；
  本机可使用 `/Applications/Xcode.app/Contents/Developer`，两者均必须实际报告上述版本。
  不读取系统默认 Xcode 选择，不执行 `sudo xcode-select`。
- 每次 prepare/build 都打印并核验实际 Xcode、Simulator SDK 和 pnpm 版本。
  SDK 仅接受 `26.0` 或 `26.0.1`；缺失或漂移失败关闭，不下载新 Xcode/SDK。
- 固定参数依据本机 `xcodebuild -help`：`-project`、`-scheme`、`-derivedDataPath`、
  `-clonedSourcePackagesDirPath`、`-packageCachePath`、`-disableAutomaticPackageResolution`、
  `-onlyUsePackageVersionsFromResolvedFile`、`-skipPackageUpdates`。
- prepare 校验现有 `Package.resolved` 唯一远端 pin：Capacitor `8.5.0`，revision
  `4f71d0b979f2f957326f04353eca7604ee937e1e`。pnpm 只 frozen 安装，SPM 只准备已锁版本；
  两锁、原生工程、Swift/配置输入均绑定 hash，变化即停止，不改锁解决构建问题。

## 固定编排

在仓库根目录，由具备依赖准备授权的执行方依次执行以下入口；本地仍必须经过主控
本轮固定 ev/runtime，不直接绕过共享锁或自行运行这些命令：

```bash
node --test --test-timeout=30000 apps/vite-app/scripts/ios-ci-test.mjs
node apps/vite-app/scripts/ios-ci.mjs prepare
node apps/vite-app/scripts/ios-ci.mjs
```

对应 package 脚本为 `test:ios-ci`、`ci:ios:prepare`、`ci:ios`，工作目录是 `apps/vite-app`。
依赖必须提前按现有 frozen 配方安装。CLI 只接受零参数或单个 `prepare`，不接受自定义
命令、输出位置、环境文件、签名标识或额外 Xcode 参数。

prepare 只运行工具核验和锁定 SPM 依赖准备，回执保存输入 hash。build 要求回执与当前
源码一致，再执行以下流程：

1. 通过固定 `git ls-files` 白名单读取构建输入，不读取 app/root dotenv、后端或私有
   Provider 模板。将 src、public、构建入口和配置复制到 lane 的 `.cache/ios-ci/web-input`。
   这是必要的隔离：原 app 有 tracked `.env.production`，既有 `build.mjs` 会调用 loadEnv。
   临时目录只链接本 lane 已安装的 app node_modules，不借用其他 lane 依赖。
2. 在上述干净目录真实调用既有 `build.mjs --platform ios --mode production`，保留其
   类型检查、生产配置验证和 manifest 逻辑。子进程环境采用白名单，公开 API/OIDC 为
   HTTPS `.invalid`，LiveKit 为 WSS `.invalid`；不继承 dev token、代理、NODE_OPTIONS、
   Provider Key 或签名环境。它仅用于编译，不能登录或连接真实服务。
3. 将该次产物复制到本 lane 的 `apps/vite-app/dist/ios/production`，真实调用既有
   `sync-ios.mjs --mode production`，保留 manifest 与原生 public 逐文件字节核验。
   Web 产物目录不清空。额外核验原生 config 的 webDir 和无远端 server.url。
4. 对原有 `ios/App/App.xcodeproj` 的 App scheme 执行 Release `build`；目标固定为
   `generic/platform=iOS Simulator`、`-sdk iphonesimulator`，通过 build setting
   `ARCHS=arm64` 限定架构，并显式 `ONLY_ACTIVE_ARCH=NO`，按指定 ARCHS 构建。
   generic destination 不叠加 `-arch` 命令选项，避免 destination 与 architecture 参数冲突。
   命令显式传入 `CODE_SIGNING_ALLOWED=NO`、`CODE_SIGNING_REQUIRED=NO`、空签名身份；
   不允许 provisioning 更新，不 archive、不启动或安装 App、不 boot 模拟器。
5. 验证新 `Release-iphonesimulator/App.app`：可执行文件为 arm64 64 位 Mach-O executable，
   `LC_BUILD_VERSION` 平台为 iOS Simulator；plist 为 `com.echotalk.app` / `App` / `APPL`，
   Simulator 平台、最低系统版本和麦克风说明必须存在。缺 app、Mach-O、plist、public，
   文件内容不符，或发现 `_CodeSignature` / provisioning profile，都不能成功。

独立 DerivedData、SPM checkout、SPM cache、模块缓存、TMP 和日志位于本 lane 的
`.cache/ios-ci/`。依赖准备使用单独的 `prepare-derived-data`，实际编译要求新的
`derived-data`，防止旧包冒充成功。已有 build 输出或同名日志会拒绝覆盖；重跑应由主控
先归档上一轮缓存/目标 dist，再启动新一轮，不使用 git reset/checkout 清理。

只有 `ios/App/App/public`、原生生成 config/config.xml 属于允许生成区域；其余 tracked
原生输入、`Package.swift` 和两锁若被工具改写，入口停止并保留现场供主控审查。
没有自动还原、自动提交，也不提交 public 或个人 Xcode 设置。

## 失败与证据

子进程均为数组参数、`shell:false`。SPM 准备最多 10 分钟，Web 构建 5 分钟、同步
3 分钟、Xcode 编译 20 分钟，元数据命令 30 秒；job 总限 45 分钟。超时向独立 POSIX
进程组发送 SIGKILL，等待 close；信号中断也会终止任务子进程组。

所有 stdout/stderr 的原始字节分别完整保存在 `.cache/ios-ci/logs/*.stdout.log` 和
`*.stderr.log`，默认同时回显控制台。内部 runner 的布尔参数 `echoOutput` 默认 true，
仅大流测试显式设为 false；它不影响文件写入、capture、失败传播或 timeout，也没有 CLI/env
覆盖入口。每步另存参数、真实 status/signal/error 的 JSON。超时返回 124，
信号/启动/日志写入不完整返回 70；普通子命令非零传播实际退出码。既有 build/sync CLI
会将其内部命令失败归一为 1，此时外层保留实际观察到的 CLI exit1，原始下游失败保留在日志。
文件、工具版本、锁和产物校验失败返回 78，非法参数返回 64。

只有最终验证完成才写 `logs/built-not-run.json`，包含包位置、binary/plist SHA256 和
源码输入 hash。workflow 总会尝试上传上述日志目录；上传失败不会把编译失败改成成功。
SPM 的版本约束不等于操作系统级断网，依赖准备及 runner 网络故障必须保留为实际失败。

聚合 `CI` 现在依赖 frontend、backend、macOS probe、iOS build 四路，并逐项要求
`success`。failure、skipped、cancelled 或缺失结果均不能通过。原 frontend10/backend5、
探针八个 Node 文件和既有原生策略保持；只调整探针 CI 测试中的聚合断言。

## r0 实施节点验收状态（历史）

新增 Node 回归设计包括：真实现有 build/sync Node CLI 消费，公开配置和 dotenv 隔离，
固定 Xcode 参数与输入 hash，真实子进程 exit37、双流完整保留、超时，缺文件/错误产物
拒绝，以及实际 Bash 四路聚合脚本。下游 tsc/Vite/Cap/Xcode 是合成替身；这些用例通过
也只能证明编排行为，不能冒充真实 Xcode 编译证据。

| 项目                                                       | 本轮状态                     |
| ---------------------------------------------------------- | ---------------------------- |
| 分支、HEAD、初始干净状态                                   | 实施节点真实核对符合指定基线 |
| Node 回归、格式、actionlint                                | 未执行，待主控固定入口代跑   |
| production Web build + sync                                | 未执行，待主控代跑           |
| 真实 Xcode Simulator compile / Mach-O / plist              | 未执行，待主控代跑           |
| 最终组合 frontend10/backend5、macOS Node                   | 未执行，待主控代跑           |
| 独立 Review                                                | 待主控评审                   |
| 远端 GitHub Actions                                        | 未执行，未 push              |
| App 启动、真实 IdP/Provider/LiveKit、音频、设备、签名/发布 | 未执行                       |

实施报告与本轮 ev 应仅保存在主 checkout `.review/reports/keyfree-delivery-20261103/`，
不纳入 Git。是否完成 CP-06 编译子项由主控根据真实日志裁定；本文件不修改 TODO 勾选，
也不把模拟器编译等同于真机、登录、语音或 TestFlight 验收。

## r1：Node runner 收集与大流输出修复

主控保存的 CI `41579605155` frontend job `125731085866` 日志显示，38 个测试文件、
1003 项测试通过，但本轮 Node runner 被 Vitest 自动收集，因 `Cannot bundle built-in
module "node:test"` 失败。该失败属于本轮文件命名问题，不能归咎于既有测试。
日志来源是本地报告根下 `b/ci-frontend-r0.log`；本实施节点未重新查询远端。

Node 文件改为 `scripts/ios-ci-test.mjs`，沿用现有 `build-isolation-test.mjs` 等 Node
runner 命名方式。package 脚本、workflow、测试自身命令断言和本文的执行命令同步改名。
Vitest 配置和测试树保留。

原大流用例真实产生每路 1,200,000 bytes，原 runner 会同时完整写文件并向控制台回显，
因此会向 Node 测试报告器及 CI 输出链路传递共 2.4 MB 无换行数据。该输出路径由源码可确认，
但现有日志不足以确定 iOS job `125731085637` 的异常耗时是否由 GitHub 输出接收端导致。

r1 让大流测试显式关闭 echo，并在隔离的真实 Node 子进程外以 64 KiB 输出 buffer 验证
stdout/stderr 均为空；双流文件继续逐路核对 1,200,000 bytes 和完整内容。另用小输出检查
默认 echo 仍同时写控制台和文件。原 5 秒子进程 timeout、真实超时杀进程及缺程序校验保留，
没有跳过用例或放宽超时；隔离观察进程另设 10 秒外层上限。

r1 实施节点只完成源码修改与静态核对；Node 28 项、Vitest 全树、格式检查、actionlint 均待
主控通过真实固定入口代跑。上述用例设计和远端旧日志不构成本轮通过或 CI 耗时修复的实证。

## r2：真实 Xcode destination 与架构参数冲突修复

主控保存的 CI `41580927765` iOS job `125735323179` 日志
`b/ci-ios-r1.log` 显示：Node 28 项通过，真实 SPM 锁定 prepare、production Web build
和 Capacitor sync 均成功。随后首次真实 `xcodebuild build` 在原生编译前报错
`destination implies architecture, architecture must not also be specified.`，实际 exit70。
这是 generic destination 与原 `-arch arm64` 选项冲突；这些日志不能证明 `.app` 编译通过。

r2 保留 generic iOS Simulator destination，通过 `ARCHS=arm64` 设置目标架构，移除
`-arch`；同时显式 `ONLY_ACTIVE_ARCH=NO`，使用固定 ARCHS，而不依据 active destination
缩减架构。prepare 与 build 共用该固定参数计划，工程与 SPM/依赖锁保持。

回归同时检查 prepare/build 参数工厂及 `executeIos` 实际传给 runner 的两阶段 argv：
必须没有 `-arch` / `-arch=...`，且只包含一份 `ARCHS=arm64` 和 `ONLY_ACTIVE_ARCH=NO`。
原 arm64 Mach-O executable 与 iOS Simulator load-command、plist/public 校验仍为成功硬门禁；
SDK、签名禁用、SPM 锁策略、输入 hash、timeout、退出码和既有用例均保留。

本轮实施节点仅做三文件修改和静态核对；Node/actionlint/全树由主控停写后代跑，修复后的
真实 Xcode 编译与新 CI 仍待执行。前一轮的 Node/SPM/Web/sync 成功不能替代本轮 native
产物验收，当前不声明 CI 已 green，也不将该参数错误归因于 Provider Key 或网络。

## RESTORE-20261107 收口

本段替换 delivery r0 候选追加，不改写上方从
`42c61bb08f5e234989198ef46ed7534a80c70796` 恢复的原文。上方历史 CI 与已验记录只属于
当时提交。本候选没有 push，也没有本轮远端 CI。这里的 Node 回归不能代替 native
App、Xcode、Rust 构建或设备验收。真实 Provider、IdP、LiveKit、语音、生产部署和原
Compose 整栈未验。根格式与保全回执见主控交付报告，这里不预告根格式通过。

iOS CI workflow、`ios-ci.mjs` 和 `ios-ci-test.mjs` 已按参考字节恢复。本轮 Node 编排
测试为 28 项并通过，actionlint 通过。这不是 Xcode 编译、模拟器安装、签名、Rust
构建或真机验收。上方关于旧轮 native 产物尚未验收的限制仍然有效。

## PR #128 受控 binary artifact 预取候选（2026-11-08 r1，待真实 CI）

r0 的 `-disablePackageRepositoryCache` 已被移除、由本节方案取代。
主控回读 run 42470099397：iOS Node 28 项通过，但真实 prepare 仍 exit74，
报错路径仅从 `package-cache/artifacts` 转移到 `source-packages/artifacts`。
r0 禁缓存没有修复故障，不是成功的原生验收。

主控于 2026-11-08T10:11Z 观察到普通 Cordova release 下载 URL 返回 HTTP/2 504；
随后两个公开 asset API 均无凭据下载成功，大小与 SHA256 精确匹配下表。
[精确 revision 的 Package.swift](https://github.com/ionic-team/capacitor-swift-pm/blob/4f71d0b979f2f957326f04353eca7604ee937e1e/Package.swift)
仍是 URL/checksum 契约，asset ID/大小同时来自
[8.5.0 官方 release 元数据](https://api.github.com/repos/ionic-team/capacitor-swift-pm/releases/tags/8.5.0)。
实施方只读了官方源码；上述真实 HTTP 和下载结果由主控提供。

| binaryTarget | 公开 asset ID | bytes   | SHA256                                                             |
| ------------ | ------------- | ------- | ------------------------------------------------------------------ |
| Capacitor    | 496864201     | 6605675 | `357220fe6dad73cb78bc1dc83e16e89d59c3d7dac8f9b17545a5be64bba25130` |
| Cordova      | 496864200     | 1842453 | `a3dc72b5a559948d548f0ee2926b989492acc1023a0c86a1bf85477587f83a10` |

[Swift 6.2 BinaryArtifacts 源码](https://github.com/swiftlang/swift-package-manager/blob/swift-6.2-RELEASE/Sources/Workspace/Workspace%2BBinaryArtifacts.swift)
584–602 行向固定 destination 下载，设置最多 3 次 HTTP 尝试且仅接受 200；
[HTTPClient](https://github.com/swiftlang/swift-package-manager/blob/swift-6.2-RELEASE/Sources/Basics/HTTPClient/HTTPClient.swift)
在 5xx 后重新执行相同请求；
[URLSessionHTTPClient](https://github.com/swiftlang/swift-package-manager/blob/swift-6.2-RELEASE/Sources/Basics/HTTPClient/URLSessionHTTPClient.swift)
的 download delegate 将临时文件 move 到 destination。504 响应落盘后重试产生路径冲突
是有源码依据的候选解释，并非已现场证明的唯一根因。
[SwiftPM #10138](https://github.com/swiftlang/swift-package-manager/issues/10138)
描述的跨进程缓存并发是另一种已知来源，不能仅凭相同错误认定本次也属于该原因。

prepare 先串行调用 `/usr/bin/curl`，固定公开
`https://api.github.com/repos/ionic-team/capacitor-swift-pm/releases/assets/<id>`，
设置 `Accept: application/octet-stream`、禁用 curl 配置、只允许 HTTPS 重定向、
HTTP 失败非零、连接超时 20 秒、下载超时 120 秒、子进程超时 130 秒、重试 0。
只使用既有白名单环境，不传 token/凭据，不增加动态元数据请求。
每个输出先写 lane `.cache/ios-ci/artifact-downloads/<name>.zip.partial`。
两份文件都通过 regular-file、精确大小和 SHA256 后，才以独占 hard link 发布到
`package-cache/artifacts/<原manifest URL 的 SwiftPM mangled key>`，再移除自有临时链接。
失败保留已有输出及完整 stdout/stderr/退出日志，不清全局缓存、不覆盖既有文件。
所有路径经 `safePath`；已有下载目录、已有 artifact 缓存或 symlink 都失败关闭。

随后真实执行原 `xcodebuild -resolvePackageDependencies`，允许命中上述 lane 缓存；
SwiftPM 原 manifest/checksum 校验不变。prepare 成功后和 build 启动前再次验证缓存字节。
`prepared.json` 仍只在真实 SPM 成功、源码与锁 hash 不变、缓存仍有效后写出。
Package.swift、Package.resolved、pnpm 锁、版本/SDK、隔离 checkout/DerivedData、
完整输出、无签名和原生 Mach-O/plist/public 验证均保持。

离线 Node 以小型合成字节验证 API 输出消费、坏大小/hash/缺文件、非零下载、已有/symlink
缓存拒绝、prepare 无成功回执及 build 前漂移拒绝；生产 CLI 无 URL/checksum 覆盖入口。
这些替身不证明真实下载/SPM/原生编译成功。主控独立 scratch 真实 SPM 探针在 git clone
阶段 120 秒超时，尚未进入 ZIP；属于本机网络阻断，不是本候选 prepare 通过。
最终必须验远端 prepare + compile 和原生产物；不因 API 两次下载成功而宣布 CI 已通过。
