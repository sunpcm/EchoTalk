# I1 发音与语法评估提供方设计

> 设计候选R0，待独立Review与用户确认；未实施。源码事实冻结于main `0f7a5e57f809f8566efc39ca582bdc95fc260dfc`，tree `eeb37709c6e8802092eb8a25ba8fb5b799965d39`。
> 下文接口、文件和验收均是未来建议。当前轮仅五MD；不新增源码、测试、DB结构、HTTP/OpenAPI字段、依赖、真实Provider或B2事件。

## 1. 推荐与输入边界

推荐A：同目录增加一个`assessment_providers.py`，以两个窄Protocol和普通dataclass承载当前文本demo计算；`analysis_service.py`继续选择提供方、查询与独立幂等、构造ORM、flush及调用级coverage。Job事务、失败/取消、重试及BKT保留原所有者。不做插件发现、注册中心、通用执行器或新服务。

输入明确叫`TranscriptAssessmentInput`，仅包含本次合并的转录文本。当前demo发音使用文本生成参考/模拟用户音素，**不接收真实音频**；名称“可替换提供方”不承诺真实发音服务能直接替换此文本输入。真实音频来源、切片/格式、权限、保留/删除、设备证据、超时/取消及外部服务访问须另行设计并获用户授权，必要时另定义版本化音频输入。I1不设计音频采集、不下载模型、不把字母回退称真实评估。

更小的B：只抽两个计算函数，直接返回带metadata的值对象，coverage仍留service。文件/类型更少，但不同方向的调用签名、返回值与失败约束较难由独立提供方契约固定。若用户更重视最少类型，可以选B；推荐A是因为仅增加两个结构化接口即可直接替换受测demo，仍无需继承基类或框架。C（通用Provider registry、自动fallback、统一网络重试）改变过多所有权，本轮不推荐。

## 2. 已核实的当前事实

下列链接均指冻结提交，不把历史PRD或本轮prompt当作源码事实。

| 责任           | 实际代码与证据                                                                                                                                                                                                                                                                                                                                                                                                                 | 设计约束                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 输入与无转录   | 查询user角色转录、按timestamp_ms排序，合并文本；没有转录行时返回None，[service:91–108](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/services/analysis_service.py#L91-L108)。                                                                                                                                                                                                       | 保留查询、顺序及None；不要把无行和有行但空文本混同。                                                           |
| 开关           | `USE_MOCK_ELSA=True`默认，[config:31–37](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/config.py#L31-L37)；False只跳过发音，仍调用语法，[service:110–174](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/services/analysis_service.py#L110-L174)。                                                                                        | 不把False解释成两个提供方均不可用，不重新引入analysis_unsupported失败。                                        |
| 本地发音       | 可选已安装pronouncing/CMU查询，否则字母回退；去重音，TH开头词把TH/DH替换S，[service:30–78](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/services/analysis_service.py#L30-L78)。逐词NW对齐、累计position_offset、算分，[service:123–145](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/services/analysis_service.py#L123-L145)。         | 当前链没有ELSA网络client调用；不新增音频或下载。字典可用性是环境输入，不能把整个提供方宣传为无环境依赖纯函数。 |
| 空对齐         | 空数组得分0.0，其余按correct比例四舍五入到一位，[aligner:124–137](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/services/pronunciation/phoneme_aligner.py#L124-L137)。                                                                                                                                                                                                              | 有转录但清洗后无可对齐单词仍可能产生assessment；不能以空对齐判未调用。                                         |
| 发音持久化     | 只在开关开启时按session查一条旧评估；命中直接复用，否则新建、add、flush，[service:112–161](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/services/analysis_service.py#L112-L161)。session_id有唯一约束，[model:40–56](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/models/exercise.py#L40-L56)。                                        | 不引入按两个方向共用的幂等开关；不重评、不覆盖旧行。                                                           |
| 语法计算与幂等 | 四条规则按既有顺序，每skill_tag最多一条；已有任一语法行就跳过，非空新增才flush，[service:179–268](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/services/analysis_service.py#L179-L268)。                                                                                                                                                                                           | 原纠正、片段提取、去重与顺序保留；查id LIMIT1不能推出全部旧行数或来源metadata。                                |
| 兼容结果       | frozen `SessionAnalysisResult`当前仅assessment可空，id只代理assessment.id，[service:47–55](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/services/analysis_service.py#L47-L55)。                                                                                                                                                                                                    | grammar-only成功仍result非None、assessment/id可None；不把id当“是否成功”标志。                                  |
| Job与事务      | 锁running Job，调用analyze_session，None抛no_user_transcript，之后update_knowledge、succeeded、flush，[jobs:179–209](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/services/analysis_jobs.py#L179-L209)；异常先回滚，再另事务记失败，[jobs:269–282](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/services/analysis_jobs.py#L269-L282)。 | 提供方不能commit/rollback、成功化失败或拥有Job状态。                                                           |
| BKT            | 实际读取P/G行，逐行排除is_synthetic；无观察便返回，之后批量技能/state查询、原公式及flush，[service:287–359](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/services/analysis_service.py#L287-L359)。                                                                                                                                                                                 | 不用coverage/Provider开关/统一会话synthetic值改变BKT输入；不增加置信度阈值或“零错误即答对”。                   |

现有B1设计要求grammar=evaluated且0观察，并将异常/取消与无转录区别处理，[学习事件§5](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/docs/LEARNING_EVENTS_DESIGN.md#L96-L112)。它尚未授权B2，不能在本轮写事件/建表；前端只读契约也不因I1新增写入或coverage HTTP入口，[前端边界](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/docs/FRONTEND_DATA_LAYER_CONTRACT.md#L3-L14)。

### 2.1 Metadata逐字段保持

| 字段                                  | 新demo发音结果          | 新demo语法结果          | 旧行与NULL兼容                                                           |
| ------------------------------------- | ----------------------- | ----------------------- | ------------------------------------------------------------------------ |
| source                                | `demo_mock`             | `demo_rule`             | 原source逐行保留，不能用当前选择器覆盖。                                 |
| provider                              | `None`                  | `None`                  | ORM与HTTP都允许NULL；不填类名、elsa或demo品牌来“补全”。                  |
| model_version                         | `demo-phoneme-rules-v1` | `demo-grammar-rules-v1` | ORM允许None，旧行原值保持，不回填当前版本。                              |
| is_synthetic                          | `True`                  | `True`                  | 旧real行的False不按当前demo配置改写；不同方向逐项保留。                  |
| confidence                            | `0.0`                   | `0.5`                   | ORM允许None或[0,1]；0.0不是缺失，禁止`or`回退。BKT目前不消费confidence。 |
| provider_response_ref / elsa_response | `None` / `None`         | 不适用                  | 发音旧行保持原值；不复制到coverage或日志，也不把elsa_response加进HTTP。  |

新行赋值的直接证据为[发音metadata](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/services/analysis_service.py#L147-L159)与[语法metadata](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/services/analysis_service.py#L233-L245)；合法空值及confidence约束见[发音模型](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/models/exercise.py#L24-L56)、[语法模型](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/models/exercise.py#L65-L100)。现有响应同样允许provider/model_version/confidence为空，[schemas](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/schemas/assessment.py#L32-L66)；本设计不改这些字段、默认值或序列化语义。

## 3. 拟议接口与责任分配（未实施）

只用标准库Protocol/dataclass。以下为形状草图，不是新增可运行实现；Result均不含DB句柄、session/user ownership或Provider原始异常正文。

```python
@dataclass(frozen=True)
class AssessmentMetadata:
    source: str
    provider: str | None
    model_version: str | None
    is_synthetic: bool
    confidence: float | None

@dataclass(frozen=True)
class TranscriptAssessmentInput:
    text: str  # only transcript text; no audio contract

class PronunciationProvider(Protocol):
    metadata: AssessmentMetadata
    async def evaluate(self, value: TranscriptAssessmentInput) -> PronunciationEvaluation: ...

class GrammarProvider(Protocol):
    metadata: AssessmentMetadata
    async def evaluate(self, value: TranscriptAssessmentInput) -> GrammarEvaluation: ...
```

`PronunciationEvaluation`包含完整metadata、原overall_score及原对齐列表字段/顺序；新增demo的response_ref与elsa_response仍由原持久化映射写None。`GrammarEvaluation`包含本次计算metadata及findings（零条也返回明确的空集合，不返回None）；每个finding含skill_tag/original/corrected/error_type与完整metadata，可共享同一不可变metadata值。service按每个finding的metadata映射新行，不用一个session总开关覆盖两方向或已有行。当前两个demo均同源；不据此承诺任意未来混源批次无需另定契约。

两个实现拟为`DemoMockPronunciationProvider`和`DemoRuleGrammarProvider`；算法与默认metadata逐项搬移，不创造非空provider字符串。音素/NW、语法匹配/纠正的计算核可在给定参考音素解析器和输入下直接测试；可选pronouncing字典读取是环境适配，配置选择、日志及持久化不是纯函数。已有aligner继续复用、不改文件。

evaluate采用async接口以便在同一异步service中明确异常/取消边界；当前demo内部只同步计算、无新await/网络/线程/后台任务，await这种协程不会自行新增I/O调度。此接口选择不授权未来外部调用，也不使文本输入具备真实发音能力。

| 层                        | 未来职责                                                                                                                                 | 明确不拥有                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| assessment_providers.py   | 两Protocol、metadata/值对象、两个demo及原计算辅助；每次结果显式带来源。构造只建立普通对象。                                              | DB、Job、settings全局选择、重试、自动fallback、音频输入。  |
| analysis_service.py       | 在原调用点动态读取USE_MOCK_ELSA；两个小选择函数可供新测试替换；原转录查询、两个独立幂等检查、ORM映射和flush、调用级coverage/同步观察点。 | commit/rollback、新HTTP、BKT策略、Provider网络重试。       |
| analysis_jobs.py / worker | 原两参数调用、锁/attempt、事务、原错误码/失败/取消与成功状态。建议保持生产文件字节。                                                     | 按coverage宣告成功或跳过update_knowledge。                 |
| update_knowledge          | 留原service，按原真实行及is_synthetic、原顺序/公式/批量查询更新。                                                                        | 按本次是否调用提供方过滤旧真实行，或将零结果生成正确观察。 |

pronunciation选择函数在原开关点读取当前配置，不在import时冻结。开关False不查旧发音、不调用发音evaluate，仍执行语法；True保持先查旧发音，命中复用，未命中才evaluate。grammar选择/evaluate位于原语法存在性检查未命中后。所有对象构造无副作用；不得因为选择了demo就伪装evaluate已发生。

## 4. Coverage：实际调用、零结果与复用

推荐每次调用局部维护两份`DirectionCoverage`及一个attempt outcome。每方向终态为`not_called | evaluated | failed`，配`result_count: int | None`、受控reason、完整metadata或None、`reused: bool`。evaluated的0与正数形成明确的“已评估零结果/有结果”；它与B1 grammar=evaluated、0观察直接对齐。内部执行中的in_flight仅为局部跟踪，不能被序列化成完成或成功。

result_count表示本次提供方输出数量：发音为对齐条目数、语法为finding数，不是DB新增行数、mapped技能数或BKT观察数。不把发音空对齐仍写一条assessment误计为一条发音观察。evaluated必须来自evaluate正常返回并验证形状，failed不使用0伪装结果；metadata保留合法None，未调用且没有来源事实时整份metadata为None。下表除明确关闭的行外，发音按开关开启路径描述；关闭时即使存在旧发音行，本次原因仍是disabled。

| 本次场景                         | 发音coverage                                         | 语法coverage                               | 兼容结果/行为                                                                 |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| 无user转录行                     | not_called / no_user_transcript                      | not_called / no_user_transcript            | 观察点可记录该原因，analyze_session仍返回None；Job按原码失败。                |
| 发音关闭、语法实际零错误         | not_called / disabled                                | evaluated / count0 / demo metadata         | result非None，assessment/id为None；Job可以成功，不造“答对”观察。              |
| 发音关闭、语法有错误             | not_called / disabled                                | evaluated / count>0 / 每行metadata         | 独立持久化语法，原行为。                                                      |
| 有转录、空白/标点导致空对齐      | evaluated / count0 / demo metadata                   | 按实际语法调用记录                         | 仍可有score0.0的assessment，不能推断未调用或无转录。                          |
| 两方向均实际返回结果             | evaluated / 实际count                                | evaluated / 实际count                      | 每方向/每行保留metadata，不设会话总synthetic来覆盖。                          |
| 已有发音、新语法调用             | not_called / existing_result / reused=true           | 按实际返回记录                             | 返回旧assessment及旧id、原metadata；不把旧行算新调用。                        |
| 发音新调用、已有语法             | 按实际返回记录                                       | not_called / existing_result / reused=true | 语法只查id LIMIT1，旧行数量/metadata未知时保留None，不补查询或捏造。          |
| 两方向已有结果                   | 两方向各自not_called / existing_result / reused=true | 同左                                       | 幂等跳过不表示旧结果历史上未评估；本次调用和历史事实分开。                    |
| 先前语法实际零结果，当前DB仍零行 | 本方向按原规则                                       | 再次evaluate，按本次count记录              | 当前DB没有零结果完成标记，不能跨调用缓存或冒称复用一次未留记录的结果。        |
| 发音evaluate抛异常/取消          | failed / exception或cancelled / countNone            | not_called / upstream_failed               | 观察后原样抛出，无SessionAnalysisResult成功返回；不能静默切demo或返回空列表。 |
| 发音计算成功后语法失败           | evaluated / 实际count / 未证明提交                   | failed / 原因 / countNone                  | attempt失败/取消，原事务回滚；发音计算成功不等于结果持久化成功。              |

特殊混合：开关关闭时旧发音行可能仍存在，返回assessment为None也不表示DB无发音；update_knowledge之后仍按原查询读取旧real行。P真实/G合成仅真实P参与，P合成/G真实仅真实G参与，全合成不产生知识状态更新，来源来自实际行，不由coverage倒推。已有PG控制例见[全合成](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/tests/test_analysis_worker.py#L1009-L1027)、[真实P/合成G](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/tests/test_analysis_worker.py#L1031-L1073)、[合成P/真实G](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/tests/test_analysis_worker.py#L1077-L1118)。

coverage先只在内部内存：实际service成功返回时为`SessionAnalysisResult`增加可选coverage字段，默认None保持旧构造；旧构造/替身未提供coverage表示“未知”，不能自动填not_called或evaluated。assessment/id属性语义不变。失败/无转录仍不返回新成功结果，其观测走下一节同步hook。重启后typed coverage不可查询；没有DB completion marker、HTTP字段或B2审计。不能从旧DB结果补出历史调用次数、failed或零结果事实。

## 5. 失败可观察性、事务与重试

不能仅把failed coverage放成功返回值，也不能仅调用现有`record_event`：原`transaction_events`在异常/取消时丢弃缓冲，[observability:71–88](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/services/analysis_observability.py#L71-L88)。推荐service内一个可直接替换的同步`_observe_coverage(snapshot)`观察点：每方向终态及调用异常退出时交不可变快照，默认best-effort本地诊断，测试可直接收集。不增加全局会话缓存、ContextVar服务或后台发布器。

快照包括两方向状态/count/reused、attempt outcome（completed/failed/cancelled/no_input）、失败阶段（evaluation/persistence/orchestration）和“未确认提交”标记。默认诊断仅用受控枚举/布尔/数量，不输出文本、音频、凭据、Provider原始响应、任意异常码/正文或metadata自由字符串。使用明确的计算诊断前缀，**不使用现有生命周期JSON的event键/事件名**，不宣称Job succeeded、DB已提交或B2完成事件；原事务事件白名单和提交后发布规则不变。观察点自身普通Exception仅影响诊断，不能覆盖原计算异常或改变Job结果；不得吞掉CancelledError/SystemExit等控制异常。

服务记录真正evaluate进入和返回；evaluate异常时对应方向failed，尚未调用方向not_called/upstream_failed，再用裸raise保留原异常身份、类型、code和retryable。CancelledError单独标cancelled后原样传播，不转普通Exception，不进入成功/fallback。DB查询、flush或后续协调失败不冒称提供方抛错：已完成的方向仍evaluated、未提交；attempt失败阶段另记，不因此返回成功。提供方返回None/非法结果形状是失败，不是空集合；不得为此增加新公开码，沿现有未知异常路径处理。

service观察点只覆盖其调用范围；若取消发生在service已经返回后（例如Job/BKT/外层提交），不倒改已完成的计算coverage，更不能凭它宣布事务成功。原Job失败或取消证据负责该范围。SIGKILL等无法运行观察点，重启时不能伪造failed snapshot；沿现有running/stale recovery恢复，coverage历史未知。

独立幂等与事务保持：

1. 原user转录查询→开关内发音存在性查询→新发音add/flush→语法独立存在性查询→规则顺序add/非空flush→返回result。没有新commit、rollback、savepoint或辅助DB查询。
2. 语法已有行不妨碍以后开启发音；发音已有行不妨碍语法首评；空语法结果不flush也不创建“已评估”DB行。零结果再次执行的现状不在I1修正。
3. `execute_claimed_job`继续原两个位置参数调用，然后update_knowledge、成功转换及flush；`process_job`拥有整体提交/异常回滚与另事务失败记录，不能在提供方层抓错后继续成功。
4. 普通异常现有\_safe_error、3次上限、5/30秒回退及手动retry策略保持，[jobs:212–265](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/services/analysis_jobs.py#L212-L265)。可信AnalysisServiceError原码/消息/retryable透传；未知异常仅持久化类名与analysis_failed，不回显canary。诊断未知码折叠策略亦不改变，[原脱敏控制例](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/tests/test_analysis_observability.py#L296-L326)。
5. 取消不是普通失败事务：原PG取消例要求Job仍running、无部分产品、连接归还，[test:972–990](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/tests/test_analysis_worker.py#L972-L990)；不得为coverage擅自置failed/succeeded或写新码。
6. BKT保持读真实行的过滤、批量查询、原循环/flush及事务位置；不加B1拟议用户锁/排序、事件写入或run身份，也不借I1修其跨Job并发/重复观察问题。

## 6. 未来实施范围与兼容迁移（未授权）

| 拟议路径                                               | 最小职责及验收                                                                                                                                                                                                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新`backend/services/assessment_providers.py`           | 标准库DTO/两Protocol、两个文本demo，搬移原音素参考/模拟、规则/纠正计算；复用原phoneme_aligner。算法、metadata、可选字典回退及无DB/网络能力直接契约测试。                                                                                                                   |
| `backend/services/analysis_service.py`                 | 窄选择函数、原持久化映射/幂等/flush、coverage及同步观察点；SessionAnalysisResult只增加默认None的内部coverage。原analyze_session/session+db位置参数不变。                                                                                                                   |
| 新`backend/tests/test_assessment_providers.py`         | 真demo本体/Protocol结果契约，不能全用mock替代计算；注入本地参考音素控制例，不下载字典。                                                                                                                                                                                    |
| 新`backend/tests/test_assessment_provider_pipeline.py` | 真service/Job/专用PG接线、状态/元数据/回滚/取消/复用与零结果，失败仅替换evaluate或选择器；直接收集coverage与canary。                                                                                                                                                       |
| 现有测试的条件性最小调整                               | 优先保留`test_analysis_service.py`、`test_analysis_jobs.py`、`test_analysis_worker.py`、`test_analysis_observability.py`、`test_assessment.py`、`test_sessions_analysis.py`；若新增内部返回类型或夹具确实不兼容，先列具体断言/原因再在实施prompt明确授权，不删弱既有断言。 |

生产优先仅两条路径；模型/Job/worker/HTTP schema、API/OpenAPI/前端、BKT helper/参数、DB/迁移、配置/锁/生成物默认冻结。未来同包需新增同层契约测试并跑真实接线、完整三树与门禁，不以只mock新能力的测试交付。

现有旧测试关键接缝：[设置开关及AsyncMock查询/flush](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/tests/test_analysis_service.py#L111-L138)、[held保留两参并先跑真service再挂起](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/tests/test_analysis_worker.py#L748-L759)、[Job模块内analyze_session绑定替换](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/tests/test_analysis_observability.py#L304-L307)。因此保持动态settings读取、原模块绑定/两个位置参数；不让Job传新必需keyword，不在import时缓存选择器。当前检索未发现旧测试直接patch音素/语法私有计算helper，但这不是外部消费者证明，不能空口承诺所有旧后端测试零改。H1原测试及本轮所有源码/测试则严格零改。

## 7. 未来验收与有效变异计划（未运行）

下表是未来新增直接/PG契约的反例与明确断言，**本设计未运行测试或变异**。未来文件尚不存在，不能伪造候选行号；实施冻结后须补实际文件:行、目标断言RED及逐字节恢复GREEN。有效变异只在Harness自有副本，解析/初始化错误、无关失败及全局timeout不计。

| 契约/反例                | 未来目标及可观察断言                                                                                                                                                                                                                                                                                                 | 单点变异位置/预期                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 两demo metadata与NULL/0  | 直接计算后逐字段断言P `(demo_mock,None,demo-phoneme-rules-v1,True,0.0)`、G对应None/0.5；将结果映射ORM/原响应模型，None仍None、0.0仍0.0。                                                                                                                                                                             | 新provider metadata或service mapper把provider改elsa/None改空串/source串错；目标字段断言RED，不以合法None触发初始化异常充数。 |
| 本地发音算法             | 输入TH开头词及普通词，固定参考解析器；断言TH/DH→S、累计position与原NW分数；字典不可用的字母回退、空对齐score0.0。                                                                                                                                                                                                    | 去TH替换或position_offset累计，具体alignment/score断言RED。                                                                  |
| 零不等于未调用           | 发音关闭、真实语法demo输入`Hello.`；call_count1，G.status=evaluated/count0/metadata完整，assessment/id None但result非None；真Job succeeded，无BKT正确观察。                                                                                                                                                          | coverage从空findings推not_called，状态断言RED；不得只看DB零行。                                                              |
| 无转录与空文本不同       | PG删除全部user转录：service None、原Job failed/no_user_transcript；保留一条空白user转录：提供方实际被调用、空结果可成功。                                                                                                                                                                                            | None改成功空result，Job failed/code断言RED；把空文本当无转录亦应命中真实调用计数。                                           |
| 失败不变空成功           | fake evaluate抛同一个RuntimeError对象，收集同步snapshot：对应failed、下游not_called；assert raised is sentinel；PG无partial产品、Job原pending/重试码。                                                                                                                                                               | except返回空Evaluation或删除失败观察，原异常身份/failed snapshot/Job状态目标RED；日志中注入canary不得出现。                  |
| 取消与阶段               | evaluate真实等待Event时取消，收集failed/cancelled、CancelledError传播；PG Job仍running且无partial产品。另在发音flush/外层BKT挂起取消，保持已计算方向evaluated但无已提交成功宣告。                                                                                                                                    | 吞CancelledError、置succeeded或将事务阶段误报为提供方零结果，状态与snapshot断言RED，使用有限屏障。                           |
| 旧结果复用/独立幂等      | 分别预置P或G，spy实际evaluate次数；复用方向called0/reused=true，不改旧id或可空metadata；另一方向仍能首评。先关P两次G幂等、再开P两次，行数仍P1/G1、P id稳定，复用[现有PG控制例](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/backend/tests/test_analysis_worker.py#L1234-L1256)。 | 用assessment存在代替整轮幂等、复用标成evaluated或覆盖旧metadata，调用次数/逐行metadata/行数断言RED。                         |
| 零结果不跨调用伪复用     | 同一session语法零结果连续两次，真evaluate计数2，每次evaluated0；没有新增completion DB行。                                                                                                                                                                                                                            | 用DB零行/进程缓存当已完成，第二次计数或状态断言RED。                                                                         |
| 部分失败原子性           | 真P已add/flush，G evaluate抛错；process_job后P/G/KnowledgeState无新增，失败另事务正确记录，不改变flush顺序。                                                                                                                                                                                                         | 提供方层commit或把失败吃掉继续成功，独立连接读持久状态/Job断言RED。                                                          |
| 逐行synthetic与BKT       | 真PG分别种P真实/G合成、P合成/G真实、全合成；对照原公式与state集合；关闭P但已有real P仍按原真实行读取，不以coverage改BKT。                                                                                                                                                                                            | 移除某一方向synthetic过滤，unrelated synthetic技能不得出现的断言RED；不能用全局布尔遮蔽混合方向。                            |
| 诊断不改变错误与提交事实 | 观察hook普通异常不掩盖原异常/成功；canary不进诊断/持久last_error；原transaction_events成功仅commit后，取消不发succeeded。                                                                                                                                                                                            | 把失败快照只放可回滚buffer、输出任意异常或改JSON event名，snapshot/原事件集合/脱敏断言RED。                                  |

未来完整三树必须由实际实施包按手册和专用PG身份执行，禁止换库、假skip或用缓存计数。测试范围会包含既有规则、发音对齐、service、Job/worker、HTTP响应兼容及前端原测试；I1设计轮的冻结代码全绿只能证明该轮基线，不验证这些新接口、coverage或变异。

## 8. 待确认、未验证与独立政策

待用户确认是否采用A、本文内部coverage/同步诊断观察点以及第6节未来最小范围；独立Review通过、设计PR或合并授权均不替代具体实施确认。若实施发现必须改旧测试/Job/配置或引入新产品口径，先给真实冲突与最小变更理由，不自行放宽。

I1不引入DB字段、learning_events、analysis run身份、用户锁、HTTP/OpenAPI/前端coverage，不修BKT并发/历史重复观察。B2的切换方式、旧pending/failed Job、retention/删除、重新分析、bkt-v1五问仍待用户，[B1§9](https://github.com/sunpcm/EchoTalk/blob/0f7a5e57f809f8566efc39ca582bdc95fc260dfc/docs/LEARNING_EVENTS_DESIGN.md#L263-L270)。Typed coverage重启不可查，日志也不是已持久化B2审计，不能补历史调用。

真实发音/语法质量、真实音频采集和权限/保留、Provider/LiveKit/IdP、设备/OS权限、整栈/生产均未验；“发音Protocol能接真实提供方”仍缺输入与外部验收设计，不能用当前demo的文本计算或合成PG夹具替代。H1主题历史失败不在本轮修复。当前冻结代码、设计验证来源和停止点见[本轮记录](./history/2026-11-15-i1-assessment-provider-design.md)。
