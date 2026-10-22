# CP-06 双浏览器本地门禁（A14）

契约见[CROSS_PLATFORM_WEBKIT_E2E.md](../../CROSS_PLATFORM_WEBKIT_E2E.md)。基线A13@b149885，契约8d6680c，产品be242b2；仅5个Playwright/Fake API/E2E/CI文件，无产品源码/依赖/锁变化。匹配webkit-2336安装已获明确授权，WebKit本地空白页启动通过；旧runtime版本未强借。

## 已验证

独立完整7项门禁通过：441产品、18构建脚本、Chromium11+WebKit11共22 E2E，0skip。每项目保留原6项分析与API测试，新增5类真实UI恢复/401边界：选择/取消前零媒体/写请求，能力失败安全提示及仅显式重试，Cloud拒绝，确认后重新查询详情拒绝已结束记录，401清理。fixture API准备与page网络计数区分，双浏览器/并行测试通过，既有analysis-failure用项目ID后缀隔离共享内存状态。

Fake API的active路由真实localhost进程5探针：鉴权401、空数组、无transcripts的活动记录、稳定倒序、结束排除。无测试控制端点/生产开关。

两有效产品行为变异分别禁用恢复Cloud门禁和已结束详情校验，在两个浏览器均由UI/禁止Token请求断言捕获。原store逐字节/整树指纹恢复后完整7项门禁再通过。最终隔离集成以本地completion.json为准；原始流、失败/回执和探针仅本地.review/reports/workflow-webkit-a14。

## 边界和遗留

本地macOS WebKit不等同Safari/WKWebView真机、原生权限、真实OIDC/Cloud/Provider。新增恢复测试在Token前失败关闭，未验证浏览器mock或物理音轨。Linux CI仅更新安装chromium webkit接线、未远端运行，不勾选CP06整体完成。后端无diff，本轮未跑数据库，不把PR96历史CI当本轮测试。P2带后缀analysis-success grammar的Fake API匹配待补，当前22用例不依赖该形状，已进入TODO。

用户中断后controller/child均退出、原流SUCCESS但无OS退出证明，r0以未知退出正式finish，保留原始事实；同账本原模型冷启动r1补完整交付，源码与r0相同，无重解析洗掉错误。共2/10次、账本1214.62秒（含宿主中断恢复等待，不等同精确计算/计费）。按两个独立会话最后累计去重：agy total337183，input272975/output64208，thinking43811/cache_read5078502单列；完整Codex额度未测，不报净省额。

本地commit/隔离集成，不push/远端merge/deploy。按最新持续推进规则直接衔接后续无需新外部依赖任务；新问题仅记录，不自动修改通用skill。
