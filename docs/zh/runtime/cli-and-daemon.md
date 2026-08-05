# CLI 与 daemon

Runtime 是一个 Go 二进制 daemon 加上一个 CLI。本页讲面向用户的那一面：daemon 是什么、CLI 干什么、第一次跑起来大概是什么样。

## daemon

Runtime daemon 是机器上长期运行的进程，AI 执行归它所有。应用经 gRPC 连进来。文本、图、视频、音频、嵌入、STT、TTS 工作，加上 GPU 仲裁、模型生命周期、本地审计账本，都集中在这一个位置。

| 属性 | 取值 |
| --- | --- |
| 二进制 | 单一 Go 二进制 |
| 传输 | gRPC |
| 生命周期 | `STARTING → READY → DEGRADED → STOPPING` |
| 多 Agent | 同时托管多个 `agent_id` 生命周期 |
| 默认当前 Agent | 没有（默认就是多 Agent） |

daemon 健康状态各有明确语义。进入 `STOPPING` 时流被干净取消，daemon 不会扔下半截流不发终止帧。

## CLI（`nimi`）

CLI 是面向用户的工具，用来驱动 daemon 并报告它的状态。

| 命令 | 用途 |
| --- | --- |
| `nimi init` | 初始化 Runtime 配置 |
| `nimi serve` | 前台运行 daemon |
| `nimi start` | 后台启动 daemon |
| `nimi stop` | 停止 daemon |
| `nimi status` | 查看 daemon 状态 |
| `nimi logs` | 读 daemon 日志 |
| `nimi doctor` | 诊断 daemon、provider、模型、审计量、复制积压 |
| `nimi version` | 查看 CLI 与 daemon 版本 |

CLI 不是通用的远程控制台。它只覆盖一小组有边界的操作，对应 daemon 的生命周期和可观察性需要。要加新动词，得先有准入的契约扩展。

## 首次运行

首次运行有固定的形态，用户装完不会面对一个不知道下一步该做什么的窗口。

```
install → 首次运行选择
                │
       ┌────────┴────────┐
       ▼                 ▼
  provider 优先    本地模型优先
   云端配置          安装
       │                 │
       └─────────┬───────┘
                 ▼
            daemon 就绪
```

| 路径 | 适用 |
| --- | --- |
| Provider 优先 | 你已经有准入的云端 provider 账户，想从云端能力开始 |
| 本地模型优先 | 你想完全本地起步，安装一个本地引擎和一份模型包 |

两条路最终都汇到一个 `READY` 的 daemon。Runtime 会为请求的 AI 能力选择已准入的实现。

## 读者场景：从安装到第一次生成

你刚装好 Nimi，想确认一切正常。

1. **初始化配置。** `nimi init` 在配置缺失时创建 Runtime 配置。
2. **配置 Runtime。** 云端路径写入 provider 凭据或凭据引用；本地路径安装已准入的模型资源。两者都是机器侧配置，不进入 App 请求。
3. **启动 daemon。** `nimi serve`（或后台 `nimi start`）。daemon 通过 `STARTING → READY`。
4. **核对。** `nimi doctor` 显示 daemon `READY`、Runtime 配置和已安装资源状态、审计量以及复制积压。
5. **第一次生成。** App 经 SDK 发起能力请求。Runtime 选择已准入实现，并返回强类型结果或失败。

CLI 暴露的信息够确认健康，但不暴露内部状态。`nimi doctor` 报黄或红时，会指出具体区域并指向相关 kernel 规则上下文。

## 读者场景：从降级状态恢复

daemon 进入 `DEGRADED`：可能某个 provider 中途变不健康，可能复制有积压。

1. **`nimi status` 报 `DEGRADED`。** daemon 还在服务，但能力打了折。
2. **`nimi doctor`** 指出具体退化点，例如 Runtime 管理的 provider 配置异常或复制积压 N。
3. **行动。** 你处理底层配置、等待积压排空，或重启卡住的子组件。
4. **`nimi status` 回到 `READY`。** 退化期间在跑的流要么按契约完成，要么以强类型失败帧终止；新流恢复正常。

状态机让恢复变得有路可走。如果只给"健康 / 不健康"两态，难以看出问题在哪；强类型退化让 CLI 能直接指向区域。

## 凭据保管

CLI 只能通过已准入的管理命令，把 provider 凭据或凭据引用写入 Runtime 拥有的 daemon 配置。普通 App 能力请求不会注入 provider 凭据，也不会选择凭据记录。Runtime 在请求准入后解析凭据，并确保凭据不会进入 SDK 结果、App 日志或 App 存储。

## 来源依据

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
