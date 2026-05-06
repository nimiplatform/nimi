# CLI 与 Daemon

Runtime 是一个 Go binary daemon 加一个 CLI。这页讲用户面 — Daemon 是什么、CLI 干什么、第一次跑起来是什么样。

## Daemon

Runtime daemon 是常驻进程，拥有这台机器上的 AI 执行。App 通过 gRPC 连接它。它是文本 / 图像 / 视频 / 音频 / Embedding / STT / TTS 工作、GPU 仲裁、Model 生命周期、本地审计 ledger 的唯一座位。

| 性质 | 值 |
| --- | --- |
| 二进制 | 单一 Go binary |
| 传输 | gRPC |
| 生命周期 | `STARTING → READY → DEGRADED → STOPPING` |
| 多 Agent | 同时承载多个 `agent_id` 生命周期 |
| 默认当前 Agent | 无（默认就是多 Agent） |

Daemon 健康状态有明确语义。`STOPPING` 时流式干净地取消；daemon 不会丢下飞行中的流不发类型化终止帧。

## CLI（`nimi`）

CLI 是用户面工具，驱动 daemon 并报告它的状态。

| 命令 | 用途 |
| --- | --- |
| `nimi install` | 第一次安装路径 |
| `nimi serve` | 前台跑 daemon |
| `nimi start` | 后台启动 daemon |
| `nimi stop` | 停止 daemon |
| `nimi status` | 显示 daemon 状态 |
| `nimi logs` | 读 daemon 日志 |
| `nimi doctor` | 诊断 daemon、Provider、Model、审计写入量、复制 backlog |
| `nimi version` | 显示 CLI 与 daemon 版本 |

CLI 不是任意状态的远控面。它是一组有限的、与 daemon 生命周期与可观测性需求对齐的操作。新动词需要准入的合同扩展。

## 第一次运行的形状

第一次运行有定义好的形状，不会让用户安装完面对一个「然后呢」的真空。

```
install → 第一次运行选择
                │
       ┌────────┴────────┐
       ▼                 ▼
Provider 优先     Local Model 优先
云端配置          本地引擎安装
       │                 │
       └─────────┬───────┘
                 ▼
           daemon ready
```

| 路径 | 什么时候选 |
| --- | --- |
| Provider 优先云端配置 | 你已经有一个准入的云 Provider 账号，希望先从云能力开始 |
| Local Model 优先 | 你想从纯本地开始；安装本地引擎和 Model bundle |

两条路最终都汇到一个 `READY` 的 daemon，至少有一条准入的 AI 能力路由。

## 阅读场景：从安装到第一次生成

你刚装完 Nimi，想确认一切就绪。

1. **Install。** `nimi install` 走安装路径。Daemon 二进制就位；配置 bootstrap。
2. **第一次运行选择。** CLI 给出 Provider 优先 / Local Model 优先两个选择。你已经有 Provider 账号，挑 Provider 优先。
3. **Connector 配置。** 给该 Provider 加一个 connector — 一个被托管的身份。凭据被校验；connector 报告该身份能路由到哪些 Model。
4. **启动 daemon。** `nimi serve`（或 `nimi start` 后台）。Daemon 生命周期走 `STARTING → READY`。
5. **校验。** `nimi doctor` 报告 daemon `READY`、Provider 健康绿、Model 准备绿、审计写入量为零、复制 backlog 为零。
6. **第一次生成。** App 通过 gRPC 连上来发请求。请求变成 `ScenarioJob`；工作流走 `ACCEPTED → QUEUED → RUNNING → COMPLETED`。

CLI 暴露的恰好够确认健康，不暴露内部状态。如果 `nimi doctor` 报黄或红，报告会指出哪一块出问题，并指向相关 kernel 规则上下文。

## 阅读场景：从降级状态恢复

Daemon 进入 `DEGRADED` — 也许是中途某个 Provider 不健康了，也许是复制 backlog 堆了。

1. **`nimi status` 报 `DEGRADED`。** Daemon 还在服务，但能力打了折。
2. **`nimi doctor`** 报告具体降级原因：Provider X 健康红，复制 backlog 多少。
3. **动作。** 修底层问题（换到另一个准入 Provider、等 backlog 清掉、重启卡住的子组件）。
4. **`nimi status` 回到 `READY`。** 降级期间在跑的流，要么按合同走完，要么收到类型化失败终止帧；新流照常工作。

让这个过程可恢复的是状态机本身。一个二元的「健康 / 不健康」报告告诉不了你哪里出问题；类型化的降级让 CLI 能指向问题区域。

## 凭据面切分

CLI 在严格隔离的边界下管理凭据：

| 面 | 用途 |
| --- | --- |
| `daemon-config` | 配置驱动的 API key（设置一次，长期有效） |
| `request-credential` | 来自可信宿主的请求级注入 |

两个面严格隔离。一个 `daemon-config` 的 key 永远不会泄漏到 `request-credential` 请求里，反之亦然。这是因为信任边界不一样：daemon-config 的 key 在启动时准入；request 凭据按请求准入。

## 来源

- [`.nimi/spec/runtime/cli.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/cli.md)
- [`.nimi/spec/runtime/config.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/config.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`.nimi/spec/runtime/kernel/daemon-lifecycle.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/daemon-lifecycle.md)
- [`.nimi/spec/runtime/kernel/config-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/config-contract.md)
- [`.nimi/spec/runtime/kernel/tables/daemon-health-states.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/daemon-health-states.yaml)
