# 2026-11-15 I1评估提供方方案A实施 R0

本轮为已确认A的I1实施收口：整个I1含四代码/测试与五MD，I1已实现；本记录只收五MD最终文档。源码独立APPROVED R0、代码返修0/2、15门禁全绿、5项有效变异；实现PR/main尚未发布。本记录不预报实现PR/CI编号或结论，未做B2/真实音频接入。

## 1. 身份、范围与停止点

唯一lane `.review/worktrees/i1-assessment-provider-implementation-20261115`，branch `codex/i1-assessment-provider-implementation-20261115`，HEAD `312a8f802b73f5fcb1e285a52c9dce2b1b497bad`、tree `7e420c6fabac870f5b157ce483eb91ec07ed05d5`。四路径脏：`backend/services/analysis_service.py`（修改）与`backend/services/assessment_providers.py`、`backend/tests/test_assessment_providers.py`、`backend/tests/test_assessment_provider_pipeline.py`（新增），未暂存；作为待Review候选保留，不当冲突丢弃。

角色为实施方接续；Harness仍亲自独立Review。本阶段执行范围仅五MD：`TODO.md`、`docs/PROJECT_STATUS.md`、`docs/ASSESSMENT_PROVIDER_DESIGN.md`、`docs/history/todo-done.md`及本记录。四源码/测试及其他所有路径严格原字节；旧todo-done前缀、旧history和其他卡保全。

## 2. 已确认A与实现边界

用户已确认方案A并授权实施，不再等待设计确认。实现范围对应设计§6两条生产路径：

- `backend/services/assessment_providers.py`：标准库frozen DTO、两个窄async Protocol、两个文本demo（demo_mock/demo_rule）及原计算辅助；不持有DB/Job/全局settings/会话ownership，构造普通对象。
- `backend/services/analysis_service.py`：原动态开关点读取`USE_MOCK_ELSA`、原转录查询、两个独立幂等门禁、持久映射/flush，新增`SessionAnalysisResult.coverage`默认None及同步`_observe_coverage`；`update_knowledge`整个既有函数体与BKT段尾逐字节保留，`AnalysisServiceError`定义/码/身份不变，`analyze_session(session_id,db)`原两位置参数不变。

原metadata逐字段保持：`demo_mock/None/demo-phoneme-rules-v1/True/0.0`、`demo_rule/None/demo-grammar-rules-v1/True/0.5`；source为原名字，0.0不做or回退，旧NULL/id/False与原`response_ref`/`elsa_response`不补写。CMU可选/字母回退、去重音、TH/DH→S、NW、position_offset/评分、四规则顺序/每skill唯一、纠正文案与片段全保持；不下载字典/模型。

coverage为调用级内存观测，重启不可查；默认诊断固定`commit_status=unconfirmed`，不宣称Job succeeded、DB已提交或B2事件。不新增完成表、跨调用缓存、HTTP/OpenAPI字段或公开错误码。DB查询/flush/外层BKT/commit异常不冒称provider失败；已计算evaluated仍未提交，service范围之外不虚构snapshot。

## 3. 本机15项命令与结果（Harness亲跑，非实施方）

下表15门禁全部exit0、source前后字节稳定；时间与计数来自Harness分享回执，不是实施方执行。957=原895+新增62（30直接Provider+3同步管线+29PG接线），旧测试不减少、不改断言。真实命令以Harness分享回执`pr-body-draft.md`为准（`apps/vite-app pnpm test`、`test:fake-api`/`test:api-types`/`test:build`、`turbo lint/typecheck/build --force`、backend完整`pytest --cov=. --cov-report=term-missing`、完整Playwright`--retries=0`等），门禁入口见[Agent评审手册§2](../agent-review-loop.md)。

| #   | 门禁            | 结果                                  | 时间                 |
| --- | --------------- | ------------------------------------- | -------------------- |
| 1   | vitest          | 1249 passed / 53文件                  | 15.24s               |
| 2   | fake-api        | 125                                   | 6.74s                |
| 3   | api-types       | 10                                    | 5.43s                |
| 4   | build-scripts   | 21                                    | 13.18s               |
| 5   | lint            | 132 warnings / 0 errors               | 6.02s                |
| 6   | typecheck       | 通过                                  | 5.28s                |
| 7   | build           | 通过                                  | 7.3s                 |
| 8   | check-api-types | 通过                                  | 1.34s                |
| 9   | openapi         | 通过                                  | 11.43s               |
| 10  | providers       | 通过                                  | 0.2s                 |
| 11  | backend-format  | 通过                                  | 0.18s                |
| 12  | backend-lint    | 通过                                  | 0.14s                |
| 13  | pytest          | 957 passed / 3 warnings / 80.63%      | 80.83s（命令85.74s） |
| 14  | e2e             | 234，C117/W117，实际retry/skip/flaky0 | 61.89s（命令63.43s） |
| 15  | format          | 通过                                  | 8.28s                |

## 4. 实施方纯provider与首次Ruff

实施方仅经原ev.sh --quiet在`implementer/ev`留证：纯provider入口R0a 27 passed → 增加非法alignment type反例后R0b 30 passed，均一条PytestCacheWarning（`-c /dev/null`缓存目录权限拒绝，非产品断言失败），0.10s/0.08s。首次`ruff check` exit1为pipeline测试合并导入I001，仅拆分导入修正，原失败保留；后续`ruff check`/`ruff format --check`全部通过，未改入口/权限。Harness完整15项与5项变异无首次失败需重放，RED均为刻意变异。

## 5. 5项有效变异（Harness私有副本，非实施方执行）

目标测试定位来自Harness分享回执`approved-code-evidence-r0.json`与`pr-body-draft.md`；实施方未读私有XML/探针。每项先磁盘备份、仅改Harness自有副本，目标断言RED，finally逐字节恢复，恢复62GREEN；变异结束、文档收口前：正式/私有695文件均与冻结R0一致（当前最终docs已变、总696文件，四代码/测试始终原字节）。解析/初始化错误、等价或无关失败不计。

| 变异源码:行                   | 单变量改动                                               | 精确目标断言文件:行                                                                                                |
| ----------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `analysis_service.py:333`     | `confidence=finding.metadata.confidence` → `... or 0.5`  | `test_assessment_provider_pipeline.py:363` `test_replacement_return_metadata_is_persisted_not_demo_or_declaration` |
| `analysis_service.py:317`     | `"evaluated", len(...)` → `"not_called", ...`            | `test_assessment_provider_pipeline.py:574` `test_grammar_zero_is_invoked_again_without_marker_or_extra_flush`      |
| `analysis_service.py:221`     | `"failed", reason="exception"` → `"evaluated"`           | `test_assessment_provider_pipeline.py:612` `test_provider_failure_identity_and_failed_snapshot`                    |
| `analysis_service.py:386`     | `if not error.is_synthetic:` → `if True:`                | `test_assessment_provider_pipeline.py:876` `test_real_job_bkt_uses_each_persisted_synthetic_flag`                  |
| `assessment_providers.py:112` | `_get_mock_user_phonemes(ref, clean_word)` → `list(ref)` | `test_assessment_providers.py:57` `test_real_pronunciation_metadata_th_alignment_position_and_score`               |

其中`analysis_service.py:386` synthetic过滤变异只证目标测试定位，不表示本轮改了BKT——`update_knowledge`及旧逐行synthetic过滤函数保持原字节。

## 6. 未验证与交接边界

实现PR/mainCI未发布，不预填实现PR/发布编号、终点SHA或整包/发布结论（源码APPROVED R0已实有）。已发布的是设计PR175/main312a8f8及设计mainCI43681402200，不把设计CI冒成本次实施验证。真实Provider/LiveKit/IdP、音频来源/权限/保留、设备、整栈与部署未验；B2五问仍待用户。H1本机两次theme-storage 233/1与G3设计同位失败保留，本I1绿不证明主题已修。`source_writes_stopped=true`，交付停Review，不commit/push/merge/部署，不接下一轮。
