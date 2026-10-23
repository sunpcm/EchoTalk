# CP-05 恢复失败与取消终态（A23）

产品`8b2df80`独立APPROVED，契约见[恢复终态](../../CROSS_PLATFORM_RESUME_ERROR.md)。正常恢复失败发布idle而未作废sessionGen时，组件保留当前请求结果、完整目标和专用安全错误；用户点击重试才重新调用。真正reset/goHome等推进代际时立即释放UI槽位，旧Promise迟到不影响新意图；成功恢复仍沿用原store行为。仅组件及测试改动，store/API/auth/platform/布局/i18n/依赖不变。

## 验收与反例

独立完整七门禁：588产品/25文件、18构建脚本、60默认双浏览器（各30，旧56保留）。12独立真实store双浏览器覆盖能力/详情/无效详情/健康/Token/无效Token失败；验证前序失败不进入后续步骤、安全错误/完整UUID/44px重试、同目标单次显式调用、取消零写。2独立时序探针证明不额外清除共享错误，真实store.subscribe在错误通知中同步reset后不显示旧局部错误。A22原两项失败用例已双浏览器复验通过。

首轮P1：叶子组件为消除旧E2E全局文本选择器冲突，清理共享error后发生外部同步reset，随后仍setResumeError导致旧错误回写。返工删除两处不必要共享写；同时删除retry内伪确认span。旧E2E仅契约§4两处精确定位器迁移及增强可用/目标错误断言，保留原副作用断言。新增产品单测subscriber-triggered reset...名称大于事实，实际act直接reset，不能当同步订阅证据；真实同步订阅由独立私有探针补验，名称留后续触及时修正。

两个有效变异：恢复idle无条件取消使正常失败专用错误消失（双浏览器失败）；去取消代际检测使同步reset后旧错误出现（时序用例失败）。恢复原字节/整树指纹，2时序与原始2浏览器再次通过。证据仅本地.review/reports/workflow-resume-error-a23：source-r0.json、approved-source-r2.json、b/review-r0.md、b/review-r2.md、reviewer-r1、private-r1.log、private-timing-r1.log、mutation-results.json与original-regression-final.log。最终隔离集成见integration-checks/completion.json。

## 工作流记录

skill1c1b68d，首轮/返工/冷启动短恢复3次，账本2156.04秒；r1终止SUCCESS但第16行未知checkpoint拒收，未扩大解析器、未洗掉原失败。正式reconcile后同Flash冷启动r2只补短交付，源码和8旧证据hash前后相同，完整SUCCESS/无拒权。r2不改源码因此no_progress=1保留，未重置预算。启动必读声明首轮11/返工12/短恢复5均对齐，非有效权限证明。

用量按每会话最后累计去重：原会话input847854/output133179/total981033，短恢复另input51656/output5389/total57045，合计1038078；thinking108514/cache17651774单列，不额外加入total，不当作会员计费或Codex净省额。Codex任务用量未提取。

新问题记入本地issues.md：长期等待的沟通噪声、过宽的旧测试定位器冻结诱发产品兼容代码、私有Vitest目录解析既有依赖失败、checkpoint流再次出现。暂不扩全局skill。真实OS/Provider/数据库/Xcode/设备/签名/发布未验，无新增依赖，不push/deploy；当前main不据本地隔离提交推定已包含。
