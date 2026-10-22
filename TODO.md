# EchoTalk TODO

> 当前唯一待办清单。完成事项应直接勾选；新增待办需写明验收条件，避免继续散落到阶段文档和源码注释中。

## MVP 产品化修复（RF-01～RF-12）

> 权威边界与验收细则见
> [MVP 技术债修复与重构方案](./docs/MVP_REFACTORING_REMEDIATION_PLAN.md)。
> 执行顺序固定为“可靠性修复 → 架构减法 → 内部重构 → 受控升级”；只有对应自动化、
> 迁移、运行时和外部边界证据齐全后才能勾选。

### 执行基线

- 基线：`origin/main@30f51f3175de20bc827ebdf29789ad934096133d`
- 分支：`codex/mvp-remediation`
- Worktree：
  `/Users/sunpcm/Documents/Codex/2026-09-08/new-chat/work/EchoTalk-mvp-remediation`
- 初始前端基线：冻结锁安装成功；格式检查失败；Lint/Typecheck 通过但复用了旧 worktree
  Turbo 缓存；Vitest 71 项通过但包含 6 个 “no tests” 伪任务；Playwright 仅有 1 个
  `expect(true)` 占位测试。
- 初始后端基线：Pytest 113 项通过并有 8 个 warning；Black 有 9 个文件待格式化；
  Flake8 报告 38 项；当前依赖未锁定且一次安装解析出 176 个包。
- 初始运行时基线：`docker compose config --quiet` 因干净检出缺少强制 `.env`
  失败；尚无 PostgreSQL 空库迁移门禁。

### Phase 0：可信质量基线

- [ ] **RF-04 CI 真实性**：真实 Web + Fake API E2E 覆盖健康检查、创建/结束会话、
      分析成功、分析失败与失败后退出；统一 Ruff；PostgreSQL 空库迁移与合理覆盖率进入
      CI；聚合 `CI` 仅在必要任务全部成功后通过。

### Phase 1：分析可靠性

- [x] **RF-01 持久化分析状态机**：PostgreSQL Job 支持原子领取、幂等、超时恢复、
      有限重试和人工重试；状态 API 与前端明确展示四种状态；任意状态均可返回主页；
      重复消费、Worker 崩溃和最终失败均有测试。

### Phase 2：模拟结果隔离

- [x] **RF-02 评估来源可信**：评估带来源、Provider、模型版本、Synthetic 与置信度；
      Synthetic 不更新真实知识状态；生产缺 Provider 时返回 `unsupported`；API、迁移、
      前端和测试同步。

### Phase 3：鉴权与密钥生命周期

- [x] **RF-03 真实鉴权和版本化密钥**：采用单一明确的 AuthProvider 方案；移除生产
      Mock 用户和固定 Token；资源归属、过期/伪造 Token、认证密钥与凭据加密密钥分离、
      旧密文读取/重加密、Provider 错误分类和日志脱敏均有测试。

### Phase 4：架构减法

- [ ] **RF-05 精简基础设施**：确认调用证据后删除无价值的 Redis/Celery/周报骨架和
      Chroma/重型 ML 依赖；确定性课程推荐保持业务用例，并记录镜像体积与冷启动对比。
- [ ] **RF-06 清理前端模板**：引用审计后删除无调用者的 Webpack、UI 模板、Changesets、
      Plop 和一次性脚本；根包元数据、workspace、Turbo、Docker 和 Capacitor 保持一致。

### Phase 5：依赖、迁移和运行时统一

- [ ] **RF-07 可复现依赖**：后端成为真实 uv 项目并提交完整 `uv.lock`；API、Agent、
      Dev 依赖分组；CI/Docker frozen 安装；Python 3.12、Node 22 与固定 pnpm 版本统一。
- [ ] **RF-08 迁移与时间语义**：移除 lifespan Mock 播种；参考数据显式且幂等；
      timezone-aware UTC、必要索引和有界分页完成；空库及现有数据库副本迁移均通过。

### Phase 6：内部边界

- [ ] **RF-09 LiveKit Agent 拆分**：Orchestrator、CredentialResolver、ProviderRegistry、
      TranscriptSink 和 ErrorMapper 边界落地；无 `sys.path` 注入、导入时 dotenv、敏感
      环境变量临时删除或 SDK 私有属性访问；后台写入可排空、可观测、可重试。
- [ ] **RF-10 Provider Registry**：能力、模型、凭据、验证、超时、重试与错误映射统一；
      非敏感设置不解密旧凭据；多 Provider 验证并行且有总超时。
- [ ] **RF-11 前端 API 与状态模型**：OpenAPI 生成类型/客户端；Transport 统一认证、
      超时、取消、Header 合并和错误解析；会话使用判别联合/Reducer；大组件按行为拆分。

### Phase 7：受控升级

- [ ] **RF-12 独立 SDK 升级**：仅在 RF-01、RF-04、RF-07、RF-09 完成后，分别升级并
      提交 LiveKit Agents、OpenAI SDK、Vite、Vitest 和 TypeScript；保留回滚边界；真实
      语音、Provider 与 iOS 真机等外部验证在获得凭据/设备后补证，未验证前不得完成。

## P0 — 安全边界

- [x] 独立 Vite 7.x 安全补丁（[#92](https://github.com/sunpcm/EchoTalk/pull/92)）：
      声明和所有锁定实例统一为 7.3.7，冻结安装和 CI 通过；不代表 RF-12 整体完成。

- [x] 后端用真实 JWT 校验替换 `get_current_user` Mock；验收：无效或过期 Token 返回 401。
- [x] 前端从 Auth 模块获取 Bearer Token，移除固定的 `mock-token`；验收：登录态变化能正确影响 API 请求。

## P1 — 功能完整性

周度学习报告目前仅返回 `status: "skeleton"`，以下维度应分别实现并验证：

- [ ] 统计最近 7 天练习时长与会话次数。
- [ ] 计算各技能 `p_mastery` 环比趋势。
- [ ] 按会话聚合发音准确率趋势。
- [ ] 统计语法错误 Top 3 并生成改善建议。
- [ ] 基于 RAG/Krashen i+1 生成下周学习重点。
- [ ] 汇总平均焦虑指数与语速趋势。
- [ ] 接入正式 i18n 框架，用语言包替换当前 TypeScript 字符串对象。
- [ ] 实现数字人前端与音视频同步，并补充独立设计和验收标准。
- [ ] 在完整后端与 LiveKit 环境补验 Session、评估页面及深色主题可读性。

## P2 — 质量与维护

- [x] 每日进度与技能掌握度进度条提供可访问名称、范围和值（[#90](https://github.com/sunpcm/EchoTalk/pull/90)）；
      回归覆盖每日 0/5/20/25 完成量，超目标时数值封顶、文本保留实际总量。

- [ ] 清点主题 token：保留 Webpack 正在使用的 `brand-*`，处理未使用的 `scrollbar-thumb`、`header-bg`。
- [x] 将 Vite 入口的 `<html lang="en">` 改为 `zh-CN`。
- [ ] 将主题保存到后端 `user_settings.theme`，支持跨设备水合。
- [ ] 统一主题按钮边框宽度，消除选中时 1px 布局抖动。
- [ ] 为颜色过渡和抽屉动画支持 `prefers-reduced-motion`。
- [ ] 按主要容器补齐主题颜色过渡，避免子元素瞬间切色。
- [ ] 移除 LiveKit 消息访问处的 SDK 类型忽略，改用类型收窄或兼容适配层。

## 三端交付计划（Web / macOS / iOS）

> 制定日期：2026-10-21；初始分析基线：`main@66a64fe`；执行准备基线：远端 `main@a8f0895`。
> 以用户已确认可运行的 iOS 为起点；完整闭环、异常恢复和 Release 分发分别记录验收结果。
> 架构、默认策略与证据规范见 [跨平台架构与交付门禁](./docs/CROSS_PLATFORM_ARCHITECTURE.md)。
> 本节替代原 Phase 9 移动端计划；任务完成状态只在此维护。

### 范围与推进规则

- 本轮交付 Web、iOS 和 macOS；Android、Windows、实时跨设备语音接力、离线 AI 不在本轮范围。
- 共用 React 页面、API 和后端；保留 Capacitor iOS，macOS 先验证再确定包装方案。
- 首版默认以前台练习为目标；中断时停止或暂停采音，回前台核对状态，并由用户确认恢复采音。
- 历史、报告和设置跨端同步；同一账号同时只允许一端通话，另一端须显式接管，不静默踢出已有端。
- CP 编号表示验收门禁。CP-00 通过后，CP-01、CP-02 后端与 CP-03 最小验证可并行；接口稳定后再并行开展认证、会话恢复和独立 UI 适配，最终串行集成验收。
- 现有 RF 任务保持独立状态；跨端工作不顺带升级 SDK、清理基础设施或重写全部前端状态。
- 真实 IdP、设备或签名条件缺失时，继续无依赖工作；相关外部验收保留未完成，不以 Mock 通过替代。

### CP-00：基线与验收准备

- [x] 记录当前前后端检查结果、iOS 运行方式和设备/OS；验收：区分既有失败、本轮回归、模拟器与真机证据。
- [x] 建立三端验收矩阵和证据目录；验收：覆盖登录、语音、结束、分析、报告、设置、DocTalk 与异常恢复，记录结果及复现步骤，不记录凭据或用户原始音频。
- [x] 核实测试数据库隔离；验收：后端集成测试仅连接明确的独立测试库，设备测试使用专用测试账号。

CP-00 自动化准备已于 2026-10-21 独立评审通过；已补录 iPhone 17 Pro / iOS 26.0 模拟器安装证据；真机、真实链路及发布验收仍未通过。

### CP-01：平台边界与配置（首个代码阶段）

- [ ] 在 `apps/vite-app/src/platform/` 建立薄适配接口；验收：环境、认证、生命周期能力具有明确边界，Web 默认实现可运行，尚未支持的能力显式返回不可用。
- [x] Web生命周期事件薄适配器：无副作用工厂、订阅清理/恢复快照、SSR降级与原生能力不可用经独立验收；未接业务与原生事件，见[验证](./docs/verification/cross-platform/CP-01-WEB-LIFECYCLE.md)。
- [x] 集中 API/LiveKit 地址选择，修正 `/api/api`，生产原生配置限制 HTTPS/WSS；验收：Origin 与含 `/api` 地址、尾斜杠、非法配置、Web 同源、原生直连/代理均有回归覆盖。
- [x] 增加可复现的 iOS build + sync 命令，隔离平台/环境产物并校验 Turbo 缓存输入；验收：Web/iOS 连续切换构建不会复用错误配置，Release 不含开发 Token 或开发 API 地址。

- [x] Dashboard生命周期只读发现接线：恢复前台/网络时刷新，后台离线门禁、旧请求与账号隔离通过本地独立验收；不代表恢复通话，见[验证](./docs/verification/cross-platform/CP-01-LIFECYCLE-DISCOVERY.md)。

### CP-02：会话可靠性与恢复契约

- [x] 结束接口幂等，客户端结束时立即停止采音；验收：响应丢失后重试、重复点击和并发结束均返回一致最终状态，不重复创建分析任务。
- [x] 创建会话支持请求幂等标识；验收：同一用户同一请求重试返回原会话，不同请求正常创建，复用标识但请求体不同被拒绝。
- [x] 共享 Dashboard 只读活动会话发现增量；验收：加载/空/列表/失败重试、精确账号与代际隔离及未知模式回退通过本地独立评审。仅发现记录，不代表房间在线或可恢复，见 [发现验证](./docs/verification/cross-platform/CP-02-DISCOVERY.md)。
- [x] 客户端通话能力发现与开始门禁；验收：严格协议/no-store、失败及Cloud不可用时不创建会话，认证失效释放旧启动且可显式重试，本地回归通过；尚未支持Cloud占用客户端/恢复/接管。
- [x] 客户端占用API原语：claim/heartbeat/release及token/dispatch可选owner头；精确schema/关联校验、默认不接管和不重放经本地独立验收。仅API层，Cloud开始门禁保留，见[验证](./docs/verification/cross-platform/CP-02-LEASE-API.md)。
- [x] 独立客户端占用控制器：显式claim、心跳/到期watchdog、同tuple释放重试、代际/身份隔离与清理通过本地独立验收；未接UI/媒体/Cloud门禁，见[验证](./docs/verification/cross-platform/CP-02-LEASE-CONTROLLER.md)。
- [x] Dashboard显式结束已发现的活动记录：确认/取消、失败同ID重试、认证意图代际与在途保护通过本地独立验收；不表示其他端媒体停止，见[验证](./docs/verification/cross-platform/CP-02-DISCOVERY-END.md)。
- [x] ActiveSessions文件头已随显式恢复开发同步更新为发现/结束/恢复，关闭P2过期注释。
- [x] disabled模式已有会话显式恢复：确认后重新核验身份/能力/详情/Token且零create，store及UI取消/代际隔离经本地独立验收，见[验证](./docs/verification/cross-platform/CP-02-EXPLICIT-RECOVERY.md)。
- [ ] 完善Cloud占用下恢复入口与真实媒体/三端恢复验收；验收：刷新或重启后可选择恢复/结束，已结束会话不能重连，不持久化 LiveKit Token。
- [ ] 明确并落实单设备会话占用、过期释放及显式接管；验收：双端竞争不造成隐式踢人，旧设备失去占用后不能自动抢回，会话中断后的遗留状态有回收路径。
- [x] Agent调度HTTP失败本地闭环：当前失败停止本地音轨、清Token/卸载房间并展示安全提示；单次调度、来源/代际隔离及失败后显式操作经独立验收，见[验证](./docs/verification/cross-platform/CP-02-AGENT-DISPATCH.md)。真实媒体、连接离线及Token过期恢复仍待下项。
- [x] 连接失败与Web中断本地闭环：SDK错误/断开、后台离线同步停止音轨，旧回调与监听隔离、无自动重连和显式新操作经独立验收，见[验证](./docs/verification/cross-platform/CP-02-CONNECTION-FAILURE.md)。
- [ ] 完成真实网络离线、Token失效与原生系统中断验收；验收：API 502、离线、Token 失效不再只写 console 或长期显示假在线。

Cloud 占用后端协议已于 2026-10-21 通过本地独立评审（`d76da01`）：专用 PostgreSQL、模拟媒体、失败回滚与迁移往返通过。恢复/接管 UI、真实 Cloud 撤销及三端旧 SDK 重连尚未验收，`CALL_LEASE_MODE` 默认保持 `disabled`。

### CP-03：macOS 最小验证与方案定案

- [ ] 比较 Web/可安装 Web、Apple Silicon 上运行 iOS App、独立 Tauri macOS；验收：记录目标芯片/OS、发布渠道、桌面能力需求和维护取舍。
- [ ] 对候选方案做最小语音与授权回跳验证；验收：麦克风授权、双向音频、耳机切换、断网重连、休眠唤醒、文件选择和系统认证回跳有设备证据。
- [ ] 形成 macOS 方案决策；验收：若需独立客户端且 Tauri 验证通过，再维护正式桌面工程；验证失败则分析具体失败点再评估替代方案，不无条件迁移 iOS 或引入 Electron。

### CP-04：三端真实登录与凭据生命周期

- [x] 共享客户端本地认证生命周期：账号清理、迟到响应/401隔离、StrictMode在途callback单次交换和来源归属通过独立评审及隔离集成；详见 [CP-04 本地验证规范](./docs/verification/cross-platform/CP-04.md)。仅此本地增量完成，以下真实三端验收项仍待完成。

- [ ] 保留 Web OIDC Code + PKCE，接入原生系统认证会话及冷/热启动回跳；验收：state/nonce/PKCE、取消、重复回调、错误回调和退出均正确处理。
- [ ] 原生长期凭据使用 Keychain，补齐续期、撤销及 401 恢复；验收：并发请求只触发一次续期，失败后受控退出，不盲目重放创建/结束等写请求，不在 Web Storage 保存原生长期凭据。
- [ ] 配置各客户端的 IdP 回调白名单与 API audience；验收：三端同一账号映射同一本地用户；核实 IdP 是否使用 pairwise subject，禁止靠 email 自动合并账号。
- [ ] 登录失效/退出时停止音频并清理用户相关内存及本地恢复提示；验收：切换账号不显示上一账号的会话、设置或报告。

### CP-05：生命周期与响应式体验

- [ ] Web visibility/online 与原生前后台/唤醒统一进入恢复流程；验收：重新校验身份、服务端状态和 LiveKit 连接，回前台立即刷新分析，避免并行轮询或重复 dispatch。
- [ ] 完善 iOS 音频中断与路由变化；验收：来电、锁屏、蓝牙插拔后无假在线或意外采音，恢复遵守用户选择；后台持续通话另立后续范围。
- [ ] 完善手机动态视口、键盘避让、safe area 与触控目标；验收：窄屏/横屏/大字号无关键按钮遮挡，设置面板按可用空间适配。
- [ ] 完善桌面窗口缩放、宽屏布局、键盘导航和关闭会话行为；验收：缩小窗口可用，快捷键不抢输入焦点，关闭窗口不遗留采音。
- [ ] 真机验收 DocTalk 文件导入；验收：`.txt/.md` 可选、取消不丢草稿，读取失败、空文件、编码问题和超限有提示；仅在 Web 文件接口不满足时增加原生插件。

### CP-06：自动化与真实链路回归

- [x] 本地双浏览器门禁：保留完整质量检查，Chromium/WebKit各11项，覆盖分析/恢复/401边界、0skip；CI安装接线已更新，见[验证](./docs/verification/cross-platform/CP-06-WEBKIT.md)。
- [ ] 取得Linux CI双浏览器实际通过证据并完成真实链路回归；验收：Chromium/WebKit 均覆盖登录边界、会话恢复和分析状态；Mock 测试与真实 Provider 验收分别报告。
- [ ] 接入 macOS runner 的 iOS 构建和所选 macOS 方案构建；验收：普通 PR 可无发布密钥验证编译，签名仅在受控发布任务使用。
- [ ] 完成三端真实链路矩阵；验收：真实 IdP → 创建 → LiveKit/Agent 双向语音 → 结束 → 分析 → 报告，并验证拒绝权限、弱网、中断、重启、双端冲突和账号切换。
- [ ] 补充按版本/平台关联的诊断信息；验收：可定位 API、LiveKit、Agent 错误，不采集 Token、密钥或默认上传文档/对话正文。

### CP-07：发布候选与交付

- [ ] Web 验证真实 HTTPS/WSS、API 兼容和回滚；验收：保留上一可用版本，新旧客户端均通过关键接口验证。
- [ ] iOS 完成 Release Archive、签名、权限/隐私材料与 TestFlight 验收；验收：使用生产构建配置完成完整闭环。
- [ ] macOS 按 CP-03 决策交付；验收：独立包完成签名及渠道所需公证/审核、全新安装验证；Web 方案则验证目标浏览器及安装入口。
- [ ] 记录各端版本、最低支持 OS、已知限制与回滚步骤；验收：发布候选通过不等于已对外发布，部署、上传和商店提交由用户确认发布边界后执行。

### 后续候选（不阻断本轮）

- [ ] Fake API严格解析带项目后缀的analysis-success grammar路径并补回归；当前双浏览器门禁不依赖该路径，A14 P2保留。

- [ ] Android / Windows：产品确认进入范围后独立做平台最小验证。
- [ ] 后台持续语音、实时跨设备接力、桌面托盘/全局快捷键与自动更新：有明确需求后单独设计和验收。

## 维护规则

- `README.md` 只记录已验证现状，不承载待办。
- `docs/PHASE_*_TECH_STACK.md` 记录已实现架构，`docs/PHASE_*_MANUAL_TEST.md` 记录验收步骤。
- 已完成任务应同步删除对应源码 `TODO` 注释；重大取舍写入相关技术文档。
