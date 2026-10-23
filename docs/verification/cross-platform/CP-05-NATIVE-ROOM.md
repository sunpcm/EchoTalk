# CP-05 原生Room挂载与音轨中断（A19）

产品`fdf3d5e`独立APPROVED，契约见[原生Room](../../CROSS_PLATFORM_NATIVE_ROOM.md)。RoomSession按session/gen隔离原生就绪等待及生命周期所有权；native pending不挂载采音Room，10秒安全退出。就绪和每次回调核验精确身份/代际，后台离线同步停止所属本地音轨再失败关闭，前台不自动重连或重放dispatch。Web unknown/null兼容，既有SDK/dispatch语义保留。

## 已验证

独立七门禁通过：565产品/24文件、18构建脚本、22双浏览器（Chromium/WebKit各11），20独立真实factory+假App探针通过。ROOM01超时缺精确身份守卫、ROOM02提交到引用绑定间隙漏同步stop、ROOM03不稳定effect依赖导致普通重渲染误停健康音轨，均经独立复现后修复。注册/状态pending、早期事件、失败、永挂10秒、旧ready/timeout/监听、换gen/issuer/subject/revision、StrictMode、原生与Web健康重渲染及回前台零自动写覆盖。

两个有效变异：绕原生ready门禁导致4失败，不稳定Room清理依赖导致3失败；恢复原始bytes后20探针再次通过。iOS development与production示例配置本地build+sync均通过，生成配置仅用既有Prettier规范化、无语义差异；未运行Xcode/签名/设备或真实服务。

证据仅本地.review/reports/workflow-native-room-a19：approved-source-r4.json、b/review-r4.md、reviewer-r3、private-r3.log、mutations、ios-checks及ios-production-config-checks、integration-checks与completion.json。最终集成门禁以completion为准。只有两个产品文件，无后端/依赖/锁变动，本轮未跑数据库。

## 流程与边界

同账本5次尝试、3421.81活动秒，两会话去重外部total1632768（input1452298/output180470，thinking136932为提供方子口径，cache_read27436846单列），不代表计费或Codex净节省。r1评审路径不在允许add-dir导致拒读；r2服务端503无容量，r3读取旧报告拒绝并EOF，均保留失败。r4原模型冷启动只补交付，8份既有检查证据hash及源码指纹前后核验，完整SUCCESS/exit0无拒权，独立门禁未省略。

新问题已记issues，不自动修改全局skill。候选：交接所引用文件需与实际允许目录逐项核对；纯补交付优先避免受污染旧上下文；资源effect回归同时验证异常清理和健康重渲染。P2保留Web初始快照临时实例与RoomContextSync多余可选回调/ref、并发渲染所有权的后续简化；无复现残留P0/P1。

当前只完成本地Room生命周期接线。系统来电/锁屏/蓝牙路由、真实iOS/macOS媒体与登录、Cloud严格接管、Linux CI和发布仍未验；不能据此勾选三端整体完成。不push/deploy。
