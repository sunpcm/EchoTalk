# RF-09 转录事件稳定标识与数据库幂等验证契约

## 1. 背景与目标

在实时语音对话中，Agent 写入转录到数据库可能因网络闪断、确认 (ack) 响应丢失或重连而发起重试。若缺乏事件级幂等标识，重复重试会导致同一转录内容被重复持久化，进而虚增会话轮数统计并污染下游分析数据。

基于用户裁定“先做事件ID与数据库幂等”，本轮完成转录事件稳定 UUID5 派生与数据库原子幂等落地。

## 2. 数据库与迁移契约 (c06_transcript_events)

- **迁移标识**：`c06_transcript_events`（down_revision: `c05_query_indexes`，SHA256 保持 `1741a8572872080de6e2eeee50c1bf7a4aa7fa4b4b9ff451660d24c675dbfbb9`）。
- **列声明**：`transcripts.event_id`，类型为 `UUID`，`nullable=True`，无 `server_default`，不回填数据。
- **约束声明**：复合唯一约束 `uq_transcripts_session_event(session_id, event_id)`。
- **NULL 语义**：采用标准 PostgreSQL 默认普通唯一约束（NULLS DISTINCT，禁止 `NULLS NOT DISTINCT`），保留历史及 legacy 模式下多个 `event_id=None` 记录共存的兼容性。
- **Downgrade 语义**：先 drop 约束，再 drop 新增列，仅丢弃 `event_id` 元数据，而原有转录行记录（含文本、时间戳、情绪状态等数据）完整保留，不改动其他对象与数据。

## 3. ORM 与服务层原子幂等契约

- **ORM 映射**：`Transcript` 模型显式声明 `event_id` 及同名 `UniqueConstraint`。
- **服务接口**：`save_transcript` 扩展 keyword-only 参数 `event_id: uuid.UUID | str | None = None`，保持既有 positional 参数调用完全兼容。
- **Legacy 路径**：当 `event_id is None` 时，执行常规插入，两次调用插入两条记录。
- **幂等写入机制**：
  - 采用 PostgreSQL 原生原子操作：`INSERT INTO transcripts ... ON CONFLICT ON CONSTRAINT uq_transcripts_session_event DO NOTHING RETURNING id`。
  - 严禁先 SELECT 后 INSERT 或依赖应用层进程内锁。
  - 非目标约束错误（如外键不存在）正常抛出并在捕获后安全返回 `None`，不被误判为幂等重放成功。
- **重放一致性校验**：
  - 当发生冲突且查询到已存在记录时，校验 payload 一致性：`role`、`content.strip()`、`emotion_state`（语义字典相等）。
  - 若显式传入 `timestamp_ms`，必须与首写一致；若未显式传入（`None`），允许系统时钟前进，但返回的首写记录保留首写时间戳。
  - 任何 payload 冲突或非法 key，记录安全告警并返回 `None`，不覆盖已有数据且零额外写入。
- **不确定提交重试**：
  - 事务已成功提交，但后续确认步骤因网络异常导致调用方收到 `None` 时，调用方显式使用相同 `event_id` 重试，成功返回已写入的原记录，数据库总行数仍为 1。
- **安全日志边界**：
  - 错误路径不打印 `logger.exception`、原始异常对象、SQL 参数、敏感正文或 API Key。

## 4. Agent 生产入口稳定 UUID5 派生

- **辅助模块**：`livekit_agent/transcript_events.py`，纯标准库实现，无 DB、无 SDK、无网络副作用。
- **派生算法**：基于专用命名空间 UUID 与无歧义编码 `f"{session_id}:{role}:{source_item_id}"`，仅用 `strip()` 校验非空，生成 name 时完整保留 opaque 原始 ID，通过 `uuid.uuid5` 稳定派生。
- **安全日志边界**：非法输入使用固定静态提示，绝不回显未知参数或 Canary 字符串，logger record 保持绝对纯净。
- **域隔离**：不同 session、不同 role 严格域隔离；同一 `item.id` 多次重发产生相同 UUID5，不同 item 即使文本相同也派生不同 UUID5。
- **生产接线**：
  - `EchoTalkAgent.on_user_turn_completed`：基于 `new_message.id` 派生。
  - `_persist_assistant_conversation_item`：基于 `event.item.id` 派生。
  - 缺失、空或非法的 `item.id` 拒绝调用 `save_transcript`，安全告警并严格禁止降级为无 key 写入。

## 5. 质量验证矩阵

1. **真实 PG 顺序与 Barrier 并发幂等**：
   - 顺序重发相同 event 返回同一对象，数据库仅 1 行。
   - 至少 4 个独立连接通过 `asyncio.Barrier` 真正并发竞争，仅插入 1 行且所有并发调用返回同一记录。
2. **多态互不抑制**：
   - 相同文本不同 event 正常插入 2 行。
   - 多条 legacy `event_id=None` 正常插入多行。
   - 跨 session 相同 event 互不影响。
3. **冲突与容错**：
   - 冲突内容、冲突角色、冲突情绪状态、冲突显式时间戳均返回 `None` 且零写。
   - 缺失时间戳重试返回首写时间戳。
   - 非法 UUID 格式安全返回 `None`。
   - 外键违规安全返回 `None`。
4. **统计真实性**：
   - 同 event 重发不会增加会话总轮数统计。
5. **资源清理**：
   - 所有自建测试记录在 `finally` 中严格按归属清理，禁止全库 truncate。

## 6. 未做与阶段界限

- 本轮未引入外部消息队列、后台任务自动重试机制、进程优雅退出排空或崩溃跨进程恢复。
- 不宣称 exactly-once 交付保证。
- `RF-09` 整体（包括 Orchestrator/CredentialResolver/Registry 拆分、sys.path 清理及真实 SDK 联调）仍保持未完成。
