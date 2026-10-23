# CP-05 DocTalk本地导入可靠性（A24）

产品`ce0e0b4`独立APPROVED，契约见[本地导入](../../CROSS_PLATFORM_DOC_IMPORT.md)。仅DocUploadCard、组件测试、五条i18n错误与新增doc-import E2E四文件；父setup/API/store/auth/platform/依赖不变。接受既有.txt/.md/.markdown（大小写不敏感），支持严格UTF-8与首个BOM；失败保留草稿并给安全错误，同文件重选/取消/再次导入可用。保持50,000个既有JavaScript长度单位，上限200,003字节仅提前拒绝明显超大文件，不改变粘贴或后端语义。

## 验收与修复

基线双浏览器4观察确认不支持文件与空文件都会覆盖现有稿；观察用例通过只证明旧行为被复现，不是目标验收。源码/日志hash见baseline-evidence.json。

独立七门禁606产品/25文件、18构建脚本、62默认E2E（各31，旧60保留，无skip）。18独立真实浏览器检查六类错误保稿与有效导入恢复、同文件重选/编辑、DOM取消、50k中文长度和双FEFF正文；11独立时序明确执行捕获旧回调，覆盖新选择/编辑/新错误、父layout阶段已提交value变化/条件卸载、同步read/abort异常、健康重渲染和StrictMode可用。

首轮DOC24-01 P1：使用passive effect失效留下提交/卸载到清理间隙，父layout投递的旧load仍onChange，现layout阶段失效关闭。DOC24-02 P2：原迟到测试在回调置null后optional call，没真正执行旧回调；现先捕获、断言function、失效后直接调用。DOC24-03 P2：TextDecoder已去BOM又手工slice导致正文FEFF丢失，现只处理一次，真实两浏览器验证正文保留。

两个有效变异：layout退回passive导致2个提交/卸载反例失败；删除load token守卫导致捕获旧load的覆盖保护失败。恢复原字节和整树指纹后11时序+18浏览器再次全绿。证据仅本地.review/reports/workflow-doc-import-a24：baseline-evidence.json、source-r0.json、approved-source-r1.json、b/review-r0.md、b/review-r1.md、reviewer-r1、private-timing-r1.log、private-r1.log、mutation-results.json与private-\*-final.log。最终隔离集成看integration-checks/completion.json。

## 流程与未验边界

本地skill1c1b68d；两次938.718账本活动秒，首轮与返工均完整SUCCESS、无拒权/未知流。必读声明11/12对齐，不当作有效权限证明。单会话最后input309945/output56017/total365962，thinking29928/cache4948788单列，不重复累加续跑，不作会员计费或Codex净省额证明。精确Codex任务用量未提取。

新问题留本地issues.md，不自动再扩skill：提交阶段与清理间隙仍被首轮遗漏；optional空调用能让迟到测试虚绿；编码默认行为与二次规范化造成内容丢失；报告路径相对化同轮修正。

真实OS文件选择器取消、iOS原生容器/真机文件来源、真实Provider/数据库/Xcode/签名/发布未验。setInputFiles和DOM cancel仅证明浏览器夹具行为，不能替代系统交互证据。整个DocTalk真机TODO继续未完成；本轮不push/deploy。
