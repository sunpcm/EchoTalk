# CP-05 DocTalk设置页响应式与触控（A25）

产品`6604516`独立APPROVED，契约见[设置页布局](../../CROSS_PLATFORM_DOC_LAYOUT.md)。小屏返回在标题上方，标题/副标题使用可用宽度；桌面保持居中布局，返回/开始/预设/既有上传区域至少44x44 CSSpx。仅两个组件JSX和新增E2E，两个return前字节与A24完整读取文件哈希保持，业务行为和依赖不变。

## 基线与验证

有效基线双浏览器各4观察：普通返回36高、预设约26高；320/200%时返回覆盖真实标题文字，667横屏/960桌面未发生文字遮挡，未发现document横向溢出。初测h1全宽块框与返回相交产生假阳性，保留baseline.log，改为文字Range的baseline-range.log作为事实。

首轮DOC25-01 P1：固定rem侧边留白把256px可用空间挤成32px标题框，font60/scrollWidth59，虽然全页不overflow，标题自身溢出、副标题长距离单字列。独立截图与补2元素检查复现，现小屏重排恢复可用宽度，产品默认新增回归。原20通过+2失败未算全绿。

独立七门禁：606产品/25文件、18构建脚本、82默认E2E（各41，旧62全部保留，无skip）。22独立真实双浏览器覆盖4视口×2字号与resize、文本Range/元素自身溢出、44px触控、纵向滚动、草稿/预设/键盘编辑与零隐式写。WebKit完整导航按当前macOS偏好用Alt+Tab，不冒充真实设备或OS键盘实测。WebKit320/200%截图已人工检视，文字恢复正常宽度。

两有效变异：去预设触控下限使按钮高38，双浏览器失败；恢复窄屏固定留白使标题client32/scroll59，双浏览器失败。恢复原字节/整树指纹后22再次通过。证据仅本地.review/reports/workflow-doc-layout-a25：behavior-baseline.json、source-r0.json、approved-source-r1.json、b/review-r1.md、reviewer-r1、private-r1.log/截图、mutation-results.json、private-final.log。最终隔离集成见integration-checks/completion.json。

## 工作流与未验边界

中断恢复先查无遗留controller、测试端口已释放和工作树一致，未重复派发。首轮agy误读非必需CLI自身配置被既有deny阻断，旧blocked_permission/raw保留，未增权限或换工具绕读；正式reconcile后同Flash冷启动r1完整SUCCESS，无拒权/未知流。启动必读声明11/12对齐，仅证明声明而非有效权限覆盖。

两次1064.680账本活动秒，两独立会话末input130704+177560=308264/output43325+40744=84069/total174029+218304=392333，thinking69318/cache3477103单列，不额外加total，不当作会员计费或Codex净省额。精确Codex任务用量未提取。

新问题留本地issues.md：块框交叠假阳性、全页无溢出漏内部窄柱、摘要任务名不能区分快速三项与完整七项、CLI配置非必需拒读，以及对已验证拒权事件早停的候选。暂不改全局skill。

真实OS键盘升起、非零safe-area、iOS设备/原生系统文件选择器、Provider/数据库/Xcode/签名发布未验。整体手机/桌面及三端验收仍未全部完成，不push/deploy，不能据隔离集成推定当前main已包含。
