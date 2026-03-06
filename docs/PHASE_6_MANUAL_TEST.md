# Phase 6 手工验收测试手册

## 1. 测试准备与前置环境

- 安装新加入的依赖 (如果处于新环境): `uv pip install aiohttp`
- 确保应用了新的迁移: `alembic upgrade head`
- 运行主服务 `python main.py` 或 `uvicorn` 以及前端 `pnpm --filter vite-app dev`.

## 2. 核心功能验收

### Test Case 1: 免费用户的强推与拦截 (VIP 隔离)

- **前置条件**: 利用 Mock 鉴权或数据库脚本保证当前登录测试账户的 `subscription_tier` 字段在 `users` 表里为 `free`。
- **操作**: 登录前端 -> 打开顶部的设置抽屉 (Settings) -> 尝试点击“自备 API Key 模式 (BYOK)”的开关，意图将其变灰 (关闭)。
- **预期结果**:
  1. 开关保持蓝色开启状态不变。
  2. 屏幕弹出警告 `alert`：“该功能仅限 VIP...请继续使用自定义模式”。
- **后端验证**: 使用 Postman 以 `free` 身份硬测 `PUT /api/user/settings` 将 `is_custom_mode` 改为 `false`，预期收到 `HTTP 403 Forbidden`。

### Test Case 2: 自带服务拨测验证 (Validation Service)

- **前置条件**: 当前账户（无所谓什么级别）自带密钥模式处于开启状态。
- **操作A (输入假 Key)**: 随便填入无效字符串 -> 触发保存。
- **预期结果A**: 后台日志打印拨测失败。再次请求 GET `/api/user/settings` 时，`is_custom_verified` 输出应该为 `false`。
- **操作B (输入真 Key)**: 填写真正的 DeepGram/SiliconFlow/Cartesia Key -> 保存。
- **预期结果B**: 后台触发全量 HTTP 拨测均返回 200。此时 `is_custom_verified` 应保存为了 `true`。

### Test Case 3: 服务准入保护 (Session Token)

- **操作**: 前置令 `is_custom_verified` 设为 `false`(例如填假 key 或者通过 DB 硬改) -> 点击主页的场景试图“进入练习”。
- **预期结果**:
  1. 界面应该通过 `health/ready` 报错或创建 Session 报错，停留在页面不崩溃。
  2. 网络请求 `/sessions/{id}/token` 会拦截返回 `400`：“自备密钥未验证或验证失败，请先完成密钥验证”。不允许这虚假的客户端连入 LiveKit。

## 3. i18n 兼容性测试

- 继续检查前端的 `SettingsDrawer` 以及预备加载等新增文字是否正常应用多语言钩子 (当前多为直写或复用老字典，测试无崩溃即可)。

## 4. 排障指南 (Troubleshooting)

- **设置更改后未生效 / 403**: 检查 `users` 表中用户的 `subscription_tier` 的记录。这很可能是目前你以 `free` 身份在操作。
- **Agent 报 401 Unauthorized 失联**: 如果配置保存了并强行跳过了验证，LiveKit Agent 现在监听了 `ErrorEvent`。日志将会打印形如：`自定义轨运行时认证失败: session_id=xxx, error=xxx`。这归功于新增的环境变量 `_SENSITIVE_ENV_VARS` 临时清除保护。

### Test Case 4: 增量式局部保存与状态可视化 (UI & Partial Update)

- **前置条件**: STT、LLM、TTS 的 Key 皆未填，处于初始状态。
- **操作A (提交局部正确 Key)**: 在 STT (Deepgram) 输入有效 Key，留空 LLM 与 TTS，点击保存。
- **预期结果A**: 保存后页面上方**弹出保存成功提示**。此时整体 `is_custom_verified` 仍为 false (无法进入录音室)。但在设置抽屉中，STT 的标题旁会出现绿色的 `已连通` 徽章，而 LLM 与 TTS 保持灰色的 `未配置`。
- **操作B (增量提交错误 Key)**: 在 STT 绿色的情况下，在 LLM 输入随意乱打的无效密钥并点击保存。
- **预期结果B**: 保存被阻断。界面上方滑出红色的报错 Toast 提示 "LLM 密钥验证未通过"。由于拦截在此处，STT 这边的合法校验依然存在不被覆盖污染。
