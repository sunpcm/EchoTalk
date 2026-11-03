# iOS Simulator 无签名编译门禁

本轮为 CP-06 增加独立 `test-ios-build` job：普通 PR 在不提供发布密钥的情况下，
构建共享 React 前端、显式同步 Capacitor，然后真实编译 arm64 iOS Simulator `.app`。
只有退出成功且新包通过静态产物验证，才输出 `ios-simulator-built-not-run`。
实现与回归用例已写入；本轮实施节点没有运行测试、安装依赖或执行编译，结果待主控代跑。

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
node --test --test-timeout=30000 apps/vite-app/scripts/ios-ci.test.mjs
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
   `generic/platform=iOS Simulator`、`-sdk iphonesimulator`、`-arch arm64`。
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
`*.stderr.log`，每步另存参数、真实 status/signal/error 的 JSON。超时返回 124，
信号/启动/日志写入不完整返回 70；普通子命令非零传播实际退出码。既有 build/sync CLI
会将其内部命令失败归一为 1，此时外层保留实际观察到的 CLI exit1，原始下游失败保留在日志。
文件、工具版本、锁和产物校验失败返回 78，非法参数返回 64。

只有最终验证完成才写 `logs/built-not-run.json`，包含包位置、binary/plist SHA256 和
源码输入 hash。workflow 总会尝试上传上述日志目录；上传失败不会把编译失败改成成功。
SPM 的版本约束不等于操作系统级断网，依赖准备及 runner 网络故障必须保留为实际失败。

聚合 `CI` 现在依赖 frontend、backend、macOS probe、iOS build 四路，并逐项要求
`success`。failure、skipped、cancelled 或缺失结果均不能通过。原 frontend10/backend5、
探针八个 Node 文件和既有原生策略保持；只调整探针 CI 测试中的聚合断言。

## 本轮验收状态

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
