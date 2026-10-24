# CP-05 原生启动与显式恢复就绪门禁（A18）

## 1. 范围

在A17@0cda77b之后仅修改conversation.ts、conversation.test.ts及zh-CN.ts，startSession/resumeSession使用统一createLifecycleAdapter。保持公共签名/现有状态枚举/返回值、严格origin与Cloud能力门禁；不改UI组件、平台实现、API/auth/后端、依赖/锁。Room采音与SDK回调原生中断另列A19，不声称本增量已覆盖连接后音轨。

## 2. 意图与资源所有权

输入/UUID与精确认证principal(issuer+subject)/revision检查通过后，先保留共享启动槽位（checking_health与新sessionGen），建立本次意图独有tracker及生命周期/auth取消，再等待adapter.whenReady。等待中零capabilities/detail/health/create/token/dispatch/end请求，不把初始native hidden当已知后台而立刻永久拒绝；真正就绪后才读snapshot。Web适配器立即就绪且unknown/null保持兼容，显式Web hidden/offline不得开始或恢复。

每个tracker独立持有auth/lifecycle订阅、adapter、就绪等待和timer；cleanup幂等，作废本意图、释放自己的资源，结束挂起等待。先保留去重槽位，再允许异步操作或同步通知，防双击/同步store subscriber重入创建两次。setup/cleanup与set通知都可能同步换号、goHome、reset、end或开启新意图，必须按本意图gen及tracker身份隔离；旧setup、ready、错误、timer/finally不得清理新tracker/槽位、写新状态或继续外部请求。

## 3. 就绪与退出

仅原生状态就绪等待最多10秒；超过时安全退出并清理资源，返回idle/dashboard、清Token/URL、显示统一安全文案，允许用户显式重试。该上限不涉及外部agy CLI、已就绪后的API请求或后台通话。若Web立即就绪不引入等待；取消/早就绪/失败必须clear timer，旧timeout不得影响新操作，计时不自动重试或放行未知状态。文案经zh-CN的conversation.lifecycleUnavailable（建议“应用状态暂不可用，请回到前台后重试”），不回显插件原始错误/凭据。

whenReady完成后及所有外部请求/状态提交前独立核验本意图仍当前、认证精确principal/revision、snapshot.visibility非hidden且online非false。原生初始化失败/后台、Web隐藏/离线均关闭，不继续API。原生suspend/离线、auth失效/goHome/reset/end等在等待或后续capabilities/detail/health/create/token期间立即作废并释放槽位，不等旧promise；新显式操作可推进。初始化pending只阻读，不发送任何自动写；有效前台/online仅更新事实，不能自动重放已取消start/resume。

## 4. 既有行为保持

start仍capabilities→disabled门禁→health→create→token，resume仍capabilities→active详情→health→token，后者不create/dispatch/lease。写前及每await后复验，包括set连接状态或保存sessionId的同步订阅通知后不得继续token。Token成功发布原子归属，旧token不能写回；已有end POST去重/reset代际、dispatch标记/failConnection不弱化。取消无ID时不伪称服务端已结束已在途create；不为本地取消新增end POST，不自动补偿未知服务端状态。

## 5. 最小时序验收

默认真实factory+假App事件：初始注册/状态pending时API零调用，active后同意图只推进一次；inactive/注册失败/初次读失败关闭，可显式再次操作；等待10秒退出/清理后新意图成功；等待中双击、认证issuer/subject/同principal revision、goHome/reset/end、StrictMode式取消/重启；旧ready/reject/timeout与新在途交错不影响新槽位；query调用前后native事件，capabilities/detail/health/create/token迟到成功/失败隔离。写前同步set取消和原生后台/离线取消，旧永挂不阻新操作；后续active零自动写。保留全部旧产品回归、质量与双浏览器七门禁，不以零测试或Mock替代真实OS。

用户持续推进授权保持，无新安装/模型/权限；不push/部署、Xcode/签名、真实Provider/IdP或设备操作。最终设备与已连接Room仍未验。
