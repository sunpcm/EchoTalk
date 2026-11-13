# EchoTalk 第二批架构工作：F1–F4、H2、G1、I2 云端独立复核

> 本文件经用户本轮明确授权提交至仓库，供云端 Agent 直接读取；原始本地日志仍按原约定保存。
> 本文件所在的资料提交仅增加复核输入，不属于下面冻结的七包实现范围。复核代码时必须使用
> `c5675c1ce5787a34a40d87021bc10b4d411cc65f..58254b98d8dcd6a81982ebe0436f6742fa4a974a`，
> 不得将资料提交或浮动 main 作为代码终点。

你是独立架构评审方。始终用中文。只评审这一冻结范围，不实施修复、不提交、不推送、不合并、不部署。实施、Harness 独立评审和 CI 已完成，但本材料的结论均是待核验声明，不能代替你的判断。

## 1. 冻结范围与权威来源

- 仓库：`sunpcm/EchoTalk`。
- 比较基线：`c5675c1ce5787a34a40d87021bc10b4d411cc65f`。
- 冻结终点：`58254b98d8dcd6a81982ebe0436f6742fa4a974a`。
- 预期终点 tree：`86f4d99880ca41bb0c497ce682efaec3e66e64c7`。
- 比较命令：`git diff --stat c5675c1ce5787a34a40d87021bc10b4d411cc65f 58254b98d8dcd6a81982ebe0436f6742fa4a974a`，`git log --reverse --oneline c5675c1ce5787a34a40d87021bc10b4d411cc65f..58254b98d8dcd6a81982ebe0436f6742fa4a974a`；应只有下表七个 squash 提交。
- 身份校验：`git rev-parse 58254b98d8dcd6a81982ebe0436f6742fa4a974a^{tree}` 必须精确等于上述 tree。不得把当前浮动 main 代入终点。开工先看 main 是否又前进，若有先读新增提交并单列记录，保持本次冻结范围不变。
- 七包均单独实施分支/PR、Harness 独立评审 APPROVED、最终 source head 六项检查成功后 squash。每包 source tree、CI 临时 merge tree、squash tree 均已精确核对相等，请独立复核。

先读（前者优先）：`AGENTS.md` → `docs/ARCHITECTURE_ROADMAP.md`（§2、§7 硬约束）→ 基线 `TODO.md` 中第二批 F/G/H/I 的原验收、终点 `docs/history/todo-done.md` 中七包归档 → `docs/FRONTEND_DATA_LAYER_CONTRACT.md`、`docs/LEARNING_EVENTS_DESIGN.md` → `docs/PROJECT_STATUS.md` → `docs/agent-review-loop.md` §20（云端）。需现状时查 `docs/ARCHITECTURE.md`。prompt 是指令，不是事实依据；文档冲突、产品口径或已上线行为与契约不符时，列原文/代码证据并停止，不自行选边。

## 2. PR、最终 source head、合并提交、tree 与最终 CI

所有 SHA 是完整值，链接均可直接访问。CI 是回读 Linux 执行结果，不冒认为 Harness 亲跑；PR Guard 单独列出。

| 包  | PR                                                  | 最终 source head                           | squash main                                | 预期 tree                                  | CI                                                                         | PR Guard                                                                   |
| --- | --------------------------------------------------- | ------------------------------------------ | ------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| F1  | [#158](https://github.com/sunpcm/EchoTalk/pull/158) | `82447c747a2d7e90b11ddb1cf94073183a676284` | `7b300b02f2ff9d28f5b6e1dd13cd258e5028c3fb` | `1f86e32cfa2088c6aa38160263abad9f46e00035` | [43360032607](https://github.com/sunpcm/EchoTalk/actions/runs/43360032607) | [43360032589](https://github.com/sunpcm/EchoTalk/actions/runs/43360032589) |
| F2  | [#159](https://github.com/sunpcm/EchoTalk/pull/159) | `26787c3e6f118ecd036215ef20db3abdf55803ed` | `38c4a69ca33a48cead69f60edcdbb4b391626ea3` | `3d26d7c1bdef67abf7c3b50ae934916606e68848` | [43366625704](https://github.com/sunpcm/EchoTalk/actions/runs/43366625704) | [43366625968](https://github.com/sunpcm/EchoTalk/actions/runs/43366625968) |
| F3  | [#160](https://github.com/sunpcm/EchoTalk/pull/160) | `dca99edfecdbcc4600cb6c34a58207e3e7847c58` | `3827861a271202eee26dec16057e10b27f745081` | `31a2874e4b738f63b8ee9244b9c13112ee3bf2f4` | [43372070616](https://github.com/sunpcm/EchoTalk/actions/runs/43372070616) | [43372070672](https://github.com/sunpcm/EchoTalk/actions/runs/43372070672) |
| F4  | [#161](https://github.com/sunpcm/EchoTalk/pull/161) | `3c794ebdefc3fe8c1762c5ade51a017bb4fc5d6d` | `0aa7d52b99bbcb06dedcae664d74994dc01b4f7a` | `388c6f06bab2237ab3d1e349c82314583d9d1d29` | [43403508490](https://github.com/sunpcm/EchoTalk/actions/runs/43403508490) | [43403508536](https://github.com/sunpcm/EchoTalk/actions/runs/43403508536) |
| H2  | [#162](https://github.com/sunpcm/EchoTalk/pull/162) | `61e7cf0ed8d614695e06ffca1178003ac6dd9759` | `714e1665c4e86fcda0525fdeffe5ef9a461fb447` | `77c28119ac67e828bfabc9621ff0c30fe1b78e2b` | [43422540225](https://github.com/sunpcm/EchoTalk/actions/runs/43422540225) | [43422540273](https://github.com/sunpcm/EchoTalk/actions/runs/43422540273) |
| G1  | [#163](https://github.com/sunpcm/EchoTalk/pull/163) | `f1bff3431d69c486768c914e3babd565ec8fb284` | `ce82ea3b8c542b3cd8a1afbe7cf27950cd364cad` | `58c9ab9e0e62ac04db610b7ed9f8c7553730992c` | [43428362306](https://github.com/sunpcm/EchoTalk/actions/runs/43428362306) | [43428362337](https://github.com/sunpcm/EchoTalk/actions/runs/43428362337) |
| I2  | [#164](https://github.com/sunpcm/EchoTalk/pull/164) | `dc4fb2602fa2aa9456087017c772647867128252` | `58254b98d8dcd6a81982ebe0436f6742fa4a974a` | `86f4d99880ca41bb0c497ce682efaec3e66e64c7` | [43439468324](https://github.com/sunpcm/EchoTalk/actions/runs/43439468324) | [43439468312](https://github.com/sunpcm/EchoTalk/actions/runs/43439468312) |

另已逐项回读 squash 提交自身的 push CI（以下仅报告运行状态；下方各项测试数字和原文来自上表 PR CI，不冒认读取了 push CI 全部日志）：

| 包  | main push CI                                                               | 状态                |
| --- | -------------------------------------------------------------------------- | ------------------- |
| F1  | [43361021946](https://github.com/sunpcm/EchoTalk/actions/runs/43361021946) | completed / success |
| F2  | [43367760782](https://github.com/sunpcm/EchoTalk/actions/runs/43367760782) | completed / success |
| F3  | [43372821096](https://github.com/sunpcm/EchoTalk/actions/runs/43372821096) | completed / success |
| F4  | [43405022315](https://github.com/sunpcm/EchoTalk/actions/runs/43405022315) | completed / success |
| H2  | [43423933865](https://github.com/sunpcm/EchoTalk/actions/runs/43423933865) | completed / success |
| G1  | [43429809898](https://github.com/sunpcm/EchoTalk/actions/runs/43429809898) | completed / success |
| I2  | [43441014970](https://github.com/sunpcm/EchoTalk/actions/runs/43441014970) | completed / success |

## 3. 逐包复核重点

1. **F1**：新增 data 层直接契约测试，生产代码和既有测试零改。R0 11 项测试不能独立证明 lifecycle/context 门禁且缺 more 槽；R1 扩到 18 项，单因素矩阵和真实午夜边界，并独立完成 19 项有效变异。检查每项必须由新增目标断言抓到，而非解析错误/无关失败。完整 19 行“原行→变异→目标断言→恢复”在附录 F1。
2. **F2**：修正 E2E response JSON 生命周期竞态。检查 3 用例 27 个 expect 链只做 awaited getter 归一化后等价，非放宽断言；完整压力 300/300（每用例每浏览器50次、4 workers、retry0）。首次单 worker 55 passed/1 interrupted/244未运行、exit130，不计通过。R1 重点补全首失败与曾删除/复用证据 ID 的披露，恢复的是原生工具回执文字，不冒称被删原文件/hash。未做产品变异。
3. **F3**：状态页169→73行（当包终点）、四类事实，过程移入 history；113旧行按块字节保全；前端数据契约 §2–10 不变。检查 TODO 归档、Markdown 链接/锚点。坏路径/锚点两项是辅助门禁负例，不是产品变异。
4. **F4**：只读 conversation facade 用 Omit 隐藏内部 resetWithShellCoordination；replace=true 时保全内部方法，显式传入时不覆盖。旧导航/会话测试零改，新3项runtime+6项编译负断言。R1 只纠正触发旧源码扫描断言的注释和6个类型断言导出；没有改运行时逻辑，S1/S2重跑范围按附录保留。3项有效变异中目标 TS2578 表示 @ts-expect-error 失效，属于类型负断言，不是解析错误。
5. **H2**：API 1039行拆为6文件，81声明 AST/71公开名字保持，request/cache单例，全部 `from "@/lib/api"` 调用方和 api.test.ts 的192用例逐字节不变。R0整树 E2E225/9 暴露两处 route 正则误拦截新 Vite 模块；R1只将两个既有 E2E matcher 限到 URL.pathname 的 `/api/` 路径边界，断言/标题/mock主体 AST 不变。此两处是有证据的必要范围扩展，不能说全E2E文件零改。2个 AST/公开面负例是辅助门禁，不是产品变异。
6. **G1**：四个成功响应补基本必填 str/bool response_model、OpenAPI及TypeScript生成物，Fake API未建模成功响应例外4→0；新增4参数契约用例。58旧pytest文件、路由函数体/参数/auth/status、旧DTO AST不变；还原4ref及删4model后OpenAPI结构等于基线。4个合法JSON类型变异均由对应新增断言捕获，逐项恢复后4/4 GREEN。G2的5个缺失operation和200/201偏差未动；ready值的既有差异未收窄为枚举或改行为。
7. **I2**：检查领取/成功/可重试失败/耗尽/陈旧恢复结构化日志的字段与脱敏，以及首次非重试终止分类；字段必须在默认 worker formatter 下真实可见。尤其核对事务提交后才输出，异常/取消不产生伪成功；日志故障不让已提交成功进入失败/重试；并发任务隔离；不读已关闭ORM；不改重试/锁/事务/停止取消行为。只读快照计所有pending（含延迟重试），最老等待从created_at按UTC计算，空0/0、未来时间不负数，单个聚合SELECT/no_autoflush/无锁无写入。59旧pytest文件一行不动，新增能力同轮直接契约测试。具体计数、事件名、修订与验证见附录 I2。

## 4. 验证规则与证据解读

- **亲跑与 CI 分开**：各附录的“本机/Harness/macOS”由 Harness 在独立评审副本亲跑；“Linux/CI”由 Harness 亲读 CI 作业日志后回录，实际执行者是 GitHub Actions。实施者自测另计。
- **首失败保留**：F1起点/S0各233/1；R1首次231/3，额外session-start/theme两个用例双浏览器定向重放4/4。F2完整压力前有55/1中断；F4首轮1226/1和lint6error；H2首轮225/9，修后233/1。其余格式/沙箱/辅助门禁首失败见各附录，均不被后续通过覆盖。
- **本机持续差异**：macOS arm64最终完整 E2E 常为233/1（Chromium117/0、WebKit116/1），既有 Provider 控件336×23px，不能因Linux234/234宣称本机全绿。F1还有一次theme防抖失败、重放通过但根因未确认。
- **重试**：本机明确retries0；Linux CI配置retries2，但各最终run实际retry/skip/flaky均0。不要把允许2次重试写成实际用了2次。
- 所有数字、pytest warnings与精确覆盖率、Fake108/类型生成器8/构建脚本21、浏览器分项及关键日志**原文中段**，均直接嵌在下方各包附录。无需下载完整CI日志，也无需访问本地 `.review/`。附录原报告中如出现本地路径，仅作原始溯源说明，不是云端输入依赖。
- 附录保留当轮S0/S1/S2措辞；当前已合并状态与冻结身份以上方冻结表和完整SHA为准。不得把某轮“未重跑”改成亲跑通过，也不得用其他包的执行冒认本包执行。

云端应亲自跑 Vitest、Playwright E2E、backend pytest 及变更相关生成/格式/lint/typecheck/build门禁，按手册 §20 使用环境内专用 PostgreSQL15.19 合成库。不可读取/写入 `.env`，不可连应用/QA/生产或本机其他lane库，不可调用真实Provider/LiveKit/IdP。已有环境缺失或依赖未获授权，写“未运行+原因/阻断”，skip、缓存结果、占位任务不算通过。不得为了复核自行执行未授权DDL/迁移、安装新依赖或改变锁文件。不要把本文中的本机专用容器名/回环端口硬套到云端。

可在自己拥有的临时副本复验变异，先磁盘备份，finally逐字节恢复，再GREEN；绝不在源分支直接变异。F1 19项、F4 3项、G1 4项、I2 7项，共33项是产品/产物目标变异，F3/H2辅助门禁负例另列，未做变异的包必须明说，不以等价变异、解析错误或无关失败充数。

## 5. 计划外变更与遗留观察

- H2 两处E2E URL matcher修正是在首次整树225/9中确认8项新增误拦截后的必要适配，另1项是既有尺寸问题；严格保留断言与mock含义。
- F4 state replace保全内部协调方法是隐藏门面方法时保持已有store替换语义所必需；显式custom引用须保留。
- F1theme防抖一次失败尚未确认根因；保留观察，没有顺手修复。F2旧证据曾删除/ID复用的过程瑕疵和恢复边界按附录披露。
- G1未改变G2状态码口径或缺失operation；I2只做最小观测，不扩为指标平台、事件总线、学习事件表或新HTTP端点。其他实际偏差在 I2 附录单列。

## 6. 未验证与禁止扩大范围

真实LiveKit/Provider/IdP、iOS/macOS设备、Docker整栈、QA/预发布/生产部署均未验证；iOS无签名build、macOS静态probe CI通过不能替代设备验收。I2生产日志采集、集中告警和真实队列运维效果未验，不宣称风险全消除。

不继续G2；G2开工前必须核对真实POST /api/sessions状态，契约/后端/Fake不一致时交用户裁定。不开展G3/H1/I1实现（设计轮也需另行授权），不开展B2学习事件表、阶段C预发布，或R2中等设备/真实环境/产品裁定的事项。B2历史数据无法补录，仍有时效性，但不是本次评审的实施授权。

## 7. 交付要求

只交独立评审报告，不修复：

- 写明实际比较基线、终点、tree与当前main增量，七PR/head/CI身份核验结果。
- 按P0/P1/P2列可行动问题；每条包括代码file:line、权威契约/验收、事实、差距与影响，不引用prompt当事实。
- 对七包逐条验收、测试零改约束、计划外变更、受控变异是否目标断言、旧失败是否完整保留逐项结论。
- 亲跑/CI回读分别列表，逐条命令、计数/浏览器、warnings、覆盖率、首失败与重放、未运行及原因；不要只列最终绿。
- **实现结论**：APPROVED 或 CHANGES REQUESTED；**验证状态**单独给出（通过/有既有失败/需补测试/环境阻断），不要把它们合成一个结论。
- 计划外变更与未验证事项各列一节，需用户裁定项另列，未发现则写“无”。

下面附录是各PR最终技术说明与CI关键原文的完整嵌入，随本文件提供；不依赖本机私有日志。

---

# 附录 F1：PR #158 最终技术说明及证据

第一批新增的 data 层行为缺少直接契约测试，原组件测试通过时仍能把这些能力改坏。本 PR 仅新增 `readonly-query-f1.test.ts` 的18项测试，并同步 F1 待办归档与验证基线；生产代码、既有测试、依赖和数据库结构均无改动。

## 范围与冻结

- Base: `c5675c1ce5787a34a40d87021bc10b4d411cc65f`
- Final head: `82447c747a2d7e90b11ddb1cf94073183a676284`
- Expected head tree: `1f86e32cfa2088c6aa38160263abad9f46e00035`
- 新测试703行，SHA256 `272bfd8d8f9fd8db25387c64b9d9dded2e8f9600da37f7f26c92e0101f78d9c2`。
- R0为CHANGES REQUESTED：混合漂移不能分别证明门禁，且缺more槽覆盖。R1补齐单因素primary/more矩阵，并采用真实日期窗口验证午夜+99/+100ms边界。独立最终结论：APPROVED（Harness亲自独立评审，R0问题已关闭）。

## 验收对照

1. discard保留seq/principal/revision门禁，忽略lifecycle/context漂移；revalidate对照及primary/more分支分别覆盖（M01–M10）。
2. clearCursorOnFirstPage在首页开始清cursor，失败/取消后仍为空，loadMore不发请求（M11）。
3. 取消more保留cursor且同cursor可重试，取消primary保留items，迟到结果不写回（M06/M10/M12/M13）。
4. 真实DP hook的override最新覆盖与午夜+100ms（M14/M15）。
5. 真实WP hook按大小写不敏感ID去重（M16）。
6. 真实AS hook仅首屏成功提交queriedIdentity，more成功/取消不提交（M17–M19）。

## 本机验证：Harness亲跑，macOS arm64

| 快照            | Vitest      | pytest                  | E2E首次（Chromium / WebKit） |
| --------------- | ----------- | ----------------------- | ---------------------------- |
| 干净起点c5675c1 | 1206/49文件 | 809，3 warnings，80.19% | 233/1（117/0；116/1）        |
| S0/R0新测试11项 | 1217/50文件 | 809，3 warnings，80.19% | 233/1（117/0；116/1）        |
| S1/R1新测试18项 | 1224/50文件 | 809，3 warnings，80.19% | 231/3（115/2；116/1）        |

以上E2E均retries0、skip0。S1首次三个失败：既有WebKit Provider select 336×23px；F2的`response.json: Test ended`；theme-sync:58预期1次PUT实得2次。随后同一S1快照、单worker定向重放session-start与theme-sync各双浏览器，共4/4通过。首次失败原样保留；主题根因尚未确认，本包不修改，本机全量不计全绿。

S1另亲跑Fake API108、API类型生成器8、构建脚本21；format、force lint/typecheck/build、API/OpenAPI/Provider漂移与Ruff门禁通过。lint原有132 warnings、0 error。干净起点的Fake API首次sandbox listen EPERM导致108 cancelled；权限重跑108通过，首次不计通过。

实际执行均经固定ev入口与隔离检查器：

- apps/vite-app：`pnpm test`、`pnpm test:fake-api`、`pnpm test:api-types`、`pnpm test:build`、`pnpm check:api-types`。
- apps/vite-app：`pnpm exec playwright test --retries=0 --reporter=list,json`；定向重放附两文件、`--grep 'starting practice creates one session|300ms' --workers=1`。
- 根目录：`pnpm format:check`、`pnpm exec turbo run lint/typecheck/build --force`（三条分别执行）。
- backend：专用`.venv/bin/python`执行固定`check.py _pytest`；内部`pytest.main(['-o','faulthandler_timeout=120','--cov=.','--cov-report=term-missing'])`；另跑OpenAPI/Provider导出`--check`及Ruff format/check。

仅手册指定的PG15.19合成库echotalk-test-pg，已核schema c06_transcript_events，无迁移；测试进程限制网络至该库。没有调用真实Provider/LiveKit/IdP。

实施者自测另计：R1定向18/18、全量1224/50、typecheck与新测试格式通过；这些不冒认Harness亲跑。前三棵测试树及上表由Harness独立快照执行。

## 受控变异与恢复

生产文件均位于 `apps/vite-app/src/data/`；断言均来自新增 `readonly-query-f1.test.ts` 的 S1 固定快照。

实施者执行18项RED并逐项恢复（原始driver没有finally及逐项GREEN）。Harness独立执行全部19项，每项先磁盘备份、目标断言RED、finally逐字节恢复，再跑18/18 GREEN；其中19号仅由Harness执行。

| 编号 | 生产原行                                    | 变异                                     | 新增目标断言（行号及源码）                                                                                                                                           | Harness恢复后           |
| ---- | ------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| M01  | `readonly-query.ts:258`                     | primary的discard改为revalidate           | 138 `expect(query.getState().phase).toBe("ready");`<br>154 `expect(fetcher).toHaveBeenCalledTimes(1);`                                                               | 逐字节一致；18/18 GREEN |
| M02  | `readonly-query.ts:122`                     | context恒等判定恒为true                  | 190 `expect(fetcher).toHaveBeenCalledTimes(2);`<br>292 `expect(fetcher).toHaveBeenCalledTimes(3);`                                                                   | 逐字节一致；18/18 GREEN |
| M03  | `readonly-query.ts:172`                     | 移除生命周期门禁                         | 171 `expect(query.getState().items).toEqual([]);`<br>277 `expect(query.getState().items.map((item) => item.id)).not.toContain("b");`                                 | 逐字节一致；18/18 GREEN |
| M04  | `readonly-query.ts:265`                     | primary身份校验弱化                      | 209 `expect(identity.query.getState().items).toEqual([]);`                                                                                                           | 逐字节一致；18/18 GREEN |
| M05  | `readonly-query.ts:266`                     | primary版本校验弱化                      | 215 `expect(revisionCase.query.getState().items).toEqual([]);`                                                                                                       | 逐字节一致；18/18 GREEN |
| M06  | `readonly-query.ts:261`                     | primary序号校验移除                      | 221 `expect(sequence.query.getState().items).toEqual([]);`                                                                                                           | 逐字节一致；18/18 GREEN |
| M07  | `readonly-query.ts:289`                     | more的discard改为revalidate              | 247 `expect(query.getState().items.map((item) => item.id)).toEqual(["a", "b"]);`<br>262 `expect(query.getState().items.map((item) => item.id)).toEqual(["a", "b"]);` | 逐字节一致；18/18 GREEN |
| M08  | `readonly-query.ts:296`                     | more身份校验弱化                         | 304 `expect(identity.query.getState().items.map((item) => item.id)).toEqual(["a"]);`                                                                                 | 逐字节一致；18/18 GREEN |
| M09  | `readonly-query.ts:297`                     | more版本校验弱化                         | 314 `expect(revisionCase.query.getState().items.map((item) => item.id)).toEqual(["a"]);`                                                                             | 逐字节一致；18/18 GREEN |
| M10  | `readonly-query.ts:292`                     | more序号校验移除                         | 324 `expect(sequence.query.getState().items.map((item) => item.id)).toEqual(["a"]);`                                                                                 | 逐字节一致；18/18 GREEN |
| M11  | `readonly-query.ts:347`                     | 首页不再按clearCursorOnFirstPage清cursor | 392 `expect(query.getState().cursor).toBeNull();`<br>417 `expect(query.getState().cursor).toBeNull();`                                                               | 逐字节一致；18/18 GREEN |
| M12  | `readonly-query.ts:494`                     | 取消more时清cursor                       | 450 `expect(query.getState().cursor).toBe("cursor-1");`                                                                                                              | 逐字节一致；18/18 GREEN |
| M13  | `readonly-query.ts:491`                     | 取消primary时清items                     | 484 `expect(query.getState().items.map((item) => item.id)).toEqual(["a"]);`                                                                                          | 逐字节一致；18/18 GREEN |
| M14  | `use-daily-progress-query.ts:62`            | DP覆盖策略改为ignore                     | 574 `expect(api.listSessions).toHaveBeenCalledTimes(2);`                                                                                                             | 逐字节一致；18/18 GREEN |
| M15  | `use-daily-progress-query.ts:170`           | DP午夜偏移100ms改99ms                    | 605 `expect(api.listSessions).toHaveBeenCalledTimes(1);`                                                                                                             | 逐字节一致；18/18 GREEN |
| M16  | `use-weekly-progress-query.ts:187`          | WP去重改为区分大小写                     | 700 `expect(result.current.items.map((item) => item.id)).toEqual(["session-A"]);`                                                                                    | 逐字节一致；18/18 GREEN |
| M17  | `use-active-sessions-query.ts:102`          | AS首屏成功不提交身份                     | 345 `expect(result.current.queriedIdentity).toEqual({ principal: principalOf(), revision: 1 });`                                                                     | 逐字节一致；18/18 GREEN |
| M18  | `use-active-sessions-query.ts:81,86,88,102` | AS分页成功也提交身份                     | 354 `expect(result.current.queriedIdentity).toBeNull();`                                                                                                             | 逐字节一致；18/18 GREEN |
| M19  | `use-active-sessions-query.ts:146`          | AS取消前不清待提交身份                   | 362 `expect(result.current.queriedIdentity).toBeNull();`                                                                                                             | 逐字节一致；18/18 GREEN |

全部变异均为目标新增断言失败；解析错误、模块加载错误和附带无关失败不充当目标证据。Harness19项均逐项恢复原字节后再跑18/18 GREEN。临时副本独立于实施lane，原生产文件和全部既有测试保持基线。Harness启动阶段两次dotenv名称保护误判在测试前退出，未读内容，复制时排除全部.env\*后成功；这两次不计有效变异。

## CI与PR Guard

回读 CI 执行结果（非 Harness 亲跑）：[CI 43360032607](https://github.com/sunpcm/EchoTalk/actions/runs/43360032607)、[PR Guard 43360032589](https://github.com/sunpcm/EchoTalk/actions/runs/43360032589)，最终head的六项检查全部success。CI检出`5c50529ef76cb66007d3610d3a95176deec0f40f`（PR临时merge ref），其tree与上述已评审预期tree完全一致。

Linux：Vitest1224/50；E2E234（Chromium117、WebKit117；0skip、0实际重试/0flaky）；pytest809/3 warnings/80.19%；Fake108、类型8、构建21。CI配置允许2次retry，本次日志无retry/flaky，全部234项首次通过；本机与F2定向验收另显式retries0。macOS probe与iOS无签名编译CI通过，未替代设备验收。

关键原文（Harness亲读完整作业日志并摘录中段）：

```text
2026-11-13T03:36:16.0009226Z 5c50529ef76cb66007d3610d3a95176deec0f40f
2026-11-13T03:36:47.0162769Z # tests 8
2026-11-13T03:36:47.0165808Z # pass 8
2026-11-13T03:36:47.0166095Z # fail 0
2026-11-13T03:36:47.0166346Z # cancelled 0
2026-11-13T03:36:47.0166618Z # skipped 0
2026-11-13T03:37:34.6834626Z  Test Files  50 passed (50)
2026-11-13T03:37:34.6838672Z       Tests  1224 passed (1224)
2026-11-13T03:37:40.6789465Z # tests 21
2026-11-13T03:37:40.6790544Z # pass 21
2026-11-13T03:37:40.6790787Z # fail 0
2026-11-13T03:37:40.6791024Z # cancelled 0
2026-11-13T03:37:40.6791275Z # skipped 0
2026-11-13T03:37:47.0851243Z # tests 108
2026-11-13T03:37:47.0852076Z # pass 108
2026-11-13T03:37:47.0852464Z # fail 0
2026-11-13T03:37:47.0852884Z # cancelled 0
2026-11-13T03:37:47.0853567Z # skipped 0
2026-11-13T03:37:58.8026681Z Running 234 tests using 1 worker
2026-11-13T03:41:58.3276340Z   234 passed (4.0m)
2026-11-13T03:36:33.3989017Z c06_transcript_events (head)
2026-11-13T03:37:30.5543938Z TOTAL                                        4243    756   1092    105    80%
2026-11-13T03:37:30.5544508Z Required test coverage of 59.0% reached. Total coverage: 80.19%
2026-11-13T03:37:30.5544828Z ======================= 809 passed, 3 warnings in 51.56s =======================
2026-11-13T03:35:57.8485252Z PR Guard passed: additions=804 deletions=19
```

来源：frontend job131671066185、backend job131671066557、Guard job131671066060。上述Linux结果不覆盖本机首次231/3。

## 计划外观察与未验证

计划外：记录theme防抖用例的一次本机失败及重放，不顺手修；原实施模型节点的有效4项测试WIP按hash保全后，已授权备用模型在同一任务续作，无产出丢弃。

未验证：真实Provider/LiveKit/IdP、iOS/macOS设备、Docker整栈、QA及生产部署。本包不实施B2、预发布、待设备或用户裁定事项。

---

# 附录 F2：PR #159 最终技术说明及证据

修复 `session-start.spec.ts` 的异步 response 监听：原回调里的 `res.json()` 未被测试等待，测试结束时仍可能解析响应。现在监听同步记录请求，解析 Promise 由 async getter 明确等待，五处读取/清理调用均 await；仅改测试及本包收口文档，生产、Fake API与201成功前提保持。

## 冻结与评审

- Base: `7b300b02f2ff9d28f5b6e1dd13cd258e5028c3fb`
- Head: `26787c3e6f118ecd036215ef20db3abdf55803ed`；expected tree: `3d26d7c1bdef67abf7c3b50ae934916606e68848`
- E2E测试SHA256 `48987073a30ea2168f474af87a6bc6b10091f5c8c088f34ef07cb20883129127`
- 独立结论：`APPROVED（R0文档证据finding；R1关闭）`（Harness亲自评审；实施/评审分离）。
- 三个用例和27条expect链守恒：仅规范化新增的await tracker.getSessionId与冗余括号，AST逐项相同；顺序、计数、文案、信令拒绝与token失败语义不变。

## Harness亲跑（macOS）

- `pnpm test`：1224 passed / 50 files。
- 专用PG15.19合成库的backend pytest：809 passed、3 warnings、80.19%；无迁移、网络限制至该库。
- Fake API108、类型生成器8、构建脚本21；format、force lint/typecheck/build、生成类型/OpenAPI/Provider漂移、Ruff通过。
- 项目tsconfig仅覆盖src；额外对本次E2E文件做TypeScript5.9.3 strict/noEmit检查通过（非修改配置）。额外检查首次因Harness误指定不可见的Node ambient类型而TS2688退出；去掉该文件不需要的Node ambient配置后相同源码通过，失败证据保留。
- 300次重复：`完整300/300，Chromium150、WebKit150，三个用例在每个浏览器各50，retries0/skip0/flaky0，4worker约8min`。
- 全量E2E：`首次233/1，Chromium117/0、WebKit116/1，skip/retry0；唯一既有a11y Provider336×23px失败，无response.json或theme失败，未宣称本机全绿`。

实际命令（均经固定ev入口，浏览器/数据库仅Harness执行）：

```text
apps/vite-app: pnpm test; pnpm test:fake-api; pnpm test:api-types; pnpm test:build
apps/vite-app: pnpm exec playwright test --retries=0 --reporter=list,json e2e/session-start.spec.ts --repeat-each=50 --workers=4
apps/vite-app: pnpm exec playwright test --retries=0 --reporter=list,json
root: pnpm format:check; pnpm exec turbo run lint --force; pnpm exec turbo run typecheck --force; pnpm exec turbo run build --force
backend: 固定check.py _pytest内部pytest.main(['-o','faulthandler_timeout=120','--cov=.','--cov-report=term-missing'])，另OpenAPI/Provider --check与Ruff format/check
```

首次单worker300次验收因每个信令拒绝用例约15秒，主动SIGINT中断并保留：55 passed、1 interrupted、244 did not run、exit130。中断时cleanup出现apiRequestContext.post:Test ended，原文保留；这一轮不计通过。随后相同源码以4worker重新完整跑300，retries0，绝不将部分执行拼成300。

实施者另行自测：项目typecheck命中缓存且不覆盖E2E、新文件格式通过；不将其视为Harness实际测试。所有上述1224/809等与浏览器结果均由Harness在独立副本亲跑；CI回读另列。

文档格式首次因PROJECT_STATUS表格对齐失败，实施者删除旧ev并复用编号；Harness独立评审R0要求修正，已从未截断原生工具回执补存首次失败原文（不冒称删除前原文件或hash），R1报告与月历史披露。最终完整format:check以新编号ev21独立通过，旧记录全部保留。首次可见回执：

```text
Checking formatting...
[warn] docs/PROJECT_STATUS.md
[warn] Code style issues found in the above file. Run Prettier with --write to fix.
# exit=1
```

## CI及关键原文

[CI 43366625704](https://github.com/sunpcm/EchoTalk/actions/runs/43366625704) 与 [PR Guard 43366625968](https://github.com/sunpcm/EchoTalk/actions/runs/43366625968) 六项检查全部 success。最终 source head `26787c3e6f118ecd036215ef20db3abdf55803ed`；CI checkout merge ref `7f3742266a8ebe0646903d4b4e9662e10e89fc7d` 的 tree `3d26d7c1bdef67abf7c3b50ae934916606e68848` 与已审 source 整树一致。

Linux CI 回读：Vitest1224/50、Fake API108、类型生成器8、构建脚本21、pytest809/3 warnings/80.19%、E2E234。CI原始列表234条均为首次成功，Chromium117、WebKit117（按234个唯一测试序号及浏览器标签逐行计数）；实际retry0/flaky0/skip0。仓库CI配置retries=2，不把配置上限写成实际重试次数。上述均为回读CI，非Harness亲跑；本机233/1照原样保留。

关键原文（来自日志中段，完整保留时间戳）：

```text
2026-11-13T04:37:19.9506802Z # tests 8
2026-11-13T04:37:19.9508209Z # pass 8
2026-11-13T04:38:14.3878549Z  Test Files  50 passed (50)
2026-11-13T04:38:14.3884313Z       Tests  1224 passed (1224)
2026-11-13T04:38:20.4154520Z # tests 21
2026-11-13T04:38:20.4155221Z # pass 21
2026-11-13T04:38:27.0108276Z # tests 108
2026-11-13T04:38:27.0108834Z # pass 108
2026-11-13T04:38:40.6900860Z Running 234 tests using 1 worker
2026-11-13T04:43:03.5887585Z   234 passed (4.4m)
2026-11-13T04:38:01.7091077Z TOTAL                                        4243    756   1092    105    80%
2026-11-13T04:38:01.7091984Z Required test coverage of 59.0% reached. Total coverage: 80.19%
2026-11-13T04:38:01.7092455Z ======================= 809 passed, 3 warnings in 51.92s =======================
```

发布传输使用GitHub MCP，create_tree与本地index严格相等后才创建单个commit和新任务分支。SSH agent失联与匿名HTTPS超时均保留；本地导入API unsigned提交首次因时区+0000假设被SHA保护拦截，按GitHub实际-0800重建并验证同一SHA后成功快进本任务分支。未改凭据/全局配置或他人分支。

## 计划外与未验证

本包无变异要求，未宣称变异通过。原测试之外未新增产品测试或改动生产；没有依赖、锁、数据库结构变化或迁移。环境准备时离线pnpm缺锁定Capacitor tarball、uv缓存被沙箱拒绝，保留失败后原frozen命令重跑成功，不计为测试通过。

未验真实LiveKit/Provider/IdP、设备、Docker整栈、QA或生产。本机首次及未通过结果单列，Linux通过不会覆盖它们。未顺手修改WebKit控件高度、theme观察或G2状态码差异。

---

# 附录 F3：PR #160 最终技术说明及证据

将当前状态页从169行缩为73行，仅保留当前功能、验证基线、已知限制和历史索引；把逐卡流水及文档职责归档，Data契约开头流水也移入历史，§1改为现行契约措辞。所有产品代码、测试/fixture/config、依赖/锁、数据库与迁移零改动。

## 冻结与独立评审

- Base `38c4a69ca33a48cead69f60edcdbb4b391626ea3`（已核F2最终main）。
- Head `dca99edfecdbcc4600cb6c34a58207e3e7847c58`；expected tree `31a2874e4b738f63b8ee9244b9c13112ee3bf2f4`。
- Harness亲自独立评审 **APPROVED**；实施与评审分离。只改五文档，TODO完整原文勾选归档，旧月历史和旧归档原字节保全。
- PROJECT_STATUS的当前产品基线绑定F2最终main及其真实CI；本轮纯文档的最终head/tree/CI由本PR回执冻结，不伪造文档自身尚不存在的提交。F2与F3产品/测试字节完全相同。

## 验收逐条

1. 状态页73行、四节，≤150；过程记录只在history。
2. Data契约§2–10逐字节不变，方案A与原a784永久源码证据保留。§1仅更新已落地状态与任务索引，不重新裁定策略。
3. 原文搬运113行，含标题、空行、blockquote与重复措辞，未重写为摘要；无相对URL需要重定位。
4. 全仓163份跟踪Markdown，经原锁Prettier3.8 Markdown AST解析：相对链接420→422、fragment26；新增失效0、parse0、unchecked0。12处既有私有.review目标未入Git，留存基线清单，本轮未顺手修。

原文搬运（Harness逐字节独立核对）：

| 原文件与原行                              | 新history行 | 行数 | SHA256                                                             |
| ----------------------------------------- | ----------- | ---: | ------------------------------------------------------------------ |
| docs/FRONTEND_DATA_LAYER_CONTRACT.md:3-21 | 21-39       |   19 | `3832dd900136ae940bf8ceb7bb64b7a33ed99425470b5b76257b17acaffd4220` |
| docs/PROJECT_STATUS.md:50-126             | 43-119      |   77 | `d3eba211cbeaf97a8dfae45b2be58260f7897c329539326b1ab1309b9a0ca57c` |
| docs/PROJECT_STATUS.md:153-169            | 123-139     |   17 | `b9714800a381a80fa4e50e709d4f1e3bf02c0a6a66b91c1225f473976002d507` |

## 亲跑（Harness/macOS，非CI回读）

- Vitest1224/50；backend pytest809、3 warnings、80.19%、72.58s；Fake108、类型生成器8、构建脚本21。
- force lint132warnings/0error、typecheck/build、API/OpenAPI/Provider漂移、Ruff与最终完整format通过。
- 完整E2E首次233/1：Chromium117/0、WebKit116/1，skip/retry/flaky0，58.2s；唯一既有Provider336×23px，无其他失败。本机不冒认全绿。
- runtime三树在与最终F3完全相同的产品/测试字节上fresh执行；最终五文档另做完整format与全仓Markdown终检，未拿缓存代替执行。

实际命令均经ev入口：

```text
apps/vite-app: pnpm test; pnpm test:fake-api; pnpm test:api-types; pnpm test:build
apps/vite-app: pnpm exec playwright test --retries=0 --reporter=list,json
root: pnpm format:check; pnpm exec turbo run lint --force; pnpm exec turbo run typecheck --force; pnpm exec turbo run build --force
backend: 固定check.py _pytest调用pytest.main(['-o','faulthandler_timeout=120','--cov=.','--cov-report=term-missing'])；另OpenAPI/Provider --check与Ruff format/check
Markdown: Node22 + 已安装Prettier3.8 AST，全跟踪Markdown的基线/候选差分；Git源行块按表格行号与SHA256逐字节核对
```

## 辅助门禁与首次记录

旧链接工具只查三个文件、不查fragment，未算本轮通过证据；独立扩展工具仅放.review、不装依赖、不改CI或产品测试。首版对两个有效目录的尾斜线误报已用Git树确认并修正，原14结果与v0脚本保留，最终12均为历史私有目标。

辅助gate负向自检：在自有独立副本先磁盘备份，仅加一个缺路径与一个缺fragment链接。两个指定failure均被精确捕获，解析/无关failure0；finally逐字节恢复，恢复后完整gate GREEN。不冒充产品代码变异或新增产品测试。

```text
./f3-intentional-missing-target.md => missing-target
./ARCHITECTURE.md#f3-intentional-missing-anchor => missing-heading-or-custom-anchor
negative exit=1; finally restored original SHA256; restored gate exit=0
```

实施者首次格式检查仅STATUS表格不合规，随后write修复与check通过，三份唯一ev分别保留；最终历史追加另用新ID检查。Harness环境首次误用runtime requirements离线入口，解析失败且未安装包；按手册uv sync offline/frozen/dev/Python3.12.12修正，101个已装包版本与F2逐项一致，未改依赖或锁。

## CI及关键原文

[CI 43372070616](https://github.com/sunpcm/EchoTalk/actions/runs/43372070616) 与 [PR Guard 43372070672](https://github.com/sunpcm/EchoTalk/actions/runs/43372070672) 六项 success。source head `dca99edfecdbcc4600cb6c34a58207e3e7847c58`，CI checkout merge ref `4cf76d6fef3d1e19a09937374769b858dbf1ab4f` 的 tree `31a2874e4b738f63b8ee9244b9c13112ee3bf2f4` 与独立评审整树一致。

Linux CI回读（不是Harness亲跑）：Vitest1224/50、E2E234、pytest809/3warnings/80.19%、Fake108/类型8/构建21。CI234条唯一测试序号均首次成功，Chromium117+WebKit117，实际retry/skip/flaky0；配置retries2。上述不覆盖本机233/1。

日志中段关键原文：

```text
2026-11-13T05:27:27.7458006Z # tests 8
2026-11-13T05:27:27.7458820Z # pass 8
2026-11-13T05:28:05.5371582Z  Test Files  50 passed (50)
2026-11-13T05:28:05.5374995Z       Tests  1224 passed (1224)
2026-11-13T05:28:10.2572343Z # tests 21
2026-11-13T05:28:10.2573012Z # pass 21
2026-11-13T05:28:16.4487310Z # tests 108
2026-11-13T05:28:16.4488323Z # pass 108
2026-11-13T05:31:58.4579001Z   234 passed (3.6m)
2026-11-13T05:28:13.7457826Z TOTAL                                        4243    756   1092    105    80%
2026-11-13T05:28:13.7458498Z Required test coverage of 59.0% reached. Total coverage: 80.19%
2026-11-13T05:28:13.7458870Z ======================= 809 passed, 3 warnings in 52.54s =======================
```

## 计划外与未验证

五文档之外无产品变更；本包无产品变异硬要求，辅助gate自检单列。发布沿用已验证GitHub MCP，先比tree后创建单commit/新任务分支，不强推、不改写他人分支。12个历史私有链接保留列账。

真实LiveKit/Provider/IdP、iOS/macOS设备、Docker整栈、QA或生产均未验；没有迁移或部署。Linux CI结果另列，不覆盖本机首次233/1。

---

# 附录 F4：PR #161 最终技术说明及证据

会话 façade 原先通过通用协调补丁暴露了页面视图字段。现在公共 TypeScript 类型排除该入口，内部 AppStore 继续协调导航；完整会话状态替换省略内部方法时保留现有协调器，显式提供时保留调用方选择。

比较基线：`3827861a271202eee26dec16057e10b27f745081`。最终 head：`3c794ebdefc3fe8c1762c5ade51a017bb4fc5d6d`；预期 tree：`388c6f06bab2237ab3d1e349c82314583d9d1d29`。

本包新增3条直接 store 契约与6个纯类型负断言，既有测试、fixture、配置和锁文件不变。

验证（Harness亲跑，macOS/Node22.13.1；与Linux CI分开）：

| 命令                                                                          | 实测                                                                   |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm test`                                                                   | 首轮1226 passed/1 failed；R1全量1227 passed/51 files                   |
| `pnpm exec turbo run lint --force`                                            | 首轮6 errors/132旧warnings；R1为0 errors/132旧warnings                 |
| `pnpm exec turbo run typecheck --force` / `pnpm exec turbo run build --force` | 通过；R1均重新亲跑                                                     |
| `pnpm format:check`                                                           | 通过；R1重新亲跑                                                       |
| `pnpm test:fake-api` / `test:api-types` / `test:build`                        | 108 / 8 / 21 passed                                                    |
| `pnpm check:api-types`                                                        | 通过                                                                   |
| `python export_openapi.py --check` / `export_provider_metadata.py --check`    | 通过                                                                   |
| `ruff format --check .` / `ruff check .`                                      | 通过                                                                   |
| `pytest -o faulthandler_timeout=120 --cov=. --cov-report=term-missing`        | 专用PG15.19合成库，809 passed/3 warnings/80.19%，66.97s                |
| `pnpm exec playwright test --retries=0 --reporter=list,json`                  | 首轮233 passed/1 failed；Chromium117/0、WebKit116/1；skip/retry/flaky0 |

首轮Vitest失败来自新增注释中页面视图字段名被既有`navigation.test.ts:82`源码断言捕获；lint失败来自6个未导出类型断言。R1只改注释和纯类型导出，既有测试原文保持。R1两文件去注释后的JS发射逐字节相同，backend及测试字节不变；R1重跑全Vitest/lint/typecheck/build/format，其余上表数字来自首轮真实执行，没有冒称重新运行。早期新增测试首次Prettier失败及修正后重放均保留；实施者初次6项自测未钉Node版本，后续及Harness验证明确Node22。

本机E2E唯一失败仍是既有WebKit Provider控件触控高度问题（既有336×23px差异），本包保留失败记录；Linux通过不能替代本机通过。

独立变异只在临时副本执行，磁盘备份、逐字节恢复后真实tsc与3条runtime契约GREEN：

| 变异  | 改动                                                | 目标断言                                                                                                 |
| ----- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| F4-M1 | `conversation.ts:13`将Omit回退完整ConversationSlice | `conversation-facade.typecheck.ts:15/22/31`产生目标TS2578                                                |
| F4-M2 | `appStore.ts:73`移除协调动作保全分支                | 新测试`:53`的`expect(after.resetWithShellCoordination).toBe(resetWithShellCoordinationRef)`捕获undefined |
| F4-M3 | `appStore.ts:73`改为无条件覆盖                      | 新测试`:105`的显式custom保留断言失败                                                                     |

Linux CI回读（不是Harness/macOS亲跑）：[CI 43403508490](https://github.com/sunpcm/EchoTalk/actions/runs/43403508490) 与 [PR Guard 43403508536](https://github.com/sunpcm/EchoTalk/actions/runs/43403508536) 六项 success，均绑定最终head `3c794ebdefc3fe8c1762c5ade51a017bb4fc5d6d`。Vitest1227/51、E2E234（Chromium117+WebKit117；配置retries=2，实际retry/skip/flaky=0）、pytest809/3warnings/80.19%/57.08s、Fake108/类型8/构建21。CI checkout的merge `2d6fad26c4bfa8b97e61fd22068af6f6b3260685` 与已审source tree严格相同。

关键作业原文（只去除ANSI控制码，供只看日志尾部的复核者使用）：

```text
2026-11-13T09:42:54.6246142Z # tests 8
2026-11-13T09:42:54.6247290Z # pass 8
2026-11-13T09:43:43.9135838Z  Test Files  51 passed (51)
2026-11-13T09:43:43.9139980Z       Tests  1227 passed (1227)
2026-11-13T09:43:49.3732986Z # tests 21
2026-11-13T09:43:49.3733455Z # pass 21
2026-11-13T09:43:55.8392664Z # tests 108
2026-11-13T09:43:55.8393424Z # pass 108
2026-11-13T09:48:05.1236590Z   234 passed (4.0m)
2026-11-13T09:43:42.4804576Z TOTAL                                        4243    756   1092    105    80%
2026-11-13T09:43:42.4805286Z Required test coverage of 59.0% reached. Total coverage: 80.19%
2026-11-13T09:43:42.4805699Z ======================= 809 passed, 3 warnings in 57.08s =======================
```

文档收口也已核对并纠正子树指纹误抄、报告断言计数和S1/S2来源；当前状态页74行，保留本机未通过结果。

未验证：真实Provider/LiveKit/IdP、iOS/macOS原生设备、Docker整栈、部署。无依赖、配置或数据库迁移变化。

---

# 附录 H2：PR #162 最终技术说明及证据

冻结基线：`0aa7d52b99bbcb06dedcae664d74994dc01b4f7a`；最终 source head：`61e7cf0ed8d614695e06ffca1178003ac6dd9759`；预期 tree：`77c28119ac67e828bfabc9621ff0c30fe1b78e2b`。

H2 将原1039行 API 模块拆为 client、sessions、assessments、settings、callLease 与 index；81个原声明 AST 逐一相同，71个公开导出保持，request、ApiError 与 URL缓存各只有一个实例。所有 `from "@/lib/api"` 调用方和 `api.test.ts`（192项）零改动。

行为变化：API 请求、认证revision、401失效、取消、超时、幂等和响应解析保持。目录拆分让Vite的源码URL被两处E2E旧拦截正则误回503；只收紧两处matcher到真实 `/api/...` pathname，保留全部用例、标题、断言与mock内容。完整文件 AST 除 matcher 参数外相同，26个URL边界验证通过。这是本包必要的计划外测试夹具修正。

独立本机验证（macOS，Node22；不是Linux CI）：

| 实际执行                                                                                                   | 结果                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm test`（Vite应用）                                                                                    | 1227 passed / 51 files                                                                |
| `pnpm test:fake-api` / `test:api-types` / `test:build`                                                     | 108 / 8 / 21 passed                                                                   |
| 后端封装内调用 `pytest.main(['-o','faulthandler_timeout=120','--cov=.','--cov-report=term-missing'])`      | 专用PG15.19合成库、出网限制；809 passed / 3 warnings / 80.19%，pytest自身67.93s       |
| `pnpm exec turbo run lint --force`、`typecheck --force`、`build --force`                                   | 通过；lint 0 error / 132既有warnings                                                  |
| `pnpm format:check`、`export_openapi.py --check`、`export_provider_metadata.py --check`、Ruff format/check | 通过                                                                                  |
| 完整 `playwright test --retries=0 --reporter=list,json` S1                                                 | 首次225通过/9失败，Chromium113/4、WebKit112/5；8新增误拦截、1既有尺寸问题             |
| 修后完整Playwright S2                                                                                      | 233通过/1失败，Chromium117/0、WebKit116/1，0 retry/skip/flaky；仅既有Provider336×23px |

R1产品7路径相对S1逐字节不变；S2重跑完整E2E、lint与format，未把未重复的Vitest/pytest列成S2执行。真实浏览器trace确认 `/src/lib/api/sessions.ts`、`assessments.ts` 被旧正则返回503 JSON。首次诊断、修复及重放全部保留。早期原生TS2304/unused-import/Prettier诊断的包装命令exit0由管道遮蔽，不能当作成功；后续固定Node22的直接门禁才是成功证据。

辅助审计门禁负例2项：修改request的认证revision、额外公开导出request，分别被目标AST/导出集合断言抓到；仅在自有临时副本中操作，备份后逐字节恢复并复验。它们是审计门禁负例，不冒充产品变异测试。

TODO已勾选归档，当前状态保留四类且少于150行，过程进入history。无新增依赖、锁或数据库结构修改，本机未执行迁移；未调用真实Provider、LiveKit、IdP，未验证设备、Docker整栈或生产部署。本机仍有1项既有失败，后续Linux CI结果会单独回读记录。

Linux CI回读（与本机分开）：[CI 43422540225](https://github.com/sunpcm/EchoTalk/actions/runs/43422540225)、[PR Guard 43422540273](https://github.com/sunpcm/EchoTalk/actions/runs/43422540273)，最终head六检查全部success。Vitest1227/51；E2E234（Chromium117、WebKit117，实际retry/skip/flaky均0，配置retries2）；pytest809/3warnings/80.19%；Fake108/类型8/构建21。CI merge `64662312d7366f6e362533aed9f7c8c384970269` 的tree与已审source tree完全一致。

CI日志关键原文（仅去ANSI终端控制符）：

```text
2026-11-13T12:08:14.8510761Z # tests 8
2026-11-13T12:08:14.8518886Z # pass 8
2026-11-13T12:09:17.4630852Z  Test Files  51 passed (51)
2026-11-13T12:09:17.4645545Z       Tests  1227 passed (1227)
2026-11-13T12:09:23.8146278Z # tests 21
2026-11-13T12:09:23.8147781Z # pass 21
2026-11-13T12:09:30.5320354Z # tests 108
2026-11-13T12:09:30.5321175Z # pass 108
2026-11-13T12:14:24.7391900Z   234 passed (4.7m)
2026-11-13T12:08:49.2639531Z TOTAL                                        4243    756   1092    105    80%
2026-11-13T12:08:49.2639946Z Required test coverage of 59.0% reached. Total coverage: 80.19%
2026-11-13T12:08:49.2640181Z ======================= 809 passed, 3 warnings in 39.56s =======================
```

H2首失败补充校准：首个trace诊断遭sandbox EPERM，未执行目标测试，不能当目标RED；权限重放后浏览器trace才真正确认模块误拦截。R1两份E2E文件首次format失败、文档收口TODO首次format失败及成功重放均保留。首次git write-tree的index.lock EPERM是权限失败，不是测试失败。早期私有closeout将R0 API格式诊断误指到R1 E2E格式日志，最终独立评审已纠正：两者分别保留，不能合并或张冠李戴。pytest自身67.93s与整条命令73.62s含义不同，本文使用pytest自身耗时。

---

# 附录 G1：PR #163 最终技术说明及证据

冻结基线：`714e1665c4e86fcda0525fdeffe5ef9a461fb447`；最终source head：`f1bff3431d69c486768c914e3babd565ec8fb284`；预期tree：`58c9ab9e0e62ac04db610b7ed9f8c7553730992c`。

G1 为四个空成功 schema 补 Pydantic 响应模型：health、ready、session token、dispatch。重新导出 OpenAPI 与前端类型，Fake API 空 schema 精确清单由4项变为0；缺失operation与既有200/201偏差保持，G2未开工。

行为：HTTP返回体和状态码保持，模型仅有现有必填str/bool字段。两个router除四个response_model/import外完整AST一致；旧Session DTO AST一致；去掉4个新增模型和还原4个ref后，OpenAPI整体与基线完全相同。Fake测试除了清单4→0外全AST相同，原58个backend pytest文件、前端调用方、原Vitest/E2E零改动。新增4项测试通过公共artifact跟随ref，保护字段、必填和基本类型。

独立macOS亲跑（Node22/Python3.12，非Linux CI）：

| 命令                                                                                                           | 结果                                                                               |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Vite `pnpm test`                                                                                               | 1227/51                                                                            |
| `pnpm test:fake-api` / `test:api-types` / `test:build`                                                         | 108/8/21                                                                           |
| 专用PG15.19与出网限制下 `pytest.main(['-o','faulthandler_timeout=120','--cov=.','--cov-report=term-missing'])` | 813 passed，3 warnings，80.23%，pytest66.62s（59%门禁）                            |
| 完整 `playwright test --retries=0 --reporter=list,json`                                                        | 233/1：Chromium117/0、WebKit116/1，实际retry/skip/flaky0；唯一既有Provider336×23px |
| `turbo run lint/typecheck/build --force`、`pnpm format:check`、Ruff                                            | 全通过，lint0error/132既有warnings                                                 |
| `export_openapi.py --check`、`check:api-types`、`export_provider_metadata.py --check`                          | 全通过                                                                             |

新增契约断言的4个有效OpenAPI artifact变异（合法JSON，非运行时逻辑变异）：

| 原行                     | 类型改动                                        | 目标断言                                                                   |
| ------------------------ | ----------------------------------------------- | -------------------------------------------------------------------------- |
| backend/openapi.json:602 | HealthResponse.status string→integer            | test_success_response_is_modeled[GET /api/health]                          |
| backend/openapi.json:712 | ReadinessResponse.status string→integer         | test_success_response_is_modeled[GET /api/health/ready]                    |
| backend/openapi.json:882 | SessionTokenResponse.ws_url string→integer      | test_success_response_is_modeled[GET /api/sessions/{session_id}/token]     |
| backend/openapi.json:9   | AgentDispatchResponse.dispatched boolean→string | test_success_response_is_modeled[POST /api/sessions/{session_id}/dispatch] |

均由各自类型断言AssertionError抓到，仅在自有临时副本备份后操作，finally逐字节恢复，前后4/4 GREEN。首次Ruff格式检查失败、修复和重放保留；未把首次说成通过。完整15项独立检查期间源文件字节稳定。

TODO勾选归档，测试基线更新813/80.23%，过程只写history，当前状态四类且≤150行。无新依赖/锁/数据库结构修改，本机未执行迁移。未调用真实Provider/LiveKit/IdP；设备、Docker整栈、生产部署未验证。本机既有1项失败保留，专属Linux CI将在发布后单独回读。

Linux CI回读：[CI 43428362306](https://github.com/sunpcm/EchoTalk/actions/runs/43428362306) / [PR Guard 43428362337](https://github.com/sunpcm/EchoTalk/actions/runs/43428362337)，最终head六检查success。Vitest1227/51、E2E234（117+117，实际retry/skip/flaky0，配置retries2）、pytest813/3warnings/80.23%、Fake108/类型8/构建21。CI merge `5d081a0d7be035ec7dc6e1dc06d7127f1d800948` tree与已审source完全一致。本机1项失败仍保留，不能据此改称本机全绿。

CI日志关键原文（仅去ANSI控制符）：

```text
2026-11-13T12:49:52.7481328Z # tests 8
2026-11-13T12:49:52.7481834Z # pass 8
2026-11-13T12:50:41.5812306Z  Test Files  51 passed (51)
2026-11-13T12:50:41.5818942Z       Tests  1227 passed (1227)
2026-11-13T12:50:47.9352740Z # tests 21
2026-11-13T12:50:47.9353168Z # pass 21
2026-11-13T12:50:54.3571438Z # tests 108
2026-11-13T12:50:54.3571822Z # pass 108
2026-11-13T12:55:08.5592824Z   234 passed (4.1m)
2026-11-13T12:50:26.4524921Z TOTAL                                        4255    756   1092    105    80%
2026-11-13T12:50:26.4525484Z Required test coverage of 59.0% reached. Total coverage: 80.23%
2026-11-13T12:50:26.4525806Z ======================= 813 passed, 3 warnings in 49.63s =======================
```

G1四项类型变异的目标断言统一位于 `backend/tests/test_success_response_contracts.py:66`：`assert properties[field].get("type") == json_type`；表内四个参数化case分别对应四个operation。

---

# 附录 I2：PR #164 最终技术说明及证据

冻结基线：`ce82ea3b8c542b3cd8a1afbe7cf27950cd364cad`；最终source head：`dc4fb2602fa2aa9456087017c772647867128252`；预期tree：`86f4d99880ca41bb0c497ce682efaec3e66e64c7`。

分析任务此前缺少可直接消费的状态日志和队列快照。本PR新增6类JSON日志（领取、成功、可重试失败、耗尽、非重试终止、陈旧恢复），在真实worker/process_job事务成功提交后才输出；新增只读queue_snapshot返回pending总数与最老等待秒数，没有新增HTTP端点或外部指标服务。

日志只含event/job_id/session_id/attempt_count及必要的error_code/retryable/outcome；未知错误码归为unknown_error，不回放转录、文档、凭据或异常正文。记录器失败不会进入业务失败/重试流程；取消和回滚丢弃尚未提交事件。状态机、3次重试、5/30秒、锁顺序/skip_locked、停止与取消预算保持。去掉纯观测新增后，两个原文件AST与G1基线精确一致；原59个pytest文件逐字节不变。

queue_snapshot只执行单个COUNT/MIN SELECT，用no_autoflush，不加锁/flush/commit/add；pending包含延迟重试，等待从created_at按时区感知UTC计算、取整秒，空队列和未来时钟偏差返回0。无依赖、锁文件、ORM/数据库结构或迁移改动。

## 独立验证：Harness亲跑macOS arm64

| 阶段、目录与实际命令                                                                                                                | 结果                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| E0 / apps/vite-app / `pnpm exec playwright test --retries=0 --reporter=list,json`（另指定独立output目录）                           | 233 passed / 1 failed；C117/0、W116/1，retry/skip/flaky0；唯一既有Provider336×23px |
| U0 / apps/vite-app / `pnpm test`                                                                                                    | 1227 passed / 51 files                                                             |
| U0 / apps/vite-app / `pnpm test:fake-api`                                                                                           | 108 passed                                                                         |
| U0 / apps/vite-app / `pnpm test:api-types`                                                                                          | 8 passed                                                                           |
| U0 / apps/vite-app / `pnpm test:build`                                                                                              | 21 passed                                                                          |
| U0 / root / `pnpm exec turbo run lint --force`                                                                                      | 0 error / 132既有warnings                                                          |
| U0 / root / `pnpm exec turbo run typecheck --force`                                                                                 | 通过                                                                               |
| U0 / root / `pnpm exec turbo run build --force`                                                                                     | 通过                                                                               |
| U0 / apps/vite-app / `pnpm check:api-types`                                                                                         | 通过                                                                               |
| U0 / backend / `.venv/bin/python export_openapi.py --check`                                                                         | 通过                                                                               |
| U0 / backend / `.venv/bin/python export_provider_metadata.py --check`                                                               | 通过                                                                               |
| U0 / root / `pnpm format:check`                                                                                                     | 通过；文档收口后再次验证                                                           |
| S1 / backend / `.venv/bin/ruff format --check .`                                                                                    | 通过                                                                               |
| S1 / backend / `.venv/bin/ruff check .`                                                                                             | 通过                                                                               |
| S1 / backend / 专用`.venv/bin/python`封装执行`pytest.main(['-o','faulthandler_timeout=120','--cov=.','--cov-report=term-missing'])` | 841 passed / 3 warnings / 80.59%，pytest67.89s（命令72.81s），59%门禁              |

以上15门禁分三阶段亲跑。E0/U0执行期间源字节稳定，后续仅修订2个新增backend测试，产品3路径、整个前端与生成物都与最终相同；S1为最终R1后端全量。不冒认S1重跑前端或E2E，也不因Linux通过宣称本机全绿。只用已核身份PG15.19合成库，出网限制，不读写.env、未执行本机迁移、未调用真实依赖。

## R0/R1与有效变异

初稿队列聚合误用MAX，已同轮改MIN并用300s/20s的两pending断言取300s。R0新增25项虽过，但删除真实入口3个观测作用域后仍25/25过，独立评审CHANGES REQUESTED。R1改为真实process_job/run_forever，六事件完整字段、恶意错误/凭据脱敏、Event屏障并发隔离、真实PG不autoflush、取消、commit前故障和handler spy；最终新增28项。提交故障仅测试session的一次性before_commit钩子，未让产品依赖sync_session，也未改旧MemoryQueue测试。

7个有效目标变异如下（目标均在两个新增测试文件）：

| ID    | 产品原行                                        | 变异                                                       | 目标断言                                                                                                                                                                                                         |
| ----- | ----------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I2-M1 | `backend/services/analysis_jobs.py:265`         | remove success owner event scope                           | `backend/tests/test_analysis_observability.py:288` / `test_process_job_success_emits_succeeded` / `assert [event["event"] for event in events] == ["analysis_job_succeeded"]`                                    |
| I2-M2 | `backend/services/analysis_jobs.py:270`         | remove failure owner event scope                           | `backend/tests/test_analysis_observability.py:311` / `test_process_job_retryable_failure_redacts_message` / `assert [event["event"] for event in events] == ["analysis_job_retryable_failure"]`                  |
| I2-M3 | `backend/workers/analysis_worker.py:72`         | remove worker claim/recovery owner event scope             | `backend/tests/test_analysis_observability.py:412` / `test_worker_claim_emits_claimed` / `assert [event["event"] for event in events] == ["analysis_job_claimed"]`                                               |
| I2-M4 | `backend/services/analysis_jobs.py:265`         | move event scope inside DB transaction; emit before commit | `backend/tests/test_analysis_observability.py:556` / `test_commit_failure_after_buffered_success_emits_no_phantom_success` / `assert [event["event"] for event in events] == ["analysis_job_retryable_failure"]` |
| I2-M5 | `backend/services/analysis_jobs.py:326`         | oldest min to newest max                                   | `backend/tests/test_analysis_queue_snapshot.py:226` / `test_snapshot_uses_oldest_pending_created_at` / `assert age == 300`                                                                                       |
| I2-M6 | `backend/services/analysis_observability.py:47` | unsafe error code returned verbatim                        | `backend/tests/test_analysis_observability.py:81` / `test_safe_error_code_whitelists_and_collapses_unknown` / `assert safe_error_code("provider_injected_secret") == UNKNOWN_ERROR_CODE`                         |
| I2-M7 | `backend/services/analysis_observability.py:67` | handler failure re-raised into business failure path       | `backend/tests/test_analysis_observability.py:519` / `test_handler_failure_keeps_committed_success_without_retry` / `assert failure_called is False`                                                             |

每项均是指定testcase的AssertionError，先磁盘备份、finally逐字节恢复，再跑新增28/28 GREEN。R0逃逸不算有效kill。Harness最初对JUnit缺省type和数值断言消息前缀作了错误假设，两次误拒合法M1/M5目标RED；源均恢复，旧日志保留，修正解析后全新ID完成，已通过的M1-M4未重复。不是产品失败或解析错误变异充数。实施Ruff import排序/两文件格式首失败，以及R1测试import首失败均保留，新ID修正重放；最后补充4项自检首次通过。

## 文档、计划外变更与未验证

TODO勾选归档，PROJECT_STATUS基线841/80.59%、四类且≤150行，过程只写history；ARCHITECTURE仅更新最小观测现状/风险两处。范围共5代码/新增测试+5文档。计划外：无新增产品范围；报告保留R0聚合错误、测试覆盖逃逸和Harness解析校准。

结构化日志是best-effort，提交后进程崩溃/取消仍可能漏日志，不承诺持久化或恰好一次；只保障实际root事务路径，不宣称任意嵌套事务。生产日志采集、集中告警、执行延迟/失败率仍未验证；真实Provider/LiveKit/IdP、iOS/macOS设备、Docker整栈、部署未验。I2不实施B2、不接预发布或G2/G3/H1/I1。最终Linux CI将单独回读，下面才是其证据。

最终文档门禁另亲跑通过：全局format；163 Markdown /421链接/26锚点，12个既有私有.review坏链接保持，无新增broken/parse/unchecked；lint-staged仅格式化5文档，源SHA保持。首次收口的相对路径触发Harness路径保护、formatter未执行；绝对路径+新ID重放成功，首记录保留。整树10路径独立最终APPROVED，预期tree `86f4d99880ca41bb0c497ce682efaec3e66e64c7`，前端子树与G1相同。

Linux CI回读（不是Harness本机亲跑）：[CI 43439468324](https://github.com/sunpcm/EchoTalk/actions/runs/43439468324) / [PR Guard 43439468312](https://github.com/sunpcm/EchoTalk/actions/runs/43439468312)，最终head六检查全部success，run attempt1。Vitest1227/51、E2E234（Chromium117/WebKit117，实际retry/skip/flaky0，配置retries2）、pytest841/3warnings/80.59%、Fake108/类型8/构建21。CI merge `ca4a17fb8a7a014ee96bc7c44336c5c21b21522a`的tree与已审source完全一致。本机233/1的既有失败保留。

关键CI日志原文中段（仅去ANSI控制符）：

```text
2026-11-13T14:06:26.8728760Z # tests 8
2026-11-13T14:06:26.8730913Z # pass 8
2026-11-13T14:07:16.3241356Z  Test Files  51 passed (51)
2026-11-13T14:07:16.3250853Z       Tests  1227 passed (1227)
2026-11-13T14:07:24.7798156Z # tests 21
2026-11-13T14:07:24.7799018Z # pass 21
2026-11-13T14:07:31.2131951Z # tests 108
2026-11-13T14:07:31.2132308Z # pass 108
2026-11-13T14:11:46.5921980Z   234 passed (4.1m)
2026-11-13T14:07:07.2082061Z TOTAL                                        4337    757   1114    105    81%
2026-11-13T14:07:07.2082627Z Required test coverage of 59.0% reached. Total coverage: 80.59%
2026-11-13T14:07:07.2082948Z ======================= 841 passed, 3 warnings in 52.32s =======================
2026-11-13T14:05:40.7900155Z PR Guard passed: additions=1138 deletions=29
```

来源：frontend job131932996111、backend job131932995898、Guard job131932995504；iOS无签名编译与macOS静态probe通过，不替代设备验收。
