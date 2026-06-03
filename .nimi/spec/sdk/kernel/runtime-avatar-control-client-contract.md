# SDK Runtime Avatar Control Client Contract

> Owner Domain: `S-RUNTIME-*`

## S-RUNTIME-112 Avatar Control Client Boundary

SDK may expose Avatar configuration and debug workbench APIs only as typed
clients for the referenced Desktop, Runtime, and Avatar authority contracts.

SDK does not own configuration semantics, probe semantics, backend execution,
or replay truth.

## S-RUNTIME-113 Configuration Projection

SDK configuration methods must align to
`.nimi/spec/desktop/kernel/agent-avatar-configuration-contract.md` and
`tables/agent-avatar-configuration.schema.yaml`.

SDK must preserve opaque refs as refs. It must not dereference Avatar package
descriptors or backend capability profiles.

## S-RUNTIME-114 Probe And Replay Projection

SDK probe methods must align to
`.nimi/spec/runtime/kernel/avatar-debug-projection-contract.md`.

SDK must expose typed request, result, and replay ref shapes. It must not expose
raw APML parser diagnostics, backend command strings, provider payloads,
MCP/A2A protocol objects, or raw Avatar backend payloads as stable public types.

## S-RUNTIME-115 Avatar Evidence Projection

SDK may carry Avatar evidence refs and schema-bound evidence summaries from
`.nimi/spec/avatar/kernel/avatar-debug-session-contract.md`.

SDK must not reinterpret Avatar backend evidence as Runtime success; Runtime
probe result status remains the public diagnostic status.

## S-RUNTIME-116 Method Registry

Admitted SDK method names are pinned by
`tables/runtime-avatar-control-methods.yaml`.

Until implementation and test gates exist, these names are contract targets
only and must not be reported as production support.

## S-RUNTIME-117 Type Escape Prohibition

Runtime Avatar control SDK types must use named interfaces, enums, tagged
unions, or schema refs.

Stable SDK contracts must not use:

- `any`
- `Record<string, unknown>`
- free-form maps for provider payloads
- protocol-native MCP/A2A objects
- raw backend command payloads

## S-RUNTIME-118 Consumer No-Bypass

SDK must not provide helper APIs that let Desktop, Avatar, apps, or Web
bypass Runtime-owned probe/replay/authorization semantics or Avatar-owned
backend resolver execution.

## Retired Avatar Package Client Surface

`RETIRED`：SDK Avatar package client surface 已随 Asset Market 撤回一并退役。
原 `runtime.avatarPackage.resolveLaunchProjection`、`decodeAvatarPackageHandoff`、
`RuntimeAvatarPackageHandoff`、`RuntimeAvatarPackageBackendKind` 等公共 SDK
surface 不再存在。本范围保留为退役占位，原 231-239 Avatar package
client rule block 不再承载 active normative 行为。

Avatar 启动只保留本地 Avatar 资产路径（私有 import + 本地 materialization），
不再有远程 package 来源；任何复活该 surface 的提案必须重新立项并写入新规则。

## S-RUNTIME-240 Avatar Live Instance Binding Client

SDK admits `runtime.agent.anchors.registerAvatarLiveInstance` and
`runtime.agent.anchors.resolveAvatarLiveInstance` as the only client methods
that map Desktop/Avatar live-instance recovery to Runtime `K-AGCORE-138`.

Fixed rules:

- registration requires protected `runtime.agent.write`
- resolution requires protected `runtime.agent.read`
- both methods must require local agent identity and explicit
  `avatarInstanceId`
- registration must also require explicit `conversationAnchorId`
- SDK must return Runtime's binding plus `ConversationAnchorSnapshot`; it must
  not infer anchor continuity from same-agent identity or app-local storage
