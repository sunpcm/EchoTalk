# 练习前置检查与失败引导

任务日期：2026-11-02；最终结果同步：2026-11-03。主控最终组合 21 项检查全部通过。
独立 Review 与提交状态以本轮主控最终报告为准。

## 行为和兼容边界

依据 `docs/ARCHITECTURE.md` §5.1 及 RF-03/RF-10，readiness 位于创建、Token、
Room、dispatch 与采音之前。保留基础 health、readiness 成功响应及鉴权依赖；失败仍是
HTTP 503 和 `detail.status=not_ready`、字符串字典 `detail.errors`，增量为可选 `detail.code`。
不修改 Token 的 401/400/403、设置保存/验证、套餐或 Cloud 占用协议。

后端检查数据库、用户行、设置、BYOK 聚合验证及各非 Mock 角色的 Provider/密文必填项。
系统轨校验套餐、catalog 默认 Provider 对应密钥和模型；LiveKit 按其独立 Mock 开关检查。
Provider 是否有效仍由既有验证流程负责，此检查不解密、不拨测、不导入完整语音 Agent。
数据库失败后不额外归因用户配置；响应和日志均不输出异常正文、URL、Key 或密文。

主原因顺序固定为 database_unavailable、user_unavailable、settings_required、
custom_unverified、custom_incomplete、permission_denied、livekit_unconfigured、
provider_unconfigured；多原因保留在 errors 中。

前端只通过本次 ApiError 的 503、not_ready 结构及白名单 code 决定中文消息和动作。
设置缺失、BYOK 未验证/不完整及套餐拒绝提供设置入口；服务故障提供重新检查。
未知码、旧格式及非 JSON 错误使用固定本地兜底，不根据任意远端文本推断设置动作。

重新检查由用户显式点击并去重，复用启动的 principal/revision、代际、生命周期与超时边界。
成功只提示重新选择练习；不保存/重放场景或 DocTalk 文档。新启动/恢复及身份变化清除旧提示，
迟到响应不能覆盖新意图。恢复仍保留原来的显式“重试恢复”入口，readiness 提示集中展示一次。

## 已验证的本地回归范围

| 测试文件                                                            | 验收范围                                                                                                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/tests/test_health_extended.py`                             | 真实 HTTP 失败结构、基础 health 兼容、依赖覆盖还原                                                                                             |
| `backend/tests/test_readiness_guidance.py`                          | 缺用户/设置、验证、六必填项、catalog、套餐、系统/LiveKit 配置、角色 Mock 隔离、DB 脱敏；解密及 socket 禁用保护                                 |
| `apps/vite-app/src/lib/practiceReadiness.test.ts`                   | 所有白名单分类、设置动作、旧格式/未知码/非 JSON/错误状态码安全兜底                                                                             |
| `apps/vite-app/src/store/conversation.test.ts`                      | 启动/恢复/重查失败零凭据、重查去重、成功无自动开始、DocTalk 不重放、身份 revision、新启动竞争、原生超时和挂起取消；既有启动/恢复保护树继续保留 |
| `apps/vite-app/src/App.test.tsx`                                    | 单次安全提示、设置入口、设置不启动、重查按钮禁用、成功提示、未知错误安全兜底                                                                   |
| `apps/vite-app/src/components/conversation/ActiveSessions.test.tsx` | readiness 失败由共享提示呈现，保留同一记录显式重试，零 Token                                                                                   |
| `apps/vite-app/e2e/readiness-guidance.spec.ts`                      | 真实页面操作 → transport → Fake API，覆盖场景/DocTalk/恢复/重新检查；零下游请求与媒体请求，以及成功后仅新点击才创建                            |

Fake API 故障通过每请求测试 Header 选择固定合成响应，不共享全局故障状态。
浏览器对麦克风安装拒绝式计数探针，不接触真实音频设备；这不等于真机媒体验证。

## 最终组合验收结果

主控 `checks/combined-final-r0/summary.json` 记录完整 frontend10/backend5 及六项组合检查，
共 21 项全部 passed/exit0。以下计数均来自本次最终运行，不将不同批次或新增用例数相加。

| 项目                   | 最终结果                                                        | 命令和证据索引                                    |
| ---------------------- | --------------------------------------------------------------- | ------------------------------------------------- |
| 完整 frontend10        | 全部通过；Vitest 1003、Chromium/WebKit 全 E2E 160               | `01.log`～`10.log`；Vitest `04.log`、E2E `10.log` |
| 完整 backend5          | 全部通过；pytest 644、78.61% coverage、3 warnings；59% 门禁保持 | `11.log`～`15.log`；pytest `15.log`               |
| 组合 actionlint/assets | 均通过                                                          | `16.log`、`17.log`                                |
| 组合探针 Node          | 240 passed，0 failed/skipped/cancelled                          | `18.log`                                          |
| 原生编译输入一致性     | 54 份源/SDK/静态输入与 B 线实际编译输入完全一致                 | `19.log`；绑定 B 产物及输入哈希，未在 A 重编译    |
| 独立 HTTP              | 9 场景通过，零解密、零外网                                      | `20.log`                                          |
| 独立浏览器初始化       | 2 个控制场景通过                                                | `21.log`                                          |

表内日志均相对主 checkout 的
`.review/reports/practice-readiness-20261102/checks/combined-final-r0/`；
summary 绑定各项命令、真实退出码及日志 SHA256，日志头记录 argv/cwd 和输入。

此前删除缺设置拒绝、删除 `readinessOnly` 不创建分支的两项关键变异均被真实断言杀死，
源码已还原；不重复计入上述 21 项。首次失败及修复证据保留在本地评审报告。

## 原生证据与交付边界

组合输入一致性审计确认 B 线已真实编译的 54 份输入与本组合树相同。B 线真实 Rust 57、
无签名 arm64 `.app` 构建及 Mach-O/plist 验证证据继续有效，详见
[探针 CI 验证](./MACOS-PROBE-CI.md)；本次未在 A 重编译，没有运行原生 App。

独立 Review 与提交状态以本轮主控最终报告为准。文档同步时尚未合入 main，未 push/部署，
远端 CI 未运行。真实 IdP/Provider/LiveKit、设备/TCC/媒体及 Linux/Docker 未验证；
配置齐全、合成 API 和离线测试不能证明真实密钥有效或语音链路可用。

本次仅同步新增最终结果，功能代码不变；最终文档格式和字节由主控复核。
本地既有报告/日志保持原样，不纳入 Git；未将历史 A83 计数用于本轮，未融合 next2 候选。
