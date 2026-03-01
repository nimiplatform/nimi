# Desktop Kernel Contracts

> Status: Draft
> Date: 2026-03-01
> Scope: Desktop 应用全量契约（Tauri + React 19）— 启动序列 / IPC 桥接 / 状态管理 / 认证会话 / 数据同步 / Hook 能力模型 / Mod 治理 / LLM 适配器 / UI Shell / 错误边界 / 遥测日志 / 网络层 / 安全模型。

## 1. 目标

本目录是 Desktop 规范的唯一权威层（kernel layer）。
任何跨域规则只能在 kernel 定义一次，业务文档只能引用 Rule ID，不得复述。

## 2. One Fact One Home

- 单一事实源：同一规则只允许在一个 kernel 文件定义。
- 下游投影：`spec/desktop/*.md` domain 文档只能引用 kernel Rule ID。
- 冲突处理：若下游与 kernel 冲突，以 kernel 为准；下游必须在同次变更中修正。

## 3. Rule ID 规范

- 格式：`D-<DOMAIN>-NNN`
- 示例：`D-BOOT-001`、`D-IPC-003`、`D-MOD-005`
- 规则：
  - `DOMAIN` 固定枚举：`BOOT` `IPC` `STATE` `AUTH` `DSYNC` `HOOK` `MOD` `LLM` `SHELL` `ERR` `TEL` `NET` `SEC` `STRM`
  - `NNN` 三位递增编号，不复用。

## 4. 文档所有权

| 文档 | Domain | 说明 |
|---|---|---|
| `bootstrap-contract.md` | `D-BOOT-*` | 多阶段异步初始化、超时守卫、feature flag 门控 |
| `bridge-ipc-contract.md` | `D-IPC-*` | Tauri IPC 命令、代理 fetch、桥接类型解析 |
| `state-contract.md` | `D-STATE-*` | Zustand slices、运行时 store、持久化策略 |
| `auth-session-contract.md` | `D-AUTH-*` | 会话生命周期、token 持久化（web vs desktop） |
| `data-sync-contract.md` | `D-DSYNC-*` | DataSync facade 业务流规则（auth/user/chat/social/world/economy/feed/explore/notification/settings/agent/transit） |
| `hook-capability-contract.md` | `D-HOOK-*` | 5 个 hook 子系统、能力模型、权限网关 |
| `mod-governance-contract.md` | `D-MOD-*` | 8 阶段执行内核、生命周期状态、审计决策记录 |
| `llm-adapter-contract.md` | `D-LLM-*` | Provider 适配、路由、凭证库、语音引擎集成 |
| `ui-shell-contract.md` | `D-SHELL-*` | 导航 Tab、布局、路由、i18n、主题、分包 |
| `error-boundary-contract.md` | `D-ERR-*` | 错误边界、错误归一化、bridge 错误映射 |
| `telemetry-contract.md` | `D-TEL-*` | 结构化日志、流 ID、日志区域、消息格式 |
| `network-contract.md` | `D-NET-*` | 代理 fetch、请求重试、指数退避、可重试状态码、实时传输 |
| `security-contract.md` | `D-SEC-*` | CSP、Keyring、OAuth、Bearer Token、端点安全 |
| `streaming-consumption-contract.md` | `D-STRM-*` | 流式消费生命周期、渲染缓冲、错误恢复、取消语义 |

## 5. 结构化事实源

`tables/` 目录中的 YAML 是后续自动生成表格与 lint 的事实源：

- `tables/bootstrap-phases.yaml`
- `tables/ipc-commands.yaml`
- `tables/app-tabs.yaml`
- `tables/store-slices.yaml`
- `tables/hook-subsystems.yaml`
- `tables/hook-capability-allowlists.yaml`
- `tables/ui-slots.yaml`
- `tables/turn-hook-points.yaml`
- `tables/mod-kernel-stages.yaml`
- `tables/mod-lifecycle-states.yaml`
- `tables/mod-access-modes.yaml`
- `tables/feature-flags.yaml`
- `tables/data-sync-flows.yaml`
- `tables/retry-status-codes.yaml`
- `tables/error-codes.yaml`
- `tables/log-areas.yaml`
- `tables/build-chunks.yaml`

## 6. 自动生成视图

`generated/` 目录由 `scripts/generate-desktop-spec-kernel-docs.mjs` 从 YAML 生成。
禁止手动编辑。修改时先改 YAML，再执行：

```bash
pnpm generate:desktop-spec-kernel-docs
```
