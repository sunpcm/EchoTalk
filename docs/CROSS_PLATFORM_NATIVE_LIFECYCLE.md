# CP-05 原生生命周期薄适配器（A16）

## 1. 范围与分步

新增统一生命周期工厂和Capacitor iOS App薄适配器，先验证异步就绪/事件归属/释放，再由A17接入Dashboard、分析、启动store和Room。现有Web入口和所有消费者本轮行为保持；不得把已实现适配器当作已接入原生OS。依赖固定@capacitor/app@8.1.2，使用现有Capacitor8.5。本轮不接原生认证/Keychain、真实媒体、后台通话、Tauri原生生命周期或Provider。

## 2. 公共接口与平台边界

保留createWebLifecycleAdapter及现有Web类型/行为兼容。新增createLifecycleAdapter(options?)与LifecycleAdapter：getSnapshot/subscribe/dispose沿用现有snapshot/event语义，capabilities.webEvents/nativeAppState为真实布尔能力；新增whenReady(): Promise<void>供后续异步启动门禁。Web/Tauri/SSR走既有Web适配器（nativeAppState=false，whenReady立即完成），只有明确检测为Capacitor iOS才创建App适配器。可注入平台检测/假App与Web环境做测试；生产默认用真实插件，不靠userAgent或测试假对象冒充原生。Android不在此增量启用原生能力。

测试注入公共名称固定为 `LifecycleOptions { platform?: PlatformType; webOptions?: WebLifecycleOptions; app?: AppStateSource }`。AppStateSource仅需getState(): Promise<{isActive:boolean}>与addListener("appStateChange", callback): Promise<{remove():Promise<void>}>；生产默认源为官方App。LifecycleAdapter导出上述通用接口，不修改现有WebLifecycleAdapter的nativeAppState=false字面类型。

模块导入无监听/请求副作用；每个实例独立所有权，显式创建才初始化，dispose幂等。不得removeAllListeners，不创建全局常驻实例/共享可变owner。listener抛错不妨碍其他listener/清理，每次快照独立复制，通知中unsubscribe/dispose需尊重失效；返回unsubscribe幂等。

## 3. iOS状态、就绪与事件

先安装App.appStateChange监听再读取App.getState，处理异步addListener句柄及getState迟到结果。原生状态未就绪/初始化失败时visibility=hidden，阻止误读/采音，不能以unknown绕过；online沿用Web在线提示（非原生网络保证）。nativeAppState仅在该实例已完成有效监听注册且取得有效原生状态时为true；失败不得继续宣称原生能力。whenReady完成表示初始化已得出成功/失败结果，调用者仍须读snapshot和能力，不是已前台证明。

getState有效isActive=true映射前台，false映射后台；原生前台还需Web不hidden，最终visibility采用保守交集。DOM hidden/pagehide或原生inactive均立即suspend，inactive时DOM pageshow/visibility visible不得恢复。原生active时若DOM仍hidden，直到Web可见再resume；Web online/offline只发connectivity，不覆盖原生后台事实。合并重复有效状态，避免同状态原生/DOM事件重复resume；不能把App.resume（willEnterForeground）当已active。

getState响应只能在没有更新原生事件的情况下生效；新appStateChange（即使同值）优先于早先getState。初始化getState失败且尚无有效新事件时保持关闭；有效事件已建立事实时，旧getState成功/失败不能回滚它。有效已注册listener的新事件可使pending getState不再阻塞whenReady，旧getState永不返回也不阻前台事实推进。注册失败保持关闭、不自动重试或伪造能力；禁止未处理Promise拒绝/原始插件错误泄漏。

## 4. 清理与迟到

dispose后无事件/写入/重新订阅，清理Web订阅及仅本实例原生句柄。addListener的Promise在dispose后才resolve也必须调用该句柄remove一次；拒绝/同步throw和remove失败需吞掉安全处理，不产生未处理拒绝，不影响其他清理。已排队旧callback/getState不得复活已dispose实例或改变其快照；未完成whenReady在dispose后也应结束等待。StrictMode卸载/重新创建实例互不干扰。最后一个subscriber退出可继续维护该显式拥有实例的快照，但dispose必须释放所有资源；不让一个实例删除另一个实例监听。

## 5. 验收和后续接线

假插件deferred+Web事件覆盖平台选择/无导入副作用、初始失败关闭、active/inactive交集、原生后台DOM恢复不越权、getState与事件竞态（包括同值事件/旧拒绝/永久挂起）、异步句柄/注册失败/重复dispose/迟到callback、独立实例/回调抛错/订阅内清理。保留全部质量、产品/构建脚本/双浏览器门禁；本地iOS build+sync由评审固定开发配置执行，审查生成SPM插件发现，不手工编辑生成文件。不得运行Xcode、签名或真实服务。

A17将同步临时Web快照改为统一实例就绪流程，精确认证/session意图在await之后复核，render中不创建异步监听，不因原生恢复自动采音/dispatch/写请求；该后续接线需另立契约、独立评审。整体CP-05仍未完成。
