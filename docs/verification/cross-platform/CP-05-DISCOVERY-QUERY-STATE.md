# CP-05 活动列表查询事实（A20）

产品`9273c95`独立APPROVED，契约见[查询事实](../../CROSS_PLATFORM_DISCOVERY_QUERY_STATE.md)。未成功查询的活动列表显示“活动会话尚未查询”（role=status），不再把原生pending/inactive/注册失败或零GET误报为空；当前精确账号/revision的有效GET成功才建立查询事实。loading/error/retry/非空列表保持，身份变化清零、旧请求迟到隔离，同账号后台保留已有成功事实。原有结束成功后过滤记录语义保持，不借此改接口或重放写。

## 已验证

574产品/24文件、18构建脚本、22双浏览器（各11）、14私有探针与完整七门禁通过。独立覆盖真实factory+假App pending/inactive/注册失败、loading到成功空、失败重试、后台取消晚到空、换issuer/subject/revision、旧身份与新在途、StrictMode、Web unknown及零自动写。两个变异分别绕查询事实门禁（8失败）及接受已取消GET（1失败）；恢复原bytes后14通过。

仅四文件：ActiveSessions.tsx/.test.tsx、zh-CN.ts，usePollingAssessment.ts仅改文件头旧Web措辞。没有其他生产逻辑、依赖锁或后端变化；关闭A17原生尚未查询空态和旧注释P2。证据仅本地.review/reports/workflow-query-state-a20：approved-source-r0.json、b/review-r0.md、reviewer-checks、private-r0.log、mutations及integration-checks/completion.json；最终集成以completion为准。

## 流程与边界

首轮完整SUCCESS/exit0/unknown0/无拒权，650.89账本活动秒；最终同会话累计input190903/output46703/total237606，thinking36284和cache_read4238775按提供方口径另列，不当作Codex净节省或计费证明。本轮没有独立产品返工，精确必读清单/仅本轮报告交接在此运行避免旧路径拒权；不能据单次外推长期收益，不自动修改全局skill。

没有重新iOS sync，不复用A19 build证据冒充本轮原生产物；真实OS/Provider/IdP/Xcode/签名、Cloud接管、数据库和发布未验。只本地提交与隔离集成，不push/deploy。
