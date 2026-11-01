# MACOS M1：第一增量离线验证

日期：2026-11-01。基线分支 `codex/macos-m1-feasibility`，
HEAD `7b9e0b3db0f629b70430eaaa29de2f63bbaf9321`；r0 实施前工作树干净。
r1 以原 11 项未跟踪文件为已批准返修基线，dirty 指纹为
`73ea55c4198c75ac2dc09f1e67a55f46515f62e5a303d9f63f33b1f2d9f7d46b`，
经本节点逐文件核对 r0b 清单。允许变更仅原 10 个探针文件与本文，不新增生产能力。

## 范围和证据等级

此增量根据用户“暂无专用环境、先做离线探针”的授权，使用可审查版本化 tools 目录，取代计划 §5 中未来 ignored 临时探针的存放建议。没有创建完整 native 工程，没有修改 Web/iOS/backend、依赖锁、runner 或共享 skill。没有安装依赖、访问真实服务、读 dotenv/凭据或私有评审材料。

| 项目                           | 本轮证据和边界                                                                |
| ------------------------------ | ----------------------------------------------------------------------------- |
| 基线与执行能力                 | 实施节点实际读取 Git/AGENTS/交接和现有工具入口；验收结果以指定 ev 原文为准    |
| Node 22 离线测试               | 标准库 `node:test`，在最终源码及文档冻结后串行运行，结果详见 implementer 报告 |
| 精准格式检查                   | 主树既有 Prettier/插件，仅检查指定 lane 的允许目标；不是整仓质量门禁          |
| OAuth 回跳协调                 | 标准库随机数/S256、精确绑定、原子 store 替身、取消/过期/并发/迟到测试         |
| 媒体生命周期                   | 可观察 access/microphone/connection lease 替身；停轨/销毁/迟到/代际断言       |
| native/Xcode/Rust              | 主控声明过工具存在，本节点未独立验证或调用；该声明不证明当前节点权限/构建成功 |
| OIDC/Keychain/系统回跳         | 没有生产 port 或原生壳，未运行，真实认证门禁未通过                            |
| 真实双向音频/API/LiveKit/Cloud | 无专用环境，未运行，不宣称 M1 或 Cloud 验收通过                               |
| 原有 frontend10/backend5       | 本轮不在执行范围，未运行、不计通过；未来共享业务改动保留全部 15 项与 59% 下限 |

## 可执行入口

完整接口、调用顺序与安全责任见 [探针 README](../../../tools/macos-m1-probe/README.md)。

```bash
cd /Users/sunpcm/code/EchoTalk/.review/worktrees/macos-m1-20261101/tools/macos-m1-probe
PATH=/Users/sunpcm/.nvm/versions/node/v22.13.1/bin:/usr/bin:/bin \
  /Users/sunpcm/.nvm/versions/node/v22.13.1/bin/npm run probe:test
```

此脚本有真实断言和 5 秒单用例超时，非占位 return 0。没有 `probe:build/install`；没有 native 产物、bundle hash 或支持最低 macOS 的设备结论。

交付验收由固定
`/Users/sunpcm/code/EchoTalk/.review/reports/tools/ev.sh`
保存命令、cwd/HEAD、双流和真实退出码。原文、最终 manifest、源码/lock/配置归档和报告只在：

`/Users/sunpcm/code/EchoTalk/.review/reports/macos-m1-20261101/implementer/r1/`

r0 历史证据保留在同级 `r0/`，不覆盖、不当作 r1 最终结果。r1 新增两条独立编写的核心时序回归，在未修复实现上实际执行为原 54 项通过、新 2 项失败（exit=1）；修复后完整套件及精准格式检查以 r1 报告和冻结清单为准。

r1 针对两项 P1：认证 opener 失败立即清除回跳已取得 token，先于慢身份校验/持久撤销；媒体在同步 disposer 和 await 恢复后重新检查有效性，不再将已休眠/关闭或被替代的操作返回为 connected。相邻同步回调还覆盖清理失败、单次销毁、迟到资源、新旧操作隔离，以及停止/失败清理不得覆盖回调产生的新状态。

报告冻结前核对路径与逐文件 SHA256；本文件不内嵌自己的 hash，避免自引用。本 package 无第三方依赖/独立 lock；归档记录现有仓库 lock，不声称已经固定 Tauri 依赖。未增加 preflight 的“官方通过”断言。

## 必须继续保留的缺口

`transactions` 需要真实受保护持久存储及跨进程原子消费/撤销；`openAuthorization` 需要受限系统浏览器；`exchangeCode/validateIdentity` 需要真实公共客户端 PKCE 交换及签名/issuer/audience/nonce 校验；长期凭据留应用限定 Keychain。薄 ports 是责任边界，不是上述能力实现。

媒体需接线现有认证、capabilities/session/token/dispatch/end、LiveKit SDK 和原生麦克风/生命周期。生产 lease 必须独占资源、同步停本地轨/清凭据，并自行处理返回前的内部取消；后台服务器清理结果不能由本地 disposer 推定。

下一阶段需先准备专用环境、依赖锁/缓存和授权，再做 Tauri packaged `.app` 的冷暖回跳及真实性验证、TCC 与双向至少 5 分钟/5 轮问答、ICE/TURN、耳机/断网/休眠。源码和离线用例通过仍不满足计划 M1 的硬门禁；M2 完整工程继续受此门禁约束。

本轮完成后停写，交主控独立 Review；无 commit、push、部署或发布。
