# RF-05 版本化离线课程推荐验证

> 对应任务：A72 b/r0/r1  
> 日期：2026-11-01  
> 状态：源码、测试、依赖产物和仓内文档已写入；r1 返修后的完整门禁、Review 与集成待主 Agent 继续执行。

本轮依据现有 RF05/RF07 计划、课程接口契约和 10 条 tracked 种子实施，不依赖独立 PRD 文件或
外部材料。旧 `PHASE_4_BACKEND_TECH_STACK.md` 中的 Chroma 方案仅保留为历史说明，不作为本轮
新实现依据。

## 1. 调用审计

生产调用链保留为：

```text
backend/routers/curriculum.py
  -> backend/services/rag_service.retrieve_materials()
  -> backend/services/material_catalog.get_material_catalog()
  -> backend/data/teaching_materials.json
```

- 课程路由负责认证、当前用户、BKT 弱项、目标 CEFR 推断、Prompt 和 HTTP 响应。
- 检索服务负责 CEFR 硬过滤与确定性排序，不访问网络、环境变量、数据库、用户数据或向量模型。
- 目录服务从源码相对路径加载 JSON，不依赖进程 cwd。
- `scripts/seed_corpus.py` 只做目录校验和摘要输出，没有 Chroma 写入、网络访问或模型下载。

五个直接依赖的调用审计结论：

| 直接声明                | 生产/脚本/Compose 实际消费者                       | 处置                   |
| ----------------------- | -------------------------------------------------- | ---------------------- |
| `chromadb`              | 旧 `rag_service`、旧 `seed_corpus`、Compose Chroma | 删除声明和运行引用     |
| `sentence-transformers` | 无源码导入；旧 Chroma embedding 说明               | 删除直接声明           |
| `librosa`               | 仅 `emotion_analyzer` 过期的预留头注释             | 修正注释并删除直接声明 |
| `soundfile`             | 无源码导入或运行调用                               | 删除直接声明           |
| `scikit-learn`          | 无 `sklearn` 导入或运行调用                        | 删除直接声明           |

主 Agent 已使用 uv 0.9.18 离线原生重生成并审计 `backend/uv.lock` 与
`backend/requirements.txt`：lock 179→107、删除 72 条跨平台记录；requirements
82,071→52,074 bytes；全部存活 package 完整记录逐值相同，7 个 LiveKit exact SDK 保持。
实施方未手写这些产物。

## 2. 语料搬迁对账

`backend/data/teaching_materials.json` 逐值承接原 `SEED_MATERIALS` 的 `id`、`document`、
`scenario_name`、`difficulty_cefr`、`cefr_numeric`、`category`、`primary_skill` 和
`skill_tags` 内容及顺序。唯一规范化为 JSON 字符串数组，并新增种子顺序 `priority=1..10`。

| priority | id                      | CEFR | primary skill            | tags                                           |
| -------- | ----------------------- | ---- | ------------------------ | ---------------------------------------------- |
| 1        | `mat_biz_greet_b1`      | B1   | `word_stress`            | `word_stress`, `linking_sounds`                |
| 2        | `mat_past_perfect_b2`   | B2   | `verb_tense_past`        | `verb_tense_past`                              |
| 3        | `mat_th_minimal_a2`     | A2   | `th_sounds`              | `th_sounds`, `consonant_clusters`              |
| 4        | `mat_hotel_checkin_b1`  | B1   | `preposition`            | `preposition`, `linking_sounds`                |
| 5        | `mat_svagree_a2`        | A2   | `subject_verb_agreement` | `subject_verb_agreement`, `verb_tense_present` |
| 6        | `mat_restaurant_b1`     | B1   | `vowel_sounds`           | `vowel_sounds`, `article_usage`                |
| 7        | `mat_articles_b2`       | B2   | `article_usage`          | `article_usage`                                |
| 8        | `mat_presentation_b2`   | B2   | `word_stress`            | `word_stress`, `consonant_clusters`            |
| 9        | `mat_vowel_contrast_a2` | A2   | `vowel_sounds`           | `vowel_sounds`                                 |
| 10       | `mat_job_interview_c1`  | C1   | `verb_tense_past`        | `verb_tense_past`, `word_stress`               |

未增加新语料，未改写教学文案。

## 3. 校验与缓存

`material_catalog.py` 在首次加载时拒绝以下数据：

- 非对象数组、空目录、缺失必填字段或重复 JSON key。
- 空或重复 id、非法 CEFR、CEFR 字符串与数值不一致。
- 空文本字段、非整数/非正 priority。
- 非数组、空数组、含空值或重复值的 `skill_tags`。
- `primary_skill` 不在 `skill_tags` 中。

成功加载结果为由冻结 dataclass 组成的 tuple；标签保存为 tuple。检索在每次调用时重新创建
`RetrievedMaterial` 和可变的 `skill_tags` 列表，调用方修改结果不会污染缓存或后续请求。

## 4. 检索行为

- 输入等级大小写兼容；非法等级回退 B1。`'B2'`/`'b2'` 合法，空白包裹的 `' B2 '`
  保持未知字符串语义并回退 B1。
- 硬范围保持 target 至 target+1，C2 封顶。
- `top_k <= 0` 返回空；非整数拒绝为 `ValueError`；大于候选数返回全部候选。
- 弱技能先去重，不因重复输入增加标签权重。
- 同范围候选依次按 primary-skill 命中、标签交集数降序、priority 升序、id 升序排序。
- 空弱技能或无命中时仍只在 CEFR 范围内按 priority/id 回退。
- `RetrievedMaterial.distance` 固定为 `0.0`，仅保留内部调用形状兼容，不表示相似度且不进入
  HTTP 响应。

## 5. 回归覆盖

`test_rag_service.py` 覆盖真实目录 10 项对账、坏数据和坏类型、冻结缓存与结果隔离、CEFR
边界、非法等级、`top_k` 边界、重复弱技能、排序稳定性和禁用重依赖/网络的异 cwd 子进程。

`test_curriculum.py` 保留原 Prompt 断言，并新增专用 PostgreSQL schema 上的真实路由用例：

- 无知识状态时使用默认弱项和 A2 Top3。
- 不同 CEFR 与 primary-skill 相关性产生确定性 Top3。
- 相同请求结果与 Prompt 字段稳定。
- 两个用户的知识状态互不串用。
- 缺失认证返回 401。

路由用例不 mock `retrieve_materials`，实际读取版本化目录。

## 6. 当前验证状态

主 Agent 已通过 formatter、frontend10 与 Ruff。完整后端首次运行 565 passed/1 failed；
唯一失败是测试 expected 漏掉 `mat_restaurant_b1` 的 `article_usage` 次级标签命中，生产排序
本身符合 r0 规则。r1 已修正该 expected，并为 `' B2 '` 添加紧邻的 B1 回退回归；最终完整
测试、OpenAPI schema、Compose 静态校验与 Review 仍需重验。

同口径本机观察：runtime 环境 1,390,752→326,916 KiB，dev/runtime 安装包分别为
159→106、152→99；三次新进程仅导入 RAG 模块为
2.658671542/0.269479250/0.260155625 秒→0.003195792/0.001239125/0.001205500 秒，
中位数 0.269479250→0.001239125 秒。这些数据受 OS 缓存影响，只是模块导入/本机环境数据，
不是物理冷读、完整应用启动、Docker 镜像、CI 安装或部署指标。

镜像/CI 体积、部署冷启动和真实外部链路尚无改造前后对照，不能据本文件宣称 RF05 整体完成。
周报仍未实现。
