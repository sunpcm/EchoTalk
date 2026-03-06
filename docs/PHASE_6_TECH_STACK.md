# Phase 6 双轨制鉴权与 BYOK 验证重构 - 技术栈与变更清单

## 1. 核心目标

本阶段致力于对阶段 5 的双轨制进行全面的安全防御升级与交互重构，主要目标为：

- 默认强推防白嫖机制：所有用户默认启用自带 API Key (BYOK) 模式。
- 服务级连通性拨测：在保存第三方 Key 时进行真实性的轻量级 HTTP 探测，保障用户填写的密钥有效且不过期。
- VIP 等级鉴权隔离：限制只允许特定级别 (非 `free` 级) 的用户关闭 BYOK 轨道并使用系统的官方兜底额度。

## 2. 新增与修改目录结构

```text
backend/
├── alembic/versions/          # 新增数据库迁移脚本
│   └── 847c9f49681c_phase6_byok_auth_refactor.py
├── schemas/
│   └── user.py                # 扩展 UserSettingsResponse (is_custom_verified, subscription_tier)
├── models/
│   └── user.py                # 修改 is_custom_mode 默认值, 新增 is_custom_verified 布尔字段
├── routers/
│   ├── user.py                # 在更新设置时添加提供商拨测和拦截免费用户逻辑
│   ├── sessions.py            # 在发放 LiveKit Token 前增加连通性、VIP 及配置检查
│   └── health.py              # 将健康检查 /health/ready 细化兼容至配置连通分支认证
└── services/
    └── validation_service.py  # [新增] 第三方 Provider 服务可用性异步测试类

apps/vite-app/
└── src/
    ├── lib/
    │   └── api.ts             # 扩展 UserSettingsResponse 接口, 暴露健康检查接口 /health/ready
    ├── store/
    │   └── conversation.ts    # 在建立连接前加入 checking_health 交互态预检服务健康
    └── components/
        └── settings/
            └── SettingsDrawer.tsx # 增加关闭 customMode 时的 Frontend VIP 告警阻断交互
```

## 3. 涉及技术栈 (Tech Stack)

### 后端 (Backend)

- **FastAPI**: 路由增强及 HTTP 状态码拦截 (`403 Forbidden`, `400 Bad Request`)
- **SQLAlchemy (Async)**: 复合表查询 (如用 `selectinload` 同步联查用户信息与设置表)
- **Alembic**: 添加新字段 `is_custom_verified` 与默认值改写的据库迁移 (Migration)
- **aiohttp**: [新增] 用于 `ValidationService` 发送低延迟非堵塞的轻量外边 API 拨测请求。

### 前端 (Frontend)

- **Zustand**: 新增预备检测连接状态机 (`checking_health`)，完善组件体验。
- **React (Hooks/UI)**: 在切换 Switch 关闭 `is_custom_mode` 时注入拦截提示。
