# CLI 与 daemon

Runtime 是 Nimi 的本地执行服务。正式 App 通过 Desktop 监督的 Host 和强类型 SDK 访问已准入操作，不能用自选 App ID 建立普通 gRPC 连接替代。

## 管理命令

| 命令 | 用途 |
| --- | --- |
| `nimi serve` | 运行明确的前台 Runtime 路径 |
| `nimi start` / `nimi stop` | 请求已准入的后台或服务控制器 |
| `nimi status` / `nimi health --json` | 读取脱敏的进程管理或服务摘要 |
| `nimi logs` | 读取已准入后台管理器的日志 |
| `nimi doctor` | 诊断受支持的 Runtime 连接与进程前提 |
| `nimi version` | 报告版本信息 |
| `nimi init` / `nimi config` | 管理已准入配置，不管理 Provider 凭据或产品数据根目录 |

构建没有已准入管理器时，后台命令明确失败，不创建替代进程，也不探测私有能力接口。Daemon 进程存在不证明受保护访问、模型准备或推理成功。

## 开发与生产

Home/App 开发使用仓库支持的开发启动及 Developer Mode 流程。Windows 和 macOS 本地开发使用非提权的用户级 Runtime，不以生产服务拓扑为前提。Linux 本地 App 支持仍待实现。

`nimi serve` 适合明确的 Runtime 源码开发，但单有前台 daemon 不会授权正式 App。生产服务安装、托管、更新和卸载遵循独立产品生命周期。

产品数据发现使用 `~/.nimi/nimi.json`。可选 `NIMI_RUNTIME_CONFIG_PATH` 是明确的非生产可移植模式，没有默认可移植路径。初始化前先读 [Runtime 配置](/zh/runtime/config-contract)，不要恢复退役路径或创建另一套数据根目录权威。

## 在 Home 配置 AI

「云服务」管理受保护 Connector 托管，「AI 能力」管理 Loadout、资源和机器选择；App 或共享 LocalAgent AIConfig 分别保存。CLI 没有另一套 Provider 凭据、模型选择或生成配置 ownership，Knowledge V1 也没有 CLI 路径。

## 关闭与恢复

Daemon 健康状态为 `STARTING`、`READY`、`DEGRADED`、`STOPPING`。关闭时结束对应流；传输中断可能使终止帧无法到达，不能从连接关闭推断生成成功。重新建立授权状态后，通过 owner 的恢复契约观察原 Job 或 Conversation，不重放业务工作。

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
