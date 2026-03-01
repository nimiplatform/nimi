# Platform Architecture

> Domain: Platform / Architecture
> Status: Frozen
> Date: 2026-03-01

## 0. Normative Imports

| Kernel Location | Rule IDs |
|---|---|
| `kernel/architecture-contract.md` | P-ARCH-001–030 |
| `kernel/protocol-contract.md` | P-PROTO-002, P-PROTO-003, P-PROTO-010, P-PROTO-011, P-PROTO-020 |

## 1. 架构总览

六层架构定义见 P-ARCH-001。核心关系：

```
nimi-mods ←→ desktop       : 进程内 nimi-hook
desktop → nimi-realm         : SDK realm（REST + WS）
desktop → nimi-runtime       : SDK runtime（gRPC）
nimi-apps → nimi-realm       : SDK realm
nimi-apps → nimi-runtime     : SDK runtime
```

## 2. nimi-realm 详述

云端持久世界（P-ARCH-003）。通信协议：REST + WebSocket。对应代码：`nimi-realm`（NestJS + Prisma + PostgreSQL + Redis）。

关键特征：共享真相源。身份、社交关系、经济账本、World/Agent 定义、记忆构成 Realm 的持久状态。

## 3. nimi-runtime 详述

独立本地后台进程（P-ARCH-004）。本质：进程管理器 + gRPC API 门面。

V1 执行栈冻结（P-ARCH-010）。双凭证平面（P-ARCH-011）。实现语言固定 Go。

生命周期：首个 App 连接时拉起，最后一个断开后 graceful shutdown。

### 3.1 nimi-cli

CLI 入口，类比 Ollama CLI。与 daemon 共享同一 Go 二进制：`nimi serve` 启动 daemon，其他命令作为 gRPC client。

## 4. nimi-sdk 详述

开发者接口层（P-ARCH-020）。单包 `@nimiplatform/sdk`，realm 子路径 + runtime 子路径 + scope 模块。Transport profiles: node-grpc, tauri-ipc, local-broker(FUTURE)。

## 5. Desktop 与 Hook 详述

Desktop 定位见 P-ARCH-021。nimi-hook 五个子系统：event-bus、data-api、ui-extension、turn-hook、inter-mod。Hook 系统只存在于 desktop 内。

## 6. 审计双层模型

见 P-ARCH-030。runtime 本地审计与 realm 云端审计独立运行。

## 7. ExternalPrincipal 授权链路

规范来源：P-PROTO-020。链路：App 决策策略 → SDK 封装 scope → Runtime/Realm 执行 → ExternalPrincipal 访问。
