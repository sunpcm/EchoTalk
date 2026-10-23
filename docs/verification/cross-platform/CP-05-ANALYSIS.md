# CP-05 分析轮询生命周期本地验证（A15）

产品 `0edf750` 独立 APPROVED，契约见 [分析生命周期](../../CROSS_PLATFORM_ANALYSIS_LIFECYCLE.md)。后台/离线停止读轮询并隔离旧响应，合格前台/联网事件立即读一次，整个状态、结果、知识读取期间合并重复事件。精确认证来源、session/pollVersion/effect代际保护数据、错误、槽位与timer；用户显式重试POST不因暂停读取被取消。

## 已验证

独立七项门禁：472产品测试（23文件，hook实际23项）、18构建脚本测试、Chromium/WebKit各11项、0skip。27私有探针覆盖挂起旧状态/知识请求不阻恢复、旧响应/错误/finally隔离、同步通知取消、精确身份/代际、终态与退避、StrictMode卸载重挂及零自动写请求。

ANA-01知识请求过早释放在途槽位已修复。两个有效变异分别造成重复请求及旧结果回写，探针确实失败；独立删effect活性检查由cycle递增兜底而存活，如实保留不计有效变异。恢复源码后探针通过。实施报告hook数量21为P2笔误，实际23；总数472准确。

证据仅本地 `.review/reports/workflow-analysis-a15/`：approved-source-r1.json、b/review-r1.md、reviewer-checks、private-r1.log、private-restored.log、mutations、integration-checks及completion.json。最终集成结果以completion为准，不把检查通过当独立批准。

## 边界

未运行数据库、真实IdP/LiveKit/Provider或原生OS；模拟DOM事件不等同iOS系统生命周期。后端未改。仅本地提交与隔离集成，不push/deploy。CP-05全项仍待原生、音频中断及真实设备验收。
