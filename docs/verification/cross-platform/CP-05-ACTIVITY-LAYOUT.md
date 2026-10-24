# CP-05 活动列表响应式与触控（A22）

产品`9d40cc7`独立APPROVED，契约见[活动列表布局](../../CROSS_PLATFORM_ACTIVITY_LAYOUT.md)。仅ActiveSessions JSX布局和新增activity-layout.spec.ts，render前请求/确认/认证/生命周期逻辑逐字节保持。窄屏分组折行、完整确认UUID可见、按钮至少44x44 CSSpx、焦点样式和正常纵向滚动可达。

## 本地证据

旧基线双浏览器8观察确认320px/200%根字号document约445宽、ID宽0、按钮出屏；普通按钮高度约20–24。独立七门禁通过：578产品/25文件、18构建脚本、56默认E2E（各28，旧38保留）。私有24项中22布局/键盘/结束失败与读取失败呈现通过；恢复失败专用retry按钮2失败在未改A21基线同样复现，不能称24全绿。另两诊断确认原确认仍可显式重试同目标、全局安全错误可见、零Token/写。此既有P2排A23，不在布局增量改业务状态。专用恢复错误按钮的真实呈现/几何待补验。

两有效变异均双浏览器失败：去44px下限实高32/31.984，恢复单行布局产生overflow。恢复原字节和整树指纹后22布局探针再通过；人工检视WebKit320px/200%字号截图。每次Playwright独立output目录，旧失败log与附件保留。

证据仅本地.review/reports/workflow-activity-layout-a22：approved-source-r0.json、b/review-r0.md、reviewer-batch、private-r0.log、baseline-resume.log、recovery-diagnosis.log、mutation-results.json及private-final.log。最终隔离集成见integration-checks/completion.json，不代表当前main已包含。

## 流程与未验范围

最新版skill1c1b68d执行：首轮SUCCESS，无拒权/未知流，1次762.11账本秒。agy最后input217570/output58507/total276077，thinking33886/cache5139528单列，不代表Codex净省额。真实store同步通知暴露mock返回false单测的覆盖盲区，问题记入本地issues.md，本次不再扩通用skill。

真实OS键盘/硬件safe-area/媒体/Provider/Xcode/签名/发布未验，不push/deploy；全局响应式及整体三端计划仍未完成。本轮无依赖、后端或数据库变化，不重复iOS sync。
