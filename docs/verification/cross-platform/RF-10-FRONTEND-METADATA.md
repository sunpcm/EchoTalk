# RF-10 Provider 前端展示元数据单一来源验证

> 状态：A78 b/r0 已 Review APPROVED，单提交 `8efb92387ac0bf3b9489a20b6080d78d6ec91ab4`
> 已精确 fast-forward 本地 main，并完成 main 15 项门禁复验。
> 日期：2026-11-01。

## 1. 目标与边界

RF-10 要求 Provider 的公开展示元数据进入统一 Registry。本轮只处理现有前端的 STT、LLM、
TTS 下拉选项与设置表单默认值，解决三组 id/label/default 在后端不可变 catalog 与前端组件中
重复的问题。

本轮不新增 HTTP API，不在打开设置抽屉时请求 Provider 元数据，不引入 SDK 或运行时依赖，
不改变四家 Provider 的现有顺序、品牌 label、默认选择、LLM 自由文本模型、权限、表单打开
周期、保存载荷、网络请求或错误语义。真实 Provider 拨测、远端 CI、部署、LiveKit 和设备不在
本轮本地验收范围。

## 2. Catalog 单一来源

`backend/provider_catalog.py` 保留纯标准库、不可变 entry 与 mapping，并为既有
`LLMProviderMetadata`、`STTProviderMetadata`、`TTSProviderMetadata` 增加有默认值的
`role`、`label` 与 `is_default`。新增字段位于原必填字段之后，旧构造调用不会因缺少展示字段
提前失败；`PROVIDER_CATALOGS` 以只读映射暴露 STT → LLM → TTS 三组真实 catalog。

实际目录值保持：

| role | id          | label       | default |
| ---- | ----------- | ----------- | ------- |
| stt  | deepgram    | Deepgram    | yes     |
| llm  | siliconflow | SiliconFlow | yes     |
| llm  | openrouter  | OpenRouter  | no      |
| tts  | cartesia    | Cartesia    | yes     |

Catalog 中的 URL、API key field、validation URL、Headers 与其他运行元数据不进入展示投影。

## 3. 离线生成器

`backend/export_provider_metadata.py` 的父进程只加载标准库并处理参数/原子文件 I/O；真实
catalog 导入、投影与序列化在 `-I -B` 子进程中执行。子进程在导入 catalog 前安装 DNS/socket
失败关闭屏障，只接收固定最小环境，并有 30 秒 timeout。异常只输出阶段与异常类型，父进程
再次校验该受限协议，任意其他 stderr 安全回退。

canonical 产物使用 UTF-8、排序 key、2 空格缩进与末尾换行。写入只使用目标目录中的临时文件，
完整写入并 `fsync` 后才 `os.replace`；任何失败保留旧产物。`--check` 只读比较，缺产物、
stale 或其他失败均非零，不创建文件或目录。

预期公开投影形状：

```json
{
  "defaults": {
    "llm": "siliconflow",
    "stt": "deepgram",
    "tts": "cartesia"
  },
  "providers": [
    { "id": "deepgram", "label": "Deepgram", "role": "stt" },
    { "id": "siliconflow", "label": "SiliconFlow", "role": "llm" },
    { "id": "openrouter", "label": "OpenRouter", "role": "llm" },
    { "id": "cartesia", "label": "Cartesia", "role": "tts" }
  ]
}
```

实际 tracked 文件必须由生成器写出，禁止手写。`.prettierignore` 仅精确排除
`/apps/vite-app/src/lib/providers.generated.json`，其字节由后端 `--check` 守护。

## 4. 前端消费

`apps/vite-app/src/lib/providerMetadata.ts` 从生成 JSON 派生三组只读 option 和默认 id；
`SettingsProviderFields` 与 `useSettingsForm` 是真实消费者。生成器不写前端映射，adapter 与
组件也不维护第二份 id/label/default 字典。品牌名保持现有专有名词，不新增用户文案。

设置组件回归覆盖三个下拉框的 option label/顺序、`null/空值`的既有 fallback，并保持未知
非空 provider 与任意 LLM 模型文本原样；后端 settings 对象引用变化后的 Provider 和自由
文本模型继续按既有规则水合。LLM 模型仍为空初始值/用户自由文本，不生成固定模型列表。

## 5. CI 与回归

`test-backend` 在既有 OpenAPI schema 检查后运行：

```bash
cd backend
.venv/bin/python export_provider_metadata.py --check
```

`test-frontend` 不安装 Python。新增后端 `tests/test_provider_metadata_export.py` 覆盖：

1. exporter import/help 不加载 catalog 或业务模块；
2. 真实 catalog CLI 生成确定字节和完整公开投影；
3. 每次投影为新副本，修改投影不污染 catalog 或下一次结果；
4. `--check` 对缺失和 stale 非零且不写；
5. timeout、不规则子进程 stderr 与子进程异常不回显任意异常正文；
6. 原子替换失败保留旧产物并清理临时文件；
7. 输出不含 base URL、validation URL、key field、credential 或 headers。

`tests/test_provider_catalog.py` 另覆盖新增展示字段、默认值兼容构造、只读目录与纯标准库
隔离导入。`SettingsDrawer.test.tsx` 和 `providerMetadata.test.ts` 覆盖真实前端消费。

本地固定 runner 保留既有 frontend10 与 OpenAPI schema 门禁，并由主 Agent 审查接线独立
`provider-metadata-check`。A78 的 main 复验共 15 项门禁，覆盖 tracked 生成 JSON 的字节
检查；该结果与更早轮的通过事实分开记录。

## 6. 当前未验证状态

- `apps/vite-app/src/lib/providers.generated.json` 已由受控主 Agent 原生生成并跟踪；A78 的
  main 复验为 15 项门禁，包含 969 Vitest/34 files、18 build-script、61 Fake API、
  8 类型生成器、148 E2E、586 backend/76.98% coverage、OpenAPI/provider metadata schema
  检查与 Ruff。具体计数绑定具名提交
  `8efb92387ac0bf3b9489a20b6080d78d6ec91ab4`，不是未来 HEAD 的实时断言。
- A78 只完成本地 Review、单提交集成与 main 复验；未 push、部署或启动真实 CLI/服务。
- 真实 Provider、远端 CI、Linux/Docker 镜像、设备与生产链路仍未验证；A78 不能单独完成
  RF-10 或 RF-12。
