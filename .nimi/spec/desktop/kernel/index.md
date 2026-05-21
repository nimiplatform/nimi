# Desktop Kernel Contracts

> Scope: Desktop 应用全量契约（启动序列 / IPC / 状态 / 会话 / 数据同步 / Hook / Mod 治理 / LLM / UI / 错误 / 遥测 / 网络 / 安全 / 流消费 / Codegen）。

## 1. 目标

本目录是 Desktop 规范唯一权威层。任何跨域规则只能在 kernel 定义一次，domain 文档只允许引用 Rule ID。

## 2. One Fact One Home

- 单一事实源：同一规则只允许在一个 kernel 文件定义。
- 下游投影：`.nimi/spec/desktop/*.md` 仅保留导引与映射。
- 冲突处理：下游与 kernel 冲突时，以 kernel 为准。

## 3. Rule ID 规范

- 格式：`D-<DOMAIN>-NNN`
- `DOMAIN` 固定枚举：`BOOT` `IPC` `STATE` `AUTH` `DSYNC` `HOOK` `MOD` `LLM` `SHELL` `MBAR` `HOME` `HOMEFEED` `EXPL` `AIPC` `ERR` `TEL` `NET` `SEC` `STRM` `OFFLINE` `CODEGEN` `GATE`
- `NNN` 三位递增编号，不复用。

## 4. 文档所有权

| 文档 | Domain | 说明 |
|---|---|---|
| `bootstrap-contract.md` | `D-BOOT-*` | 多阶段异步初始化、feature flag 门控 |
| `bridge-ipc-contract.md` | `D-IPC-*` | Tauri IPC 命令与桥接类型 |
| `self-update-contract.md` | cross-cutting (`D-BOOT-001`, `D-IPC-002`, `D-IPC-014`, `D-IPC-015`) | packaged desktop 自更新、bundled runtime staging 与 release 真值契约 |
| `state-contract.md` | `D-STATE-*` | Zustand slices、持久化策略、pending action lifecycle projection boundary |
| `auth-session-contract.md` | `D-AUTH-*` | 会话生命周期、token 持久化 |
| `data-sync-contract.md` | `D-DSYNC-*` | DataSync 业务流规则 |
| `knowledge-ui-contract.md` | `D-DSYNC-*` | 已退役的 Runtime Config Knowledge UI hard-cut；RuntimeCognitionService knowledge 仍为 runtime/SDK API，不是 Desktop 配置页 |
| `hook-capability-contract.md` | `D-HOOK-*` | Hook 子系统与能力网关 |
| `mod-governance-contract.md` | `D-MOD-*` | 8 阶段执行内核与审计 |
| `llm-adapter-contract.md` | `D-LLM-*` | Provider 适配与路由边界 |
| `world-tour-tester-contract.md` | `D-LLM-*` | Developer-only `nimi.tester` World Tour authority：`world.generate` baseline end-to-end acceptance semantics、runtime-owned route/job/result consumption、Spark 2.0 SPZ render proof、app-owned fixture custody；Desktop-embedded Tester is frozen migration source only and does not own ordinary primary navigation / Explore / canonical Realm world truth |
| `conversation-capability-contract.md` | `D-LLM-*` | Conversation capability selection/projection、agent overlay、execution snapshot；不拥有 resolved message / action truth |
| `agent-chat-behavior-contract.md` | `D-LLM-*` | Agent chat generic behavior semantics、single-message / turn-mode / experience-policy authority；不拥有 message-action truth |
| `agent-avatar-surface-contract.md` | `D-LLM-*` | Agent avatar transient surface + desktop bridge/handoff authority：`AvatarInteractionState`、desktop-to-`apps/avatar` launch semantics、desktop carrier decommission boundary、and retained non-carrier shell scope |
| `agent-avatar-configuration-contract.md` | `D-LLM-*` | Agent Chat Settings Avatar configuration and package control surface：closed config record, typed Asset Market/SDK projections, opaque package/profile refs, minimal launch payload hard cut, fail-closed readiness UX, and no Desktop-local binding/carrier/package authority |
| `agent-avatar-debug-workbench-contract.md` | `D-LLM-*` | Desktop Avatar debug workbench product surface：typed probe views, remediation states, Runtime replay links, and no raw backend/app bus bypass |
| `agent-delegation-control-surface-contract.md` | `D-LLM-*` | Runtime-owned delegated capability gateway 的 Desktop product control surface：agent chat settings / avatar config / connector config / debug workbench / approval UX；不拥有 provider execution、approval semantics、credential custody、firewall/audit truth |
| `realm-group-agent-participation-surface-contract.md` | `D-LLM-*` | Desktop/Web Realm GROUP agent participation control/projection hardcut：typed SDK/Realm/Runtime consumers only；不拥有 prompt/provider/model、memory、queue、scheduler、or commit truth |
| `companion-participation-control-surface-contract.md` | `D-LLM-*` | Desktop Avatar companion/persona participation control/projection hardcut：typed SDK/Runtime consumers only；不拥有 prompt/provider/model、memory、queue、scheduler、or commit truth |
| `agent-chat-message-action-contract.md` | `D-LLM-*` | Agent chat single-message / unified action semantics after APML projection、model-generated modality prompt semantics、immediate post-turn action semantics、deferred continuation handoff boundary |
| `agent-chat-voice-executor-contract.md` | `D-LLM-*` | Agent chat resolved voice action consumption、`audio.synthesize` first-packet execution semantics、playback-ready speech artifact outcome authority；不拥有 voice workflow / voice asset / broader session truth |
| `agent-chat-voice-session-contract.md` | `D-LLM-*` | Agent chat broader voice session authority：explicit entry / exit、same-anchor text/voice continuity、admitted listening modes（`push-to-talk` / foreground `hands-free`）、interruption、transcript/caption rules；不拥有 voice executor / workflow / wake-word / background continuation truth |
| `agent-chat-voice-workflow-contract.md` | `D-LLM-*` | Agent chat richer voice workflow authority：`voice_workflow.voice_clone` / `voice_workflow.voice_design` admission、voice identity / `VoiceReference`、preset/custom voice selection、packet-bounded clone/design trigger、workflow return-path truth；不拥有 APML-projected resolved message/action / runtime workflow substrate / broader voice session truth |
| `ui-shell-contract.md` | `D-SHELL-*` | 导航、布局、路由、分包 |
| `nimi-home-shell-contract.md` | `D-HOME-*` | Desktop-hosted Nimi Home shell IA、first-run / return-run state machine、surface registry placement、Agent Chat in-shell reference placement、`AIScopeRef` enforcement、no-private-path enforcement、self-update UI projection、first-screen rule、failure-projection as first-class surface |
| `home-feed-contract.md` | `D-HOMEFEED-*` | Desktop `Home` primary-nav tab 作为 Realm feed 表面的产品语义：三个 feed scope（personal / friends / agent_activity）呈现、Create Post affordance、SDK-typed Realm feed projection 消费边界、与 `D-HOME-*`（`Nimi Home` installed shell）的显式 non-overlap、`Home` 非 ready entry；不拥有 shell 导航布局、Realm Post / Feed canonical 真值 |
| `ai-profile-config-contract.md` | `D-AIPC-*` | Desktop `AIProfile` / `AIConfig` / `AISnapshot` 三段式 AI 配置 canonical model 与 `D-LLM-015` ~ `D-LLM-021` 的 umbrella 关系 |
| `explore-surface-contract.md` | `D-EXPL-*` | Explore 统一 Realm 发现表面产品语义：四区结构（Worlds / Agents / Activity / Create Agent）、World card / detail 字段语义、RealmAgent card 与 friend-state → primary-action 模型、lightweight RealmAgent creation 的 draft-before-truth 规则、controlled World creation 边界；不拥有导航布局、Friendship / AgentFriend canonical 真值、LocalAgent projection / `localAgentRef`、World canonical truth |
| `kit-ui-consumption-contract.md` | `D-SHELL-*` | Desktop 对 `@nimiplatform/nimi-kit/ui` 的消费清单、保留 composition、allowlist 与受控例外 |
| `menu-bar-shell-contract.md` | `D-MBAR-*` | macOS menu bar shell 入口、导航与 close/hide 语义 |
| `error-boundary-contract.md` | `D-ERR-*` | 错误边界与归一化映射 |
| `telemetry-contract.md` | `D-TEL-*` | 结构化日志与消息格式 |
| `network-contract.md` | `D-NET-*` | 重试、退避、实时传输边界 |
| `security-contract.md` | `D-SEC-*` | CSP、凭据委托、OAuth、端点安全 |
| `streaming-consumption-contract.md` | `D-STRM-*` | 流式消费、取消与恢复语义；只消费 beat/action outputs，不拥有其 product semantics |
| `offline-degradation-contract.md` | `D-OFFLINE-*` | Runtime/Realm 离线降级、缓存与重连冲突策略 |
| `codegen-contract.md` | `D-CODEGEN-*` | mod codegen 规则、预检、门禁与回滚 |
| `testing-gates-contract.md` | `D-GATE-*` | Desktop 测试治理、E2E 风险分层与发布门禁 |
| `command-execution-contract.md` | `D-GATE-*` | Desktop Tauri invoke command execution classes, cross-crate registered surface SSOT, blocking admission, and fail-closed gate |

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
- `tables/realm-agent-friend-actions.yaml`
- `tables/realm-agent-creation-modes.yaml`
- `tables/realm-agent-creation-fields.yaml`
- `tables/rule-evidence.yaml`（fragment directive；实际内容委托给 `tables/rule-evidence.catalog.yaml` 与 `tables/rule-evidence.rules-*.yaml`）
- `tables/codegen-import-allowlist.yaml`
- `tables/codegen-capability-tiers.yaml`
- `tables/codegen-static-scan-deny-patterns.yaml`
- `tables/codegen-acceptance-gates.yaml`

## 6. Kernel Companion 约束

- `kernel/companion/*.md` 为解释层，不定义规则。
- 每个 companion 章节必须声明 `Anchors:` 指向 `D-*` Rule。

## 7. Derived Views

Desktop table views are rendered on demand with `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope desktop`. The views are stdout artifacts; `generated/` is not a product authority directory.
