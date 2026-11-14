# CP-05 原生Room挂载与音轨中断（A19）

产品`fdf3d5e`独立APPROVED，契约见[原生Room](../../CROSS_PLATFORM_NATIVE_ROOM.md)。RoomSession按session/gen隔离原生就绪等待及生命周期所有权；native pending不挂载采音Room，10秒安全退出。就绪和每次回调核验精确身份/代际，后台离线同步停止所属本地音轨再失败关闭，前台不自动重连或重放dispatch。Web unknown/null兼容，既有SDK/dispatch语义保留。

## 已验证

独立七门禁通过：565产品/24文件、18构建脚本、22双浏览器（Chromium/WebKit各11），20独立真实factory+假App探针通过。ROOM01超时缺精确身份守卫、ROOM02提交到引用绑定间隙漏同步stop、ROOM03不稳定effect依赖导致普通重渲染误停健康音轨，均经独立复现后修复。注册/状态pending、早期事件、失败、永挂10秒、旧ready/timeout/监听、换gen/issuer/subject/revision、StrictMode、原生与Web健康重渲染及回前台零自动写覆盖。

两个有效变异：绕原生ready门禁导致4失败，不稳定Room清理依赖导致3失败；恢复原始bytes后20探针再次通过。iOS development与production示例配置本地build+sync均通过，生成配置仅用既有Prettier规范化、无语义差异；未运行Xcode/签名/设备或真实服务。

证据仅本地.review/reports/workflow-native-room-a19：approved-source-r4.json、b/review-r4.md、reviewer-r3、private-r3.log、mutations、ios-checks及ios-production-config-checks、integration-checks与completion.json。最终集成门禁以completion为准。只有两个产品文件，无后端/依赖/锁变动，本轮未跑数据库。

## 流程与边界

同账本5次尝试、3421.81活动秒，两会话去重外部total1632768（input1452298/output180470，thinking136932为提供方子口径，cache_read27436846单列），不代表计费或Codex净节省。r1评审路径不在允许add-dir导致拒读；r2服务端503无容量，r3读取旧报告拒绝并EOF，均保留失败。r4原模型冷启动只补交付，8份既有检查证据hash及源码指纹前后核验，完整SUCCESS/exit0无拒权，独立门禁未省略。

新问题已记issues，不自动修改全局skill。候选：交接所引用文件需与实际允许目录逐项核对；纯补交付优先避免受污染旧上下文；资源effect回归同时验证异常清理和健康重渲染。以下 P2 保留项、当时无残留 P0/P1 的结论以及“不push/deploy”均只绑定旧 A19 交付快照 `fdf3d5e`，不适用于当前 A19 P2。

该旧 A19 快照只完成本地Room生命周期接线。系统来电/锁屏/蓝牙路由、真实iOS/macOS媒体与登录、Cloud严格接管、Linux CI和发布仍未验；不能据此勾选三端整体完成。A19 P2 当前任务分支的提交与推送边界见下节，不继承旧快照的“不push/deploy”语句。

## A19 P2 初始 Web 快照与提交后所有权（FINAL_READY）

A19 P2 在既有 A19 契约上只做两项减法。第一，Room 初始 Web 门禁改用无订阅纯读取
`getWebLifecycleSnapshot`：每次实际 render 读取当前 visibility/online，不创建临时 adapter、
不注册监听，也不冻结首次结果；hidden/offline 继续失败关闭，unknown/null 仍兼容。第二，
`RoomContextSync` 删除无人消费的可选 `onRoom` 与可选 `roomRef`，仅在已提交的 layout effect 中
发布必需引用；render 阶段不再写共享引用。Room 替换或卸载的 cleanup 仍同步停止旧 Room 本地
音轨，并只在其仍属于该引用时清空所有权；事件 callback 同步停轨与 ActiveConversation 既有清理
路径保持。

新增 A19P2 回归覆盖：未订阅纯读取持续反映 visible、hidden/offline、unknown/null 且零监听副作用；
Room 后续实际 render 读到 hidden 时仍 fail closed；并发 render 可生成新 SDK Room 但未 commit，
生命周期 callback 必须停止仍在页面上的旧 Room 且不得停止未提交 Room；SDK Room commit 替换后
旧 Room 按既有两条 cleanup 链清理，后续事件只让当前新 Room 同步 stop；StrictMode 首次 settle
后的合法清理作为 epoch 基线，健康重渲染不新增 stop，真实 callback 返回前恰新增一次。

首轮 TESTS RED 为 `2 passed / 3 failed`；修正测试夹具后唯一产品 RED 是并发所有权场景，私有 load
反事实移除 render 写 `roomRef` 后通过，恢复后再次失败。该 RCA 只绑定 A19P2 新场景，不反推 A82
旧失败根因。实现后首轮 GREEN 的唯一失败是既有 CON-04 订阅后快照夹具；R1 只迁移其非断言
arrange setup，并让纯 getter 与 adapter 共享同一快照读取事实，四条原 `expect` 与产品安全门禁
保持不变。

R1 后 13 项门禁组合均 `exit 0`，完整 Vitest 为 `1211 passed / 49 files / 0 skip`，三项有效
私有行为变异均被对应断言杀死；完整数字集中在
[PROJECT_STATUS 的 A19 P2 小节](../../PROJECT_STATUS.md#a19-p2-room-快照与引用所有权final_ready)。
A19P2 只进入当前任务分支的最终提交与推送；最终文档 format、独立 Review、提交和推送以主控同卡
回执为准，用户 Review 待，不开 PR、不合并、不部署。真实设备、真实 LiveKit/Provider/IdP、远端
新 CI、部署和生产链路仍未验收。
