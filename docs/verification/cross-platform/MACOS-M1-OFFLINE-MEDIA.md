# macOS M1 离线媒体接线

2026-11-02，独立探针 `tools/macos-m1-native-probe`，从 `249394aab27182f72058527a22b2d922a6305021` 的认证探针扩展最小媒体链路。这是 M1 的离线接线增量，不代表完整 M1 通过，也不进入正式 M2。

## 本轮已接线

- Native 管理 Auth 与 Media，注册四个固定媒体 IPC。全部命令使用真实窗口/本地 URL 公共 guard；空参数严格，dispatch 只接纳一个正安全整数 generation。Rust 测试直接调用生产 guard 与工作槽，不以源码文本检查替代行为验证。
- Native 固定 HTTPS API 顺序、disabled 模式能力门禁、内存身份租约、代际取消、迟到 create 清理、未知结果阻断、旧 principal/旧 ID end、匹配 401 和有限 HTTP 响应。Auth begin/cancel 先同步作废媒体，不等待 HTTP 清理。
- 主页面实际装配 Auth 订阅、控制器、LiveKit adapter 与媒体 UI，before-invoke 同步未认证。迟到 Auth 响应隔离，同会话订阅稳定；显式用户操作才请求麦克风，连接/等待/远端音频/播放受阻/停止待确认分别显示。
- 真实 SDK 2.17.2 来自 lane 独立 node_modules，自托管且检查精确字节、许可证、加载 SRI 和运行时版本/API；无 CDN、fake/tone/replay fallback。Room 禁止自动重连，播放重试保持点击手势。
- 新增麦克风用途声明，旧静态 scheme 不变。ACL 精确七命令，CSP 仅 self 脚本及明确媒体原点。生成 SDK 和精确权限、两锁及最终编译输入都进入 hash。
- close 的唯一 webview 销毁后请求 native 进程退出，JS pagehide 同步释放资源；没有托盘、隐藏后台通话或完整 M3 睡眠框架。

## 默认禁用与结束收据

`media-config.json` 默认为 api_origin=null/media_origins=[]。未配置时显示配置缺失，禁止开始，不采音，不伪装已连接或远端清理未知。启用必须同步配置规范 HTTPS API、WSS origin 白名单和 CSP；只能用于隔离 disabled 租约环境。

| 收据                        | 解释与再次操作                                                       |
| --------------------------- | -------------------------------------------------------------------- |
| unconfigured / not_needed   | 编译期配置禁用；不是结束失败                                         |
| stopping / pending          | 原 worker 仍在收尾；显式串行核实，不乐观成功、不无界轮询             |
| stopped / ended，error=null | 正常取消且已确认结束，可再次显式开始                                 |
| failed / ended，安全 error  | 实际操作失败但已确认清理；保留失败提示，可再次显式开始               |
| blocked / unknown           | 禁止新开；有旧 ID 才可显式重试同一身份的 end，未知 create 需人工核查 |

OIDC access token 永不进 JS；JS 仅短时持有房间 token。网络/后台/授权中断先停本地轨并清 token，再有界等待 native。终态安全错误不展示 HTTP/SDK 原文或凭据。仅重启不能证明未知的远端 create 已不存在。

## 验证与证据等级

Node 回归覆盖既有构建/Auth 语义、合成真实协调器/SDK 接口、生产主入口装配及安全副作用；其中还离线执行精确 UMD 以核实导出 API/version，没有构造真实 Room、联网或采音。fixture 仅在受控 TMPDIR 内创建独占目录，原 5 秒 Node 文件超时保留，新增构建测试独立成树。

固定 assets 入口已在实际 lane 离线成功执行；所有源码与锁由最终本地 manifest 绑定。Rustfmt 已执行；新源码 Rust 测试与 arm64 打包结果以本轮独立回执为准，真实 App 与设备结论单列。Node 结果以该次最终字节报告/证据为准，不将过渡计数长期当作当前事实。

完整命令、SDK 字节 pin、生成输出拒绝规则和入口约束见 [探针 README](../../../tools/macos-m1-native-probe/README.md)。本地交付报告/原始 ev/哈希仅保存在主 checkout `.review/`，不纳入 Git。历史认证实机结果仅见 [AUTH 记录](./MACOS-M1-NATIVE-AUTH.md)，不代替本次新包验证。

## 回执与后续设备验收

- 真实 Rust/arm64 入口为 `scripts/auth-test.mjs` 与 `scripts/build.mjs`；结果以本轮独立回执为准，Node fixture 的成功不是原生编译成功。
- 当前新增 IPC/ACL/CSP 与真实 WKWebView、TCC 允许/拒绝/撤销、停止后系统采音指示、close/quit 进程退出；至少一副耳机、断网与休眠。
- 明确授权并准备专用 IdP/API/LiveKit/Provider/Agent 环境后，分别记录 API、WSS、ICE/TURN、采音、播放和双向真实有声；至少 5 分钟 5 轮。
- 本轮未恢复服务、操作证书/安装 App、录音或访问真实 Provider；无 Key 不通过真实媒体门禁。
- 共享业务 Vitest、Playwright、backend pytest 与 frontend10/backend5 未执行，原门禁、测试库和覆盖率合同不变。

不承诺 macOS 14 兼容、Intel/universal、分发/签名、Cloud 单端占用、完整正式客户端或后台通话。
