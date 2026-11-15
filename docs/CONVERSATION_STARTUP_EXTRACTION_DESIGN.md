# H1 会话启动编排抽取设计

> 用户已明确确认方案A并授权实施；实现完成，源码独立APPROVED R0，待发布验证。
> 下文主体保留设计轮冻结事实、历史方案草图及当时的未来计划；“未创建”“未运行”等属于设计时点。
> 冻结源码事实仍为main `1f06b03f8ad2abf8184a6491184f76165c226fd4`，tree `85982b79fd531819ecf0d3536f4719e91bbf06a9`；历史源码链接不变。当前验收见[实施记录](./history/2026-11-15-h1-startup-implementation.md)。

## 1. 推荐与零改动判断

推荐方案A：只把 `createConversationSlice` 内的 `runStartup` 编排搬到同目录新模块 `conversationStartup.ts`，通过延迟调用的窄ports连接原store。保留状态模型/投影、唯一物理store、readiness常驻监听、公共动作包装及resume原业务流。目标是分离启动编排责任，不以行数或消除所有重复为验收。

**判断：`conversation.test.ts` 与 `VoiceInterface.test.tsx` 原文件零改动有条件可达。** 条件是保留原barrel mock路径、公开导出及setter、同步前缀/await边界、依赖读取时点和cleanup所有权。静态调查支持可达，不等于已有实现或保证候选必绿；未来必须对两个冻结文件实际运行。两份旧测试不改，仍须新增同层契约测试，不能把旧测试零改等同不补测试。

两份冻结测试SHA256：

| 原文件                                                              | SHA256                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/vite-app/src/store/conversation.test.ts`                      | `c3075b6495e9b383dbe7c1ba81ede985ee1e32896ed208f813dd6a554d27071c` |
| `apps/vite-app/src/components/conversation/VoiceInterface.test.tsx` | `b7785ac1aead5c8d474d4c08171e7806678fa35e5166f19b9e291a25d8d4ce02` |

## 2. 冻结事实与最小拆分边界

| 现有责任与证据                                                                                                                                                                                                                                                                                                                                                          | 推荐去向                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `ConversationSlice`公共形状及动作，[slice:112–167](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L112-L167)                                                                                                                                                                             | 留原文件，签名、返回值及公开出口不变。                                                        |
| 内部状态/扁平兼容投影、外部setState归一化、同步setSession，[slice:176–244](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L176-L244)、[278–286](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L278-L286) | 留原文件；已有纯模型继续位于conversationState，不另造状态机。                                 |
| `runStartup`，[315–739](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L315-L739)                                                                                                                                                                                                        | 整段编排及其调用级局部变量/回调迁入新模块，保留语句顺序与await边界。                          |
| readiness认证观察者，[288–313](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L288-L313)                                                                                                                                                                                                 | 留在slice闭包，由新编排按原位置调用clear/watch；不能并入启动tracker的短生命周期。             |
| tracker寄存器、测试options/setter、平台判定，[51–76](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L51-L76)                                                                                                                                                                             | 寄存器/options仍由slice原模块持有；tracker结构类型可移至新模块，以type-only引用供resume复用。 |
| `startSession`/`recheckReadiness`包装，[802–815](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L802-L815)                                                                                                                                                                               | 留原文件，原reset/try-finally和await数量不变。                                                |
| `resumeSession`，[817–1252](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L817-L1252)                                                                                                                                                                                                   | 函数体原字节保留，不把它顺手合并进新启动器。仍读写原tracker寄存器。                           |
| end/fail/reset/Room所有权动作，[1254–1403](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L1254-L1403)                                                                                                                                                                                   | 函数体不改，不将结束、Room管理或auth清理搬给新编排器。                                        |
| 唯一物理store/外壳原子补丁，[appStore:17–42](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/appStore.ts#L17-L42)；setState适配，[47–87](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/appStore.ts#L47-L87)                                         | 原文件冻结；不创建第二个Zustand容器或外壳镜像。                                               |
| `conversation` facade及测试setter重导出，[conversation:1–21](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversation.ts#L1-L21)                                                                                                                                                                           | 原文件冻结；与useAppStore保持同一对象身份。                                                   |

resume与start共享去重槽，但resume先验证UUID/origin、查既有会话详情，失败不结束既有会话，并返回boolean；start创建新记录、只对部分当前失败补偿、返回void。resume另有credentialsReady外壳补丁，不能用“重复代码”证明两个流程可合并：[resume入口](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L817-L871)、[详情/token](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L1145-L1249)。

依赖方向仍是 `components → store → lib/platform`。只读data层明确不负责end/resume、Cloud门禁及会话状态机，不能把启动mutation放进data控制器：[data契约§1](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/docs/FRONTEND_DATA_LAYER_CONTRACT.md#L3-L16)、[§4](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/docs/FRONTEND_DATA_LAYER_CONTRACT.md#L53-L80)。不引入shared-core、流程总线或运行时schema服务。

## 3. 原时序与必须保留的门禁

| 顺序         | 当前行为及约束                                                                                                                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 同步入口     | `canStartConversationSession`仅idle允许；清旧readiness监听，读auth/principal/revision，计算targetGen；未认证回dashboard，不发API。[315–344](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L315-L344)                                |
| 同步占槽     | `begin_checking`与sessionGen在同次set提交，随后立即复核gen和auth。store订阅者可能在set中同步reset/换revision；不得先await、创建adapter或读取网络能力。[346–368](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L346-L368)            |
| 适配器建立   | 清旧tracker，创建adapter（原生addListener可同步重入），再复核gen/auth；失效时dispose自己的adapter，不能带着过期上下文发API。[370–401](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L370-L401)                                      |
| 绑定观察者   | 注册tracker、订阅auth/lifecycle，再复核gen/auth。监听仅在启动phase取消；suspend/offline取消，hidden须在isReady后才取消。每次回调重新读store，不缓存“是否启动中”。[403–532](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L403-L532) |
| iOS就绪      | `Promise.race(whenReady,10000ms)`；finally清该轮timer，再核gen/auth和真实snapshot。pending默认hidden不能先行拒绝；只认原生就绪后的状态。[534–578](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L534-L578)                          |
| Web快路      | 不await whenReady；unknown visibility/null online允许，显式hidden/offline拒绝。首个业务await仍在能力查询。[579–606](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L579-L606)                                                        |
| 能力门禁     | getCallCapabilities前后复核；仅`disabled`继续，其他模式不health/create/token；失败保留静态诊断/安全文案。[602–631](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L602-L631)                                                         |
| 健康与只重检 | health前后复核；失败分类为readinessIssue、清场景、建立常驻auth观察。readinessOnly成功发布notice并清旧DocTalk意图，不能create/token或自动重放文档。[633–666](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L633-L666)                |
| 创建/令牌    | `begin_connecting`与外壳patch原子提交并写后复核；create成功后先复核再记录id，随后session_created，再token。token/ws_url非空验证成功才原子提交credentials_ready。[668–726](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L668-L726)  |
| 当前失败     | token抛错或无效凭据时，按原顺序结束已记录的孤儿id；结束前置空局部id去重，失败仅静态日志，不重建/重取/自动重试；补偿await后再次复核，再发布原安全错误。[675–737](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L675-L737)            |

`begin_checking`期间appView仍按原状态保留，不提前切session页；只有begin_connecting调用组合层补丁。setSession的extra回调继续在原Zustand updater内部执行，不能提前算patch、拆成两次set，或把投影移到React effect后补。对应原测试观察creating_session→fetching_token→credentials_ready及原子凭据：[测试512–579](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversation.test.ts#L512-L579)。

## 4. Cleanup与迟到结果的所有权

新模块只拥有每次启动调用的adapter、auth/lifecycle退订句柄、timer、isReady/isDisposed、createdSessionId及补偿函数；持久tracker寄存器由slice通过ports读写，和原resume/reset/end共用，不新增独立注册表。

`cleanup`顺序保留：先标disposed；清自己的timer；调用自己的两个unsubscribe；try/catch dispose自己的adapter；最后仅在寄存器仍等于自己时清空。旧timeout/ready/error不得清新轮槽、令牌或新timer。现有cleanup及判定：[414–430](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L414-L430)、[483–519](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L483-L519)。调用方现有cleanup/null赋值及异常边界原样保留，不借抽取扩大try/catch或“补强”同步重入语义。

平台层负责迟到原生handle的remove，启动器不能再拥有或重复移除native handle；dispose还会resolve whenReady，故“旧Promise已结算”不能被当作当前有效：[lifecycle:267–280](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/platform/lifecycle.ts#L267-L280)、[351–388](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/platform/lifecycle.ts#L351-L388)。真实subscribe当前不立即回放；仍保留原订阅后复核，不假设订阅期间永远无同步影响：[auth:471–479](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/lib/auth.ts#L471-L479)、[lifecycle:328–349](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/platform/lifecycle.ts#L328-L349)。

readiness的auth观察者须在startup tracker cleanup后继续有效，直到下一次启动/reset/goHome清理；不能在runner通用finally里一起清掉。[观察者](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L288-L313)、[reset](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L1366-L1401)。Room资源归RoomSession/UI既有所有者，不因启动器cleanup而直接disconnect或停轨。

**取消与孤儿补偿存在既有差异，不能顺手修：** create返回后先checkOrRelease再记录id，旧轮若已取消会直接返回；token迟到或抛错后也可能在checkOrRelease处返回而不补偿。只有仍属当前启动的失败进入原补偿分支。endSession在无id时只取消本地代际，不声称关闭未知服务端记录：[create/token](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L689-L730)、[end](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L1254-L1293)。

这意味着前端丢弃迟到结果并不证明服务端无孤儿；原请求没有传AbortSignal（尽管API支持可选options）：[API75–118](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/lib/api/sessions.ts#L75-L118)。本设计不新增abort、取消后补偿或重试，也不把所有return改成finally补偿；若要改变须另定产品/幂等边界。原迟到测试只证明不写状态、token不下发，不证明服务端结束：[797–863](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversation.test.ts#L797-L863)。

## 5. 模块接口与副作用分类（未来草图）

仅建议新增 `src/store/conversationStartup.ts` 与同层测试；不新增startup service单例或第二个store。下面类型草图可用于未来实现，当前未创建任何TS文件：

```ts
import type { AuthPrincipal } from "@/lib/auth";
import type { DocContext } from "@/lib/api";
import type { LifecycleAdapter, LifecycleOptions } from "@/platform";
import type { ConversationSessionEvent, ConversationSessionState } from "./conversationState";
type Api = typeof import("@/lib/api");
type Auth = typeof import("@/lib/auth");
type Messages = (typeof import("@/i18n/zh-CN"))["zhCN"]["conversation"];

export interface ActiveStartupTracker {
  readonly gen: number;
  readonly principal: AuthPrincipal;
  readonly revision: number;
  readonly adapter: LifecycleAdapter;
  isDisposed: boolean;
  cleanup(): void;
}
export interface StartupPorts {
  get(): { readonly sessionGen: number; readonly _sessionState: ConversationSessionState };
  emit(event: ConversationSessionEvent, extra?: () => object): void;
  readTracker(): ActiveStartupTracker | null;
  writeTracker(value: ActiveStartupTracker | null): void;
  clearReadinessWatch(): void;
  watchReadinessAuth(principal: AuthPrincipal, revision: number, gen: number): void;
  auth: Pick<
    Auth,
    "getAuthSnapshot" | "getAuthRevision" | "arePrincipalsEqual" | "subscribeAuthSnapshot"
  >;
  getLifecycleOptions(): LifecycleOptions | null;
  createLifecycleAdapter(options?: LifecycleOptions): LifecycleAdapter;
  isNativeIos(): boolean;
  api: Pick<
    Api,
    "getCallCapabilities" | "checkHealthReady" | "createSession" | "getSessionToken" | "endSession"
  >;
  beginConnectingPatch(): object;
  startupClosedPatch(): object;
  classifyPracticeReadiness: typeof import("@/lib/practiceReadiness").classifyPracticeReadiness;
  resolveStartErrorMessage(error: unknown): string;
  messages(): Messages;
}
export declare function createConversationStartup(
  ports: StartupPorts,
): (mode: string, docContext?: DocContext, readinessOnly?: boolean) => Promise<void>;
```

新模块可以运行时引用现有conversationState的纯判定/凭据构造，其他上游类型使用type-only；不反向import conversationSlice/appStore/components，防循环与隐藏第二容器。slice构造ports时只建立普通闭包，不能调用实时依赖；factory只返回携带ports的原async runStartup，构造时不读auth/options、不发API、不注册监听。真实动作调用后才执行副作用。

关键接线示意（在原slice闭包内，省略接口其余同类转发）：

```ts
const runStartup = createConversationStartup({
  get,
  emit: (event, extra) => setSession(event, extra),
  readTracker: () => currentStartupTracker,
  writeTracker: (value) => {
    currentStartupTracker = value;
  },
  getLifecycleOptions: () => testingLifecycleOptions,
  createLifecycleAdapter: (options) => createLifecycleAdapter(options),
  isNativeIos: () => isNativeIos(testingLifecycleOptions),
  api: {
    getCallCapabilities: () => getCallCapabilities(),
    checkHealthReady: () => checkHealthReady(),
    createSession: (mode, doc) => createSession(mode, doc),
    getSessionToken: (id) => getSessionToken(id),
    endSession: (id) => apiEndSession(id),
  },
  // auth/patch/watch/messages等按同一原则延迟转发；不是运行时代码补丁。
});
```

此示意为部分接线，不是可直接运行的完整候选。不得给转发器加async、Promise.resolve、then、queueMicrotask或动态import；原startSession/recheckReadiness的await包装不变。用直接返回的原async函数保持Web同步前缀、原生首个await及每次外部Promise结算的microtask顺序。API依旧传原参数数量：create(mode,doc)、token(id)不带owner、end(id)，不额外传undefined/options或AbortSignal。

| 分类            | 具体责任                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 纯变换          | 已有conversationState的reduce/project/canStart与凭据形状构造，在给定输入上返回值；复用，不为本轮另拆更多纯函数。[模型入口](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationState.ts#L140-L150)、[判定](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationState.ts#L343-L353) |
| 同步副作用/读取 | emit/Zustand订阅通知、当前auth/gen/options/平台读取、tracker寄存器、coordinator补丁调用。setSession内部reduce虽纯，setSession整体并非纯函数。                                                                                                                                                                                                                                                                        |
| 异步副作用      | API、原生whenReady、timer/race、订阅/退订、dispose、孤儿补偿及静态console日志。runStartup即使注入ports仍是副作用编排。                                                                                                                                                                                                                                                                                               |
| 留原位置的辅助  | isNativeIos可检测环境；resolveStartErrorMessage读ApiError/i18n绑定；不把它们宣传成与环境无关的纯函数。通过延迟闭包复用，不新增分类策略。                                                                                                                                                                                                                                                                             |

## 6. 两份旧测试零改的证据与限制

conversation测试通过appStore读动作、从conversation重导出setter，mock既有`@/lib/api`/`@/lib/auth`路径；每次beforeEach在store已创建后改mock与options：[测试1–61](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversation.test.ts#L1-L61)。因此新模块不能绕过barrel直接import api/sessions，也不能捕获初始mock实现。

Voice测试mock的API只含dispatch/end/health/create/token，没有getCallCapabilities或ApiError；它们在不走启动的用例中原本不会读取。若新factory初始化时枚举API namespace、解构保存函数/class或执行getters，就可能破坏这些原用例，不能要求补旧mock：[Voice测试195–219](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/components/conversation/VoiceInterface.test.tsx#L195-L219)。必须用上节的延迟转发；类型查询不产生运行时读取。

动态读取要求：

- 保留setter在slice及conversation重导出；`testingLifecycleOptions`在创建adapter时、判iOS时分别按原点读取，不能在factory构造时或整个启动开始时统一快照。同步adapter回调可能改选项；不增加“同一轮选项永不变”的新契约。[slice51–76](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L51-L76)、[378](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L378)、[534](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L534)
- API/auth/platform/coordinator方法按原调用点解析；不能缓存authSnapshot、revision、get()返回值、bound API方法或fake timer函数。Voice平台mock会在beforeEach重置，仍通过原barrel调用：[298–347](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/components/conversation/VoiceInterface.test.tsx#L298-L347)。
- tracker/options本来是slice模块级，readiness watcher本来是slice实例闭包；保留作用域，不能为了测试方便改成每个runner独立生产tracker。原生产只有一个物理store，不据此承诺任意多store实例互不影响。
- 同步订阅者可取消/换auth，native addListener可重入start/resume；两次写后复核仍在原点。旧START-01验证安全释放与零业务API，新同层测试还须断言adapter未创建，不能把旧测试通过误当早期副作用顺序已锁住：[START-01](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversation.test.ts#L3578-L3618)、[START-02](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversation.test.ts#L3665-L3798)。

保持VoiceInterface/RoomSession/roomAudio及其导出不变，phase与Room key也不变：[Voice入口](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/components/conversation/VoiceInterface.tsx#L6-L69)。原setState夹具经appStore原归一化路径继续有效，不能改测试去直接制造内部runner状态。[原渲染测试](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/components/conversation/VoiceInterface.test.tsx#L505-L601)

所以“可达”仅对方案A及上述边界成立。若未来实现只能靠改两个旧测试、扩大mock或新增await才能过，应停下回到设计边界，不删弱断言；新增独立测试不能替换两份冻结原文件的运行证明。

## 7. 未来实施范围、契约测试与变异计划

未来最小代码白名单：修改 `src/store/conversationSlice.ts`（runStartup替换接线、tracker类型引用），新增 `src/store/conversationStartup.ts` 和 `src/store/conversationStartup.test.ts`。resume及其他动作函数体保留；appStore/conversation facade、conversationState、UI、API/platform/auth、配置/生成物/依赖锁、全部旧测试及E2E保持原字节。文档收口另按实测更新，不因本设计自动获得源码写权限。

新增同层契约测试必须走真实runner及一组实际slice接线，不mock掉runStartup：构造时零依赖读取、调用时同步占槽、调用后更换mock/options仍有效；写后auth变化前不创建adapter；native pending/10秒及Web无额外microtask；API顺序/disabled门禁/readinessOnly；正常成功不end、token失败只补偿一次；旧轮迟到结算不污染新轮、旧timer/cleanup不释放新资源；readiness watcher在启动cleanup后仍生效。至少一组用实际slice+原barrel mocks核接线，不能只测手造ports自洽。

以下均为**未来计划、未运行**。未来候选冻结后应补候选实际行号；此处位置以未来模块职责及对应基线定位，不能伪造尚不存在文件的行号。

| 未来变更位置（对应基线）与单点变异                                                                                                                                                                      | 明确目标断言                                                                                                                                                                                                                                                                       | 恢复与证据要求                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 新runner的写后auth复核，删除[359–367](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L359-L367)对应分支                  | 新`post-set auth change must not construct adapter`：set通知仅改revision，期待adapter创建0、能力0、idle；删除后即使后续门禁仍挡API，adapter0断言必须RED。旧START-01可能不足，不能只依赖它。                                                                                        | 自有副本备份该文件；finally逐字节恢复；目标断言RED后恢复GREEN。 |
| 新runner的readinessOnly，删除[655–665](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L655-L665)提前返回                 | 原`readiness failure drops DocTalk intent...`中的`expectNoCredentials`要求create/token零调用；[测试87–106](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversation.test.ts#L87-L106)。                               | 同上，不把后续mock错误当目标命中，以create零调用断言为准。      |
| 新runner的当前token失败补偿，删除[729](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L727-L737)的endOrphanedSession调用 | 原`ends the just-created session when the token request fails...`：`expect(api.endSession).toHaveBeenCalledTimes(1)`及目标id，[701–722](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversation.test.ts#L701-L722)。 | 同上，恢复后成功不补偿的控制例也通过；不改取消后的补偿口径。    |
| 新runner的native timer，将[10000ms](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L538-L542)改为9999ms                  | 原`times out after 10 seconds...`在9999ms仍checking_health的断言RED，[3128–3153](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversation.test.ts#L3128-L3153)。                                                      | 同上；有限时间的精确断言失败，不用删除timer制造全局timeout。    |
| 新runner/slice接线将options在factory时缓存（对应[378/534](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/apps/vite-app/src/store/conversationSlice.ts#L378)）         | 新`reads lifecycle options at original call sites`：构造后setter改ios/pending，创建参数必须新options、能力查询0；另有构造时getOptions零调用断言。                                                                                                                                  | 同上；必须真实接线命中，不能让不完整mock初始化异常充当有效RED。 |

至少3处非等价变异须实际命中目标断言；解析/类型错误、无关测试失败、全局超时不算。所有变异只在执行者自有临时副本，正式lane不变异；成功、首失败与恢复回执均保留，不删除原失败。

未来验收由Harness在获准环境经ev执行：apps/vite-app内`pnpm test`、`pnpm test:e2e`（双浏览器）、backend内`.venv/bin/python -m pytest --cov=. --cov-report=term-missing`，以及根`pnpm format:check`、`pnpm exec turbo run lint --force`、`pnpm exec turbo run typecheck --force`、`pnpm exec turbo run build --force`，API/Fake/构建runner、后端Ruff及真实OpenAPI/Provider/G3生成漂移检查。解释器、专用PG身份和命令以[评审手册§2/§3](https://github.com/sunpcm/EchoTalk/blob/1f06b03f8ad2abf8184a6491184f76165c226fd4/docs/agent-review-loop.md#L20-L108)及当轮受控runner为准，不借旧lane环境、取应用库凭据或执行迁移。本轮实施方只做MD格式/静态范围，未执行上述测试或变异。

## 8. 替代方案、观察与确认门禁

- A（推荐）：只抽runStartup，保留resume与原所有权。新增一个编排模块/一个同层测试，代价是保留部分重复及ports接线；最容易维持原测试与同步语义。
- B：同时把start/resume的生命周期准备做通用runner。可减少重复，但origin验证、返回值、详情查询、补偿及外壳补丁不同，需要更大的兼容矩阵；本轮不推荐。
- C：把副作用改为状态机事件解释器/队列。可能便于扩展，但新增调度边界、取消/重试策略和全量测试迁移，超出H1保行为抽取。

计划外观察：迟到create/token取消路径不证明服务端记录已关闭；全局tracker的作用域与cleanup既有异常/重入边界不能悄悄改；readinessOnly的包装finally也不作统一重写。真实Provider/LiveKit/IdP、设备、取消的传输语义与服务端幂等未验，现有Room权限问题不因本设计解决。B2学习事件、I1评估提供方及活动会话挂载快照问题各守原独立门禁。

用户已明确确认方案A并授权实施，真实factory及slice接线已完成，源码独立APPROVED R0。两份旧测试原字节保全，新同层契约测试15条、Harness四项有效私有变异均已验证；机械AST映射仅证明受控替换下结构一致，不替代运行时与外部依赖验收。本机基础门禁14/15，完整E2E首次233/1、唯一完整重放仍233/1，均theme-storage:24期望warm实收cool，根因未明，本轮不修主题。Linux CI/Guard与发布待对应实际回执，不宣称全部门禁通过。实施来源、首失败和未验证边界见[实施记录](./history/2026-11-15-h1-startup-implementation.md)；I1/B2等其他工作包不由本次收口开工。
