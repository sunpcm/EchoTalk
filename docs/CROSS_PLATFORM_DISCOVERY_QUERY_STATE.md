# 活动列表查询事实状态（A20）

## 1. 范围

A19@07990fc之后，仅ActiveSessions.tsx/.test.tsx、i18n/zh-CN.ts可改；usePollingAssessment.ts仅更新过期Web文件头注释，不改变逻辑。不改API/store/auth/platform、依赖锁/后端、Cloud开始门禁和确认操作语义。修复A17遗留：原生pending或后台离线尚未查询时错误显示“暂无活动会话”。

## 2. 查询事实与呈现

“暂无活动会话”只能在当前精确principal/revision的一次有效列表GET成功返回空后显示。初次尚未查询、原生状态pending/失败/后台离线导致零GET、请求被取消或失败，都不能冒充确认空。未查询时显示安全中文状态（如“活动会话尚未查询”），经i18n并提供status可访问语义；GET在途保留既有loading，失败保留既有error/retry，成功非空展示原列表。

查询成功事实只由当前有效GET成功提交；旧身份/旧请求/已作废生命周期的成功不能改变新事实。身份principal/revision变化清除旧查询事实，换号仍零GET时显示尚未查询；同账号后台保留此前真实成功列表/空事实，不因普通重渲染或暂停伪造新成功。查询恢复仍遵循既有只读合并门禁，不新增whenReady并发GET，不自动重放结束/恢复/创建写操作。

## 3. 验收

默认factory+假App路径验证pending/inactive/注册失败零GET且不是empty；active后查询在途loading、成功[]才empty、非空列表正常；初次失败重试；后台取消旧GET晚到[]不得新建空事实，恢复后成功才更新；换issuer/subject/同principal revision与StrictMode迟到隔离；已成功空或非空的同账号后台保留准确事实。保留现有结束/恢复/认证/生命周期产品测试与完整七项门禁。测试不能靠删断言/改API界限变绿。

仅本地Mock和既有浏览器，真实OS/Provider仍未验，无新安装/权限/Xcode/推送部署。
