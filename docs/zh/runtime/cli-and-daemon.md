# Runtime 命令行与启动方式

源码开发 supervisor 与已安装的固定服务使用不同入口。排错前先确认自己使用哪一种环境。

## 源码开发

在 Nimi 仓库根目录的独立终端运行：

```sh
pnpm dev:runtime
```

该脚本启动当前用户的源码 Runtime supervisor，日志显示在终端中。随后运行 `pnpm dev:desktop` 并在 Home 登录。依赖、Realm/Web 与系统准备步骤见[开发环境准备](/zh/start/install)及仓库的 LOCAL_DEVELOPMENT.md。

普通 Windows 开发终端不能用 `nimi serve` 代替这个入口。它进入生产 daemon 启动流程，需要固定 Windows 服务身份。

## 已安装的 Windows 固定服务

以下命令需要对应固定服务已安装，并满足服务控制条件。当前 macOS/Linux 构建没有这套后台服务控制器；它们也不管理源码 supervisor。

| 命令 | 用途 |
| --- | --- |
| `nimi status` | 查询固定服务状态 |
| `nimi start` | 启动已安装的固定服务 |
| `nimi stop` | 停止该固定服务 |
| `nimi logs` | 查看该服务的日志 |

`nimi serve` 是生产 daemon 入口，不能据其名称推断可在普通终端启动受保护服务。

## 环境与服务诊断

- `nimi doctor` 检查本地环境与依赖条件。
- `nimi version` 显示二进制版本。
- `nimi health --json` 读取对应已运行服务的健康摘要，需要该服务可达并满足其访问条件。

服务 READY 表示 daemon 已开始提供 RPC；具体 AI 能力仍需有效的 Loadout、模型、会话与执行配置。源码 supervisor 的普通用户运行方式不等于生产固定服务的身份或配置方式。

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
