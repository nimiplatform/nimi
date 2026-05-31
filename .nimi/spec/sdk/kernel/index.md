# SDK Kernel Contracts

> Scope: `@nimiplatform/sdk` 跨域契约（Runtime / Realm / Scope / AI Provider / Testing Gates）。

## 1. 目标

本目录是 SDK 规范唯一权威层。跨 SDK 规则必须在 kernel 定义一次，domain 文档只允许引用 Rule ID。

## 2. One Fact One Home

- 单一事实源：同一规则只允许在一个 kernel 文件定义。
- 下游投影：`.nimi/spec/sdk/*.md` 仅做导引，不复述规则正文。
- 冲突处理：若 domain 与 kernel 冲突，以 kernel 为准。

## 3. Rule ID 规范

- 格式：`S-<DOMAIN>-NNN`
- `DOMAIN` 固定枚举：`SURFACE` `TRANSPORT` `ERROR` `BOUNDARY` `RUNTIME` `WORLD` `REALM` `AIP` `SCOPE` `GATE` `PKG` `AICONF` `APP` `PERM`
- `NNN` 三位递增编号，不复用。

## 4. 文档所有权

| 文档 | Domain | 说明 |
|---|---|---|
| `surface-contract.md` | `S-SURFACE-*` | SDK 子路径、导出面、Runtime 方法投影分组、World Evolution Engine logical facade placement、selector-read stable placement、developer-experience layer、non-authoritative client orchestration、canonical commit boundary、integration adapter admission |
| `transport-contract.md` | `S-TRANSPORT-*` | Runtime/Realm 传输模型、流行为边界 |
| `error-projection.md` | `S-ERROR-*` | 错误投影、重试语义、合成码治理 |
| `boundary-contract.md` | `S-BOUNDARY-*` | 跨包导入边界、禁止路径、developer ergonomics vs truth ownership、client orchestration promotion rule |
| `runtime-contract.md` | `S-RUNTIME-*` | runtime 子路径连接语义、事件与重试基线、agent presentation projection boundary、以及 World Evolution Engine app-facing logical facade boundary 与 selector-read publication profile |
| `local-environment-projection-contract.md` | `S-RUNTIME-*` | SDK typed projection boundary for Runtime-owned local environment plans, dependency jobs, selected source records, and local compute activation gates |
| `runtime-route-contract.md` | `S-RUNTIME-*` | app-facing `runtime.route.*` typed surface 与 route metadata projection |
| `runtime-delegation-client-contract.md` | `S-RUNTIME-*` | SDK typed projection and command boundary for Runtime-owned delegated capability providers, requests, firewall verdicts, approvals, and replay |
| `runtime-agent-participation-client-contract.md` | `S-RUNTIME-*` | SDK typed client and method registry boundary for Runtime-owned agent participation profiles, candidates, verdicts, audit, and replay |
| `realm-group-agent-participation-client-contract.md` | `S-RUNTIME-*` | SDK typed consumer hardcut for Realm GROUP agent participation controls, context refs, candidates, status projection, and no prompt/provider/model/commit ownership |
| `companion-participation-client-contract.md` | `S-RUNTIME-*` | SDK typed companion participation projection/control boundary for Avatar companion/persona/debug surfaces; no raw prompt/provider/APML/debug/domain payload transport |
| `runtime-avatar-control-client-contract.md` | `S-RUNTIME-*` | SDK typed client boundary for Desktop Avatar configuration and Runtime-owned Avatar debug probe/replay methods; Avatar package client surface retired along with Asset Market |
| `connector-auth-acquisition-contract.md` | `S-RUNTIME-*` | SDK/host typed facade boundary for third-party managed OAuth acquisition; Runtime remains sealed connector credential custodian |
| `world-evolution-engine-projection-contract.md` | `S-RUNTIME-*` | World Evolution Engine 的 typed projection-only 边界 |
| `world-evolution-engine-consumer-contract.md` | `S-RUNTIME-*` | World Evolution Engine 的 app consumer-facing API landing、selector-read stable method matrix、shared typed building blocks 与 no-leak hardcut |
| `world-contract.md` | `S-WORLD-*` | `sdk/world` 的 public facade boundary、five-family coarse landing、world-input projection boundary、fixture package boundary、renderer orchestration boundary、world-session composition boundary |
| `realm-contract.md` | `S-REALM-*` | realm 子路径实例隔离、刷新策略、实时边界 |
| `ai-provider-contract.md` | `S-AIP-*` | ai-provider 子路径适配、投影约束、external AI framework adapter boundary |
| `scope-contract.md` | `S-SCOPE-*` | scope 子路径 catalog 与边界语义 |
| `testing-gates-contract.md` | `S-GATE-*` | SDK 门禁层次、发布同级策略 |
| `package-governance-contract.md` | `S-PKG-*` | SDK root package metadata (`S-PKG-001`), support docs (`S-PKG-002`), release gate alignment (`S-PKG-003`), and audit evidence admission (`S-PKG-004`) |
| `ai-config-surface-contract.md` | `S-AICONF-*` | SDK typed AI config / profile / snapshot surface, host-local persistence boundary, scheduling probe categories, and no-fallback rule |
| `nimi-app-client-contract.md` | `S-APP-*` | SDK typed Nimi App client surface: list/get/install/update/uninstall/launch/status/subscribe/healthRepair logical operations, ordinary-visible filtering, mandatory `AIScopeRef` on launch, typed projection state aligned with `P-NAPP-008`, immutable release descriptor digest verification before install, app storage projection, non-owner rule for installers / source-selectors / marketplace truth, no-fallback rule, subscription scope limited to lifecycle events, and generated-app Runtime platform client auth helper `createNimiAppRuntimePlatformClient` with `local-first-party` / `third-party-nimi-app` / `dev-standalone` modes |
| `nimi-permission-client-contract.md` | `S-PERM-*` | SDK typed permission client surface for Realm `R-PERM-*` grant lifecycle and Cognition `C-APMEM-*` access policy: list/get/request/revoke/subscribe/status logical operations, mandatory `AIScopeRef`, fail-closed typed denial states, no fallback knob, no private path, subscription limited to grant lifecycle events, closed `permission_scope_ref` shape |

## 5. 结构化事实源

- `tables/sdk-surfaces.yaml`
- `tables/runtime-method-groups.yaml`
- `tables/import-boundaries.yaml`
- `tables/sdk-error-codes.yaml`
- `tables/sdk-runtime-behavioral-checks.yaml`
- `tables/sdk-realm-realtime-gates.yaml`
- `tables/sdk-testing-gates.yaml`
- `tables/runtime-avatar-control-methods.yaml`
- `tables/connector-auth-acquisition-profiles.yaml`
- `tables/runtime-agent-participation-methods.yaml`
- `tables/rule-evidence.yaml`

## 6. Kernel Companion 约束

- `kernel/companion/*.md` 只承载解释层。
- 每个 companion 章节必须声明 `Anchors:` 并指向 `S-*` Rule。

## 7. 结构约束

- kernel 表 `source_rule` 仅允许 `S-*`。
- domain 文档只保留阅读路径与包路径导引，不定义本地规则体系，也不复述 kernel rule body。
- human-authored topic lifecycle reports 写入 `.nimi/topics/{proposal|ongoing|pending|closed}/<topic-id>/**`；legacy local-only execution evidence may still appear under `.local/report/**`；tracked spec 不依赖具体 local 文件。

## 8. Domain Activation Overview

SDK active domains are `runtime`, `realm`, and `ai-provider`. `world` and `scope` remain defined SDK domains whose API surface grows only through kernel contracts and structured tables.
