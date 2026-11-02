# CP-05 回答推荐作用域无歧义编码（A33）

## 范围与行为

基于 A26 与后续候选契约，只修改 `AnswerRecommendations.tsx` 中的 `currentScopeKey` 身份编码（保留原 `null` 门禁、`isWaiting`、默认空 ID 与空白 trim 语义）及相邻注释。解决直接冒号拼接导致的实际边界碰撞缺陷：

- 缺陷场景：当外部 segment ID 或文本包含冒号（例如 `id='seg', text='What:is your hobby?'` 与 `id='seg:What', text='is your hobby?'`）时，原冒号拼接生成完全相同的 scopeKey (`"seg:What:is your hobby?"`)，导致切题后旧题目的“已复制”反馈残留，且旧题目的迟到剪贴板成功回调会错误标记新题目。
- 修复方案：采用无歧义二元组编码 `JSON.stringify([latestQuestionSegment.id ?? "", latestQuestionSegment.text.trim()])`，彻底消除任意合法外部 ID 与文本分隔符边界歧义，不靠替换/剔除合法字符，不限制外部 ID 格式。
- 其他交互保持：同问题健康重渲染继续保留复制反馈，1500ms 定时器在到期后准时清除且不被重渲染重置计时，卸载清理机制不变，文案、布局与权限均逐字节保持。

## 验证与覆盖

1. **单测回归（`AnswerRecommendations.test.tsx`）**：
   - 冒号边界碰撞切题：已复制后切换至冒号碰撞题目立即清除提示；
   - 冒号边界碰撞与延迟 Promise：旧 pending 复制切至冒号碰撞题目后再 resolve 不显示提示，且新题目后续复制正常工作；
   - 冒号碰撞与交叉竞争：新 tuple 发起复制并成功后，旧 promise 不清除新提示（新增测试未真正执行旧 timer；真实旧 timer 由 Codex 独立探针执行）；
   - 同 tuple 健康重渲染：保留已复制反馈，并在初始 1500ms 到期后准时消失，不因中途重渲染而重置计时；
   - 边界与特殊字符：覆盖缺少 ID（undefined）、冒号/引号/反斜杠/Unicode（emoji 等）以及多余空白 trim 的实际语义。
   - 所有单测 mock 与 fake timer 严格清理与还原，保留原有全部断言。

2. **双浏览器端到端回归（`e2e/answer-recommendations.spec.ts`）**：
   - 复用现有隔离页面 fixture（`e2e/fixtures/answer-recommendations.html`）与 LiveKit hook stub；
   - 覆盖冒号边界碰撞切题：切换题目后立即断言“已复制”不可见，且新题目可再次点击复制成功并写入完整英文原句；
   - 覆盖冒号碰撞题目间迟到 clipboard 完成：题目 A 挂起写入后切换至题目 B，题目 A 的延迟完成不污染题目 B，题目 B 可正常复制并写入剪贴板；
   - 全程断言 0 pageerror，以及零会话、令牌、租约、调度隐式写请求（零 POST/PUT 业务调用）。
   - 保留原四视口、字号缩放及键盘交互用例。

## 边界与状态

- 外部真实 IdP、LiveKit 媒体网络与原生移动端真机仍待独立验收，不在本单项增量范围内。
- 本轮仅针对作用域编码进行本地可靠性增强，不改动三端任务勾选计数。

## Codex 独立验收（2026-10-25）

APPROVED。修前两个真实冒号边界反例失败，修后5项独立探针通过，含实际捕获并执行旧1500ms回调不能清新提示、同tuple trim后健康重渲染维持原期限。还原冒号拼接导致2项产品测试失败，忽略text身份导致1项失败；逐字节/整树恢复后完整8门禁665 Vitest、18构建脚本、53 Fake API Node、138双浏览器通过，0skip；专用库269 pytest、覆盖率73.72%与Ruff通过。产品仅一行身份编码与一行注释，其他行为未变。

P2测试维护：新增交叉竞争测试用空act模拟旧timer，不能作为旧回调覆盖；新增浏览器用例也没有严格比较完整剪贴板原句，仅比较写入数量/文本差异。真实旧timer由独立探针覆盖，完整原句已有保留的旧单测/浏览器用例，不能把新增断言夸大为精确原句证明。原报告保留，问题记录本地；不改skill/扩权。系统剪贴板权限、真机和真实Provider仍未验。
