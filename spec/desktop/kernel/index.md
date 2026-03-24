# Desktop Kernel Contracts

> Scope: Desktop 应用全量契约（启动序列 / IPC / 状态 / 会话 / 数据同步 / Hook / Mod 治理 / LLM / UI / 错误 / 遥测 / 网络 / 安全 / 流消费 / Codegen）。

## 1. 目标

本目录是 Desktop 规范唯一权威层。任何跨域规则只能在 kernel 定义一次，domain 文档只允许引用 Rule ID。

## 2. One Fact One Home

- 单一事实源：同一规则只允许在一个 kernel 文件定义。
- 下游投影：`spec/desktop/*.md` 仅保留导引与映射。
- 冲突处理：下游与 kernel 冲突时，以 kernel 为准。

## 3. Rule ID 规范

- 格式：`D-<DOMAIN>-NNN`
- `DOMAIN` 固定枚举：`BOOT` `IPC` `STATE` `AUTH` `DSYNC` `HOOK` `MOD` `LLM` `SHELL` `MBAR` `ERR` `TEL` `NET` `SEC` `STRM` `OFFLINE` `CODEGEN` `GATE`
- `NNN` 三位递增编号，不复用。

## 4. 文档所有权

| 文档 | Domain | 说明 |
|---|---|---|
| `bootstrap-contract.md` | `D-BOOT-*` | 多阶段异步初始化、feature flag 门控 |
| `bridge-ipc-contract.md` | `D-IPC-*` | Tauri IPC 命令与桥接类型 |
| `self-update-contract.md` | cross-cutting (`D-BOOT-001`, `D-IPC-002`, `D-IPC-009`) | packaged desktop 自更新、bundled runtime staging 与 release 真值契约 |
| `state-contract.md` | `D-STATE-*` | Zustand slices 与持久化策略 |
| `auth-session-contract.md` | `D-AUTH-*` | 会话生命周期、token 持久化 |
| `data-sync-contract.md` | `D-DSYNC-*` | DataSync 业务流规则 |
| `hook-capability-contract.md` | `D-HOOK-*` | Hook 子系统与能力网关 |
| `mod-governance-contract.md` | `D-MOD-*` | 8 阶段执行内核与审计 |
| `llm-adapter-contract.md` | `D-LLM-*` | Provider 适配与路由边界 |
| `ui-shell-contract.md` | `D-SHELL-*` | 导航、布局、路由、分包 |
| `menu-bar-shell-contract.md` | `D-MBAR-*` | macOS menu bar shell 入口、导航与 close/hide 语义 |
| `error-boundary-contract.md` | `D-ERR-*` | 错误边界与归一化映射 |
| `telemetry-contract.md` | `D-TEL-*` | 结构化日志与消息格式 |
| `network-contract.md` | `D-NET-*` | 重试、退避、实时传输边界 |
| `security-contract.md` | `D-SEC-*` | CSP、凭据委托、OAuth、端点安全 |
| `streaming-consumption-contract.md` | `D-STRM-*` | 流式消费、取消与恢复语义 |
| `offline-degradation-contract.md` | `D-OFFLINE-*` | Runtime/Realm 离线降级、缓存与重连冲突策略 |
| `codegen-contract.md` | `D-CODEGEN-*` | mod codegen 规则、预检、门禁与回滚 |
| `testing-gates-contract.md` | `D-GATE-*` | Desktop 测试治理、E2E 风险分层与发布门禁 |

## 5. 结构化事实源

`tables/` 目录中的 YAML 是自动生成表格与 lint 的事实源：

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
- `tables/renderer-design-tokens.yaml`
- `tables/renderer-design-surfaces.yaml`
- `tables/renderer-design-sidebars.yaml`
- `tables/renderer-design-overlays.yaml`
- `tables/renderer-design-allowlists.yaml`
- `tables/desktop-testing-gates.yaml`
- `tables/desktop-feature-coverage.yaml`
- `tables/rule-evidence.yaml`（fragment directive；实际内容委托给 `tables/rule-evidence.catalog.yaml` 与 `tables/rule-evidence.rules.yaml`）
- `tables/codegen-import-allowlist.yaml`
- `tables/codegen-capability-tiers.yaml`
- `tables/codegen-static-scan-deny-patterns.yaml`
- `tables/codegen-acceptance-gates.yaml`

## 6. Kernel Companion 约束

- `kernel/companion/*.md` 为解释层，不定义规则。
- 每个 companion 章节必须声明 `Anchors:` 指向 `D-*` Rule。

## 7. 自动生成视图

`generated/` 目录由 `scripts/generate-desktop-spec-kernel-docs.mjs` 从 YAML 生成。修改 tables 后必须执行生成并通过 docs drift 检查。
