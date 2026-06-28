# Desktop Kernel Contracts

> Scope: Desktop 应用全量契约（启动序列 / IPC / 状态 / 会话 / 数据同步 / LLM / UI / 错误 / 遥测 / 网络 / 安全 / 流消费）。

## 1. 目标

本目录是 Desktop 规范唯一权威层。任何跨域规则只能在 kernel 定义一次，domain 文档只允许引用 Rule ID。

## 2. One Fact One Home

- 单一事实源：同一规则只允许在一个 kernel 文件定义。
- 下游投影：`.nimi/spec/desktop/*.md` 仅保留导引与映射。
- 冲突处理：下游与 kernel 冲突时，以 kernel 为准。

## 3. Rule ID 规范

- 格式：`D-<DOMAIN>-NNN`
- `DOMAIN` 固定枚举：`BOOT` `IPC` `STATE` `AUTH` `DSYNC` `LLM` `SHELL` `MBAR` `HOME` `HOMEFEED` `EXPL` `REL` `AIPC` `SUP` `DEV` `ERR` `TEL` `NET` `SEC` `STRM` `OFFLINE` `GATE`
- `NNN` 三位递增编号，不复用。

## 4. 文档所有权

| 文档 | Domain | 说明 |
|---|---|---|
| `bootstrap-contract.md` | `D-BOOT-*` | 多阶段异步初始化、feature flag 门控 |
| `bridge-ipc-contract.md` | `D-IPC-*` | Tauri IPC 命令与桥接类型 |
| `self-update-contract.md` | cross-cutting (`D-BOOT-001`, `D-IPC-002`, `D-IPC-014`, `D-IPC-015`) | packaged desktop 自更新、bundled runtime staging 与 release 真值契约 |
| `state-contract.md` | `D-STATE-*` | Zustand slices、持久化策略、pending action lifecycle projection boundary |
| `auth-session-contract.md` | `D-AUTH-*` | 会话生命周期、token 持久化 |
| `data-sync-contract.md` | `D-DSYNC-*` | DataSync non-admission owner map |
| `llm-adapter-contract.md` | `D-LLM-*` | Provider 适配与路由边界 |
| `conversation-capability-contract.md` | `D-LLM-*` | Conversation capability selection/projection、agent overlay、execution snapshot；不拥有 resolved message / action truth |
| `agent-chat-projection-contract.md` | `D-LLM-*` | Desktop Agent Chat projection / presentation surface：shell placement, user input handoff, Runtime/SDK projection rendering, fail-closed UI states；不拥有 Agent Chat orchestration / execution / prompt / voice workflow / media truth |
| `agent-avatar-surface-contract.md` | `D-LLM-*` | Agent avatar transient surface + desktop bridge/handoff authority：`AvatarInteractionState`、desktop-to-`apps/avatar` launch semantics、desktop carrier decommission boundary、and retained non-carrier shell scope |
| `agent-avatar-configuration-contract.md` | `D-LLM-*` | Agent Chat Settings Avatar configuration control surface：closed config record, local Avatar asset selection authority, opaque profile refs, minimal launch payload hard cut, fail-closed readiness UX, and no Desktop-local binding/carrier authority (remote marketplace package sources retired with Asset Market) |
| `agent-avatar-debug-workbench-contract.md` | `D-LLM-*` | Desktop Avatar debug workbench product surface：typed probe views, remediation states, Runtime replay links, and no raw backend/app bus bypass |
| `agent-delegation-control-surface-contract.md` | `D-LLM-*` | Runtime-owned delegated capability gateway 的 Desktop product control surface：agent chat settings / avatar config / connector config / debug workbench / approval UX；不拥有 provider execution、approval semantics、credential custody、firewall/audit truth |
| `realm-group-agent-participation-surface-contract.md` | `D-LLM-*` | Desktop/Web Realm GROUP agent participation control/projection hardcut：typed SDK/Realm/Runtime consumers only；不拥有 prompt/provider/model、memory、queue、scheduler、or commit truth |
| `companion-participation-control-surface-contract.md` | `D-LLM-*` | Desktop Avatar companion/persona participation control/projection hardcut：typed SDK/Runtime consumers only；不拥有 prompt/provider/model、memory、queue、scheduler、or commit truth |
| `ui-shell-contract.md` | `D-SHELL-*` | 导航、布局、路由、分包 |
| `support-surface-contract.md` | `D-SUP-*` | Desktop `Support` 独立 secondary 系统表面产品语义：repair / updates / diagnostics / logs-export / recovery-help 五子区、self-update 投影宿主、`P-MIG-*` 修复流程消费边界、degraded-state 可达性；不拥有 self-update 机制、`~/.nimi` 迁移执行、Runtime diagnostic/log/audit 真值、product-control first-run 状态机 |
| `devtools-contract.md` | `D-DEV-*` | Desktop `Developer Tools` 表面与 `Developer Mode` 门控产品语义：可发现 Developer Mode 切换、DevTools surface 门控、developer diagnostics 可见性；`D-SHELL-009` 的门控收口 |
| `nimi-home-shell-contract.md` | `D-HOME-*` | Desktop-hosted Nimi Home shell IA、first-run / return-run state machine、surface registry placement、Agent Chat in-shell reference placement、`AIScopeRef` enforcement、no-private-path enforcement、self-update UI projection、first-screen rule、failure-projection as first-class surface |
| `home-feed-contract.md` | `D-HOMEFEED-*` | Desktop `Home` primary-nav tab 作为 Realm feed 表面的产品语义：四个 feed scope（personal / friends / persona_activity / world_character_activity）呈现、Create Post affordance、SDK-typed Realm feed projection 消费边界、与 `D-HOME-*`（`Nimi Home` installed shell）的显式 non-overlap、`Home` 非 ready entry；不拥有 shell 导航布局、Realm Post / Feed canonical 真值 |
| `ai-profile-config-contract.md` | `D-AIPC-*` | Desktop `AIProfile` / `AIConfig` / `AISnapshot` 三段式 AI 配置 canonical model 与 `D-LLM-015` ~ `D-LLM-021` 的 umbrella 关系 |
| `explore-surface-contract.md` | `D-EXPL-*` | Explore 统一 Realm 发现表面产品语义：三区结构（Worlds / Personas / Activity）、WorldCore card / detail 字段语义、RealmPersona card 与 source-state → primary-action 模型、local materialization handoff、controlled World creation 边界；不拥有导航布局、LocalAgent materialization、WorldCore canonical truth |
| `relationship-profile-surface-contract.md` | `D-REL-*` | Contextual relationship/profile UX：shared human/source profile modal、admitted social actions、local materialization handoff state projection；不拥有导航布局、Realm discovery、LocalAgent materialization |
| `kit-ui-consumption-contract.md` | `D-SHELL-*` | Desktop 对 `@nimiplatform/kit/ui` 的消费清单、保留 composition、allowlist 与受控例外 |
| `menu-bar-shell-contract.md` | `D-MBAR-*` | macOS menu bar shell 入口、导航与 close/hide 语义 |
| `error-boundary-contract.md` | `D-ERR-*` | 错误边界与归一化映射 |
| `telemetry-contract.md` | `D-TEL-*` | 结构化日志与消息格式 |
| `network-contract.md` | `D-NET-*` | 重试、退避、实时传输边界 |
| `security-contract.md` | `D-SEC-*` | CSP、凭据委托、OAuth、端点安全 |
| `streaming-consumption-contract.md` | `D-STRM-*` | 流式消费、取消与恢复语义；只消费 beat/action outputs，不拥有其 product semantics |
| `offline-degradation-contract.md` | `D-OFFLINE-*` | Runtime/Realm 离线降级、缓存与重连冲突策略 |
| `testing-gates-contract.md` | `D-GATE-*` | Desktop 测试治理、E2E 风险分层与发布门禁 |
| `command-execution-contract.md` | `D-GATE-*` | Desktop Tauri invoke command execution classes, cross-crate registered surface SSOT, blocking admission, and fail-closed gate |

## 5. 结构化事实源

`tables/` 目录中的 YAML 是自动生成表格与 lint 的事实源：

- `tables/bootstrap-phases.yaml`
- `tables/ipc-commands.yaml`
- `tables/app-tabs.yaml`
- `tables/store-slices.yaml`
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
- `tables/nimi-kit-adoption.yaml`
- `tables/nimi-kit-compositions.yaml`
- `tables/nimi-kit-allowlists.yaml`
- `tables/desktop-testing-gates.yaml`
- `tables/command-execution-classification.yaml`
- `tables/desktop-feature-coverage.yaml`
- `tables/agent-avatar-configuration.schema.yaml`
- `tables/agent-avatar-debug-workbench-probes.yaml`
- `tables/agent-avatar-debug-remediation-states.yaml`
- `tables/nimi-home-surfaces.yaml`
- `tables/home-feed-scopes.yaml`
- `tables/explore-sections.yaml`
- `tables/realm-persona-materialization-actions.yaml`
- `tables/relationship-categories.yaml`
- `tables/relationship-friend-request-states.yaml`
- `tables/rule-evidence.yaml`（fragment directive；实际内容委托给 `tables/rule-evidence.catalog.yaml` 与 `tables/rule-evidence.rules-*.yaml`，含 `tables/rule-evidence.rules-support-devtools.yaml`）

## 6. Kernel Companion 约束

- `kernel/companion/*.md` 为解释层，不定义规则。
- 每个 companion 章节必须声明 `Anchors:` 指向 `D-*` Rule。

## 7. Derived Views

Desktop table views are rendered on demand with `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope desktop`. The views are stdout artifacts; `generated/` is not a product authority directory.
