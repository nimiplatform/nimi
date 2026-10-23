# Runtime 命令行与启动方式

源码开发模式下的 Runtime supervisor 与已安装的系统固定服务采用完全不同的运行入口。在执行启动或排错前，请先确认当前所处的运行环境。

## 源码开发

在 Nimi 仓库根目录的独立终端运行：

```sh
pnpm dev:runtime
```

该脚本启动当前用户的源码 Runtime supervisor，日志直接输出在终端中。随后运行 `pnpm dev:desktop` 并在 Home 登录。依赖、Realm/Web 与系统准备步骤见[开发环境准备](/zh/start/install)及仓库的 LOCAL_DEVELOPMENT.md。

在 Windows 普通开发终端中，不能用 `nimi serve` 代替该命令：`nimi serve` 会进入生产 daemon 的专有流程，需要特定的 Windows 服务特权身份。

## 已安装的 Windows 固定服务

以下命令需要对应固定服务已安装，并满足服务控制条件。当前 macOS/Linux 构建未提供这套后台服务控制器；这些命令也不会管理源码 supervisor。

| 命令 | 用途 |
| --- | --- |
| `nimi status` | 查询固定服务状态 |
| `nimi start` | 启动已安装的固定服务 |
| `nimi stop` | 停止该固定服务 |
| `nimi logs` | 当前返回 `protected Runtime service logs are unavailable`，暂不支持读取服务日志 |

`nimi stop` 通过服务控制器停止服务，不提供 `--force` 选项。源码开发日志请查看运行 `pnpm dev:runtime` 的终端；`nimi logs` 不读取 supervisor 日志。

`nimi serve` 是生产 daemon 内部启动入口，无法在普通非特权终端中直接拉起受保护的系统服务。

## 环境与服务诊断

- `nimi doctor` 检查本地环境与依赖条件。
- `nimi version` 显示二进制版本。
- `nimi health --json` 与 `nimi status` 使用同一份服务控制器状态，健康分类为 `service-running` 或 `stopped`。

`service-running` 表示 Windows 服务控制器确认服务正在运行，并不代表 RPC 或 AI 能力已经就绪。具体 AI 能力调用仍需有效的授权会话及执行配置，并按所选路由具备就绪的本地 Loadout 或受支持的云端目标。源码 supervisor 仅以普通用户模式运行，并不具备生产固定服务的系统身份与配置环境。

## 相关文档

- [Runtime 配置](/zh/runtime/config-contract)
- [App 排错](/zh/start/troubleshooting)

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`scripts/dev-runtime.mjs`](https://github.com/nimiplatform/nimi/blob/main/scripts/dev-runtime.mjs)
- [`runtime/internal/entrypoint/runtime_production_windows.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/entrypoint/runtime_production_windows.go)
- [`runtime/internal/daemonctl/manager.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/daemonctl/manager.go)
- [`runtime/internal/daemonctl/protected_service_controller_stub.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/daemonctl/protected_service_controller_stub.go)
