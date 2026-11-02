# RF-09 Agent 显式启动与无配置副作用导入验证

> 状态：A75 b/r0 本地实施停写，等待主 Agent 代跑门禁与独立 Review。
>
> 本轮未运行 formatter、测试、静态启动探针、真实 SDK CLI、服务或 Docker 镜像。

## 1. 目标与入口

RF-09 最后的启动边界要求是：普通导入 `livekit_agent` 业务模块时，不修改 `sys.path`、
不读取 dotenv、不加载应用 config/database、不创建 database engine 或外部客户端；只有显式
启动才按“dotenv -> config 校验 -> SDK/业务 CLI”执行。

官方入口统一为：

```bash
cd backend
python -m livekit_agent dev
python -m livekit_agent start
```

Compose 的 `echotalk-agent` 同步改用 `python -m livekit_agent start`。直接执行
`python livekit_agent/agent.py dev|start` 依赖隐式 `sys.path` 补丁，不再是支持入口。

## 2. 实现边界

### 2.1 无副作用模块导入

- `backend/livekit_agent/agent.py` 删除 `sys.path.insert`、导入期 `load_dotenv`、顶层
  config/database 导入和文件直接执行的 CLI 分支。
- DB factory、运行期系统配置 default model 均在真实调用点窄延迟导入。
- `CredentialResolver.decrypt_api_key` 保留模块级兼容 wrapper，只在真正解密时加载
  `utils.crypto`。
- `PluginFactory.from_system_defaults()` 通过 `_get_settings()` 在每次调用时读取当前系统
  配置，导入模块不绑定 settings。
- `TranscriptSink.save_transcript` 保留可 patch 的窄 wrapper，默认 writer 只有在实际写入时
  才加载 `services.transcript_service` 与 database engine。
- `build_dynamic_prompt` 与 `SYSTEM_PROMPT` 的唯一实现迁至
  `backend/services/agent_prompt.py`；`services.llm_service` 继续兼容重导出，Agent 直接
  消费纯 prompt 模块，避免导入 OpenAI client/config。

### 2.2 显式启动

`backend/livekit_agent/__main__.py` 仅绑定 `bootstrap.main`，模块被导入时不调用它。
`bootstrap.main()` 的顺序固定为：

1. 对仓库根 `.env` 调用 `load_dotenv(..., override=False)`；
2. 导入 `config.settings` 并调用 `validate_runtime()`；
3. 仅在验证成功后导入 LiveKit SDK 与 `livekit_agent.agent.entrypoint`；
4. 调用 `cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, num_idle_processes=1))`。

进程已有环境值优先于 dotenv。异常配置验证会在构造 `WorkerOptions` 和启动 CLI 前终止。

## 3. 回归设计

新增 `backend/tests/test_agent_bootstrap.py`：

- 真实新 Python 子进程导入 `livekit_agent` 目录下全部模块，使用已锁定真实 LiveKit SDK；
  审计 hook 阻断 root `.env` 文件访问及 socket/DNS 连接，snapshot 校验进程环境和
  `sys.path` 不变，并断言 config/database/LLM service/transcript service/crypto 未加载。
- `python -m` 对应模块 `livekit_agent.__main__` 的导入只绑定函数，不调用 dotenv loader。
- 合成临时 dotenv 验证加载顺序与 `override=False`，进程环境值不被文件覆盖。
- 校验失败时 SDK、Agent 与 CLI 均未导入或启动。
- `WorkerOptions` 的 entrypoint 与 `num_idle_processes=1` 原值保持。

相关既有回归同步加强：

- `test_plugin_factory.py` 证明系统配置在每次调用时读取，而不是模块导入时快照。
- `test_credential_resolver.py` 与 `test_agent_bootstrap.py` 分别证明凭据加解密及
  config/database 窄 wrapper 在真实调用时触达当前运行模块。
- `test_llm_service.py` 证明 prompt 只有一份实现，旧 service 导出保持兼容。
- `test_transcript_sink.py` 在真实专用 PostgreSQL 上验证默认延迟 writer 实际触达 service。

全部测试子进程都设置有限 timeout，失败只输出阶段/类型与必要 stderr，不读取或打印根
dotenv、凭据或用户数据。

## 4. 保持不变的契约

- 双轨模式、显式 BYOK 凭据传递、安全错误映射、错误脱敏与断连行为；
- 转录有界队列、重试、幂等、排空、生命周期和任务收束；
- PostgreSQL 读写、模型、迁移、认证与 HTTP schema；
- LiveKit `WorkerOptions` 的 entrypoint 与 `num_idle_processes=1`；
- 7 个 exact LiveKit SDK pin、lock、CI、Docker 镜像配方与外部服务配置。

## 5. 当前未验边界

- formatter、frontend10、backend pytest、Ruff、OpenAPI schema 与固定入口尚未代跑；
- 独立 import/start 探针和有效变异尚未由主 Agent 执行；
- 真实 `dev/start`、联网 LiveKit/Provider、真实语音链路与 Docker 镜像/部署未验；
- 因此本文件只证明 b/r0 的静态设计与测试设计已落地，不证明 RF-09 或 RF-12 已完成。
