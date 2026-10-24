# CP-05 设置抽屉键盘与可用视口（A21）

产品`797f8e4`独立APPROVED，契约见[设置可用性](../../CROSS_PLATFORM_SETTINGS_ACCESSIBILITY.md)。设置使用原生dialog模态、打开安全聚焦关闭按钮、禁止背景交互/滚动，支持Tab/ShiftTab、Escape与遮罩关闭及返回原触发控件。内部点击不误关，正常父组件/store重渲染保留草稿、焦点与滚动保护；关闭/卸载清理自有监听/聚焦帧，恢复原滚动样式。顶部关闭可达、主内容独立滚动、动态视口及安全区padding、关键按钮44px点击区域，不隐藏横向溢出来伪造可用。

## 已验证

双浏览器旧基线320x568/667x320/960x720共6观察：无modal、打开焦点在背景、Escape不关闭、关闭按钮28x28；未复现水平溢出。修复后独立七门禁：578产品/25文件、18构建脚本、38默认E2E（Chromium/WebKit各19，保留原22项）。26私有真实双浏览器用例及3项独立资源所有权单测通过；窄屏、横屏、640x480、根字号200%、缩高后滚动/草稿保持、模态背景/焦点恢复/零隐式写覆盖，Chromium窄屏与WebKit大字号截图已人工检视。jsdom模拟dialog仅证明调用与资源生命周期，不当作浏览器模态证据。

SET-01 P1独立复现并关闭：只验证focus不离开dialog会漏掉Save不可达；首轮capture+bubble重复处理同一Tab跳过末控件，disabled fieldset后代又被当成可聚焦而卡住。现单一键盘处理、有效disabled过滤，正反向遍历custom开/关均能到Save；回归已加入产品默认双浏览器测试。两个有效变异分别跳过末控件（4失败）和遗漏滚动锁释放（2失败），恢复原字节/整树指纹后26浏览器用例再次通过。

证据仅本地.review/reports/workflow-settings-a21：baseline.log/截图、approved-source-r1.json、b/review-r1.md、reviewer-r1、private-r1.log、private-ownership-r1.log、mutations及integration-checks/completion.json；最终集成以completion为准。五产品/测试文件，无App/store/API/auth/平台/依赖/原生/后端改动，本轮未跑数据库或iOS sync。

## 工作流与参与边界

skill1c1b68d首次实用：preflight检查首轮12、返工15必读路径，manifest与CLI目录参数同源；公共finding通过专用handoff目录读取成功，无拒权/未知流。两次尝试1105.32账本活动秒，同一会话最后input339521/output62404/total401925，thinking36394/cache5765433单列，不累计重复续跑，也不证明Codex净节省或有效CLI权限覆盖。

评审执行问题已留日志：初次诊断按钮名错误、cwd相对读取失败均修正；早期Playwright复用output目录导致旧失败附属上下文被清理，失败原log和源指纹保留，但不宣称全附属产物留存。变异后每次采用独立artifact目录。以上不自动再扩skill；键盘到达性与焦点封闭应分别判断。

当前不需要用户参与本地开发。后续真实OIDC/LiveKit测试环境需要公开issuer/client_id/回调及环境标识（不索取秘密）；麦克风、锁屏、蓝牙、系统键盘和非零safe-area需设备人工验收；Xcode/签名/上传/发布仍按明确授权边界执行。本轮浏览器resize不冒充真实OS键盘，不宣称三端或全局响应式完成，不push/deploy。
