# RF-10 Settings 默认值与空值水合回归验证

> 状态：A80 b/r1 已补齐文件，停在 Review。r1 增量的受控 formatter、完整测试树、实际消费
> 变异与独立评审尚未执行；r0 已有 formatter 结果为实施侧保留输入。
> 日期：2026-11-01。

## 1. 目标与边界

本轮只关闭 A79 记录的测试债：证明 `SettingsDrawer` 与 `useSettingsForm` 实际消费 Provider
默认值、空值 fallback 和后端对象水合，且合法替代 metadata 默认值确实进入真实 Hook。

生产行为保持不变。本轮不修改 `useSettingsForm`、Settings 视图、tracked
`providers.generated.json`、后端 catalog/exporter、HTTP schema、后端 Catalog、认证、
依赖、锁文件、CI 或生命周期。

## 2. 现行固定契约

tracked metadata 的当前默认为：

| role | 默认 id     |
| ---- | ----------- |
| STT  | deepgram    |
| LLM  | siliconflow |
| TTS  | cartesia    |

LLM 模型是自由文本，初始值与后端 null/空字符串 fallback 都是空字符串；不能把 LLM
provider 默认 `siliconflow` 当作模型默认。

## 3. 真实消费者回归

`SettingsDrawer.test.tsx` 在覆盖后端 settings 引用前，先从真实 UI 断言 STT、LLM、TTS
下拉框分别为 Deepgram、SiliconFlow、Cartesia，LLM 模型输入为空；随后把引用替换为
OpenRouter 与任意自定义模型文本，再断言原样水合。

`useSettingsForm.test.tsx` 直接调用真实 Hook，覆盖：

1. `settings=null` 时的初始草稿；
2. provider 的 null/空字符串与 `llm_model` 的 null/空字符串 fallback；
3. 合法非空 provider 和任意模型文本原样保留；
4. 同一 settings 引用普通重渲染和 `open` 切换不重置草稿；
5. 新 settings 对象触发水合并清空内存 key。

## 4. 替代默认来源证据

`useSettingsFormDefaults.test.tsx` 在独立测试文件中把 metadata adapter 的 LLM 默认值替代为
合法值 `openrouter`，再调用真实 `useSettingsForm`。测试分别从 `settings=null` 的初始草稿
和后端空值的实际水合路径读到 `openrouter`，说明默认来源被生产消费者读取，而不是仅比较
tracked JSON 与静态字符串。

该 mock 只存在于独立测试文件，依靠 Vitest 默认的文件级模块隔离与正常组件测试分离；测试
不执行运行期 unmock，避免解除调用被转换期提升后提前失效。每个用例执行 cleanup，不设置
全局 fake timer，也不改变其他文件的 metadata、React 或模块状态。

## 5. 当前验收边界

b/r0/r1 实施方只写文件，未运行 formatter、Vitest、Playwright、build、安装、数据库、
服务、真实 Provider 或 Git 写命令。主 Agent 尚需在 r1 停写后受控执行固定入口、完整
frontend10/backend 专用 PG/schema/metadata/Ruff，并通过实际消费变异和独立 Review 判定。

Linux/Docker 服务、远端 CI、真实 Provider/LiveKit、设备与部署不在本轮本地测试证据范围。
