# SDK Runtime Avatar Control Client Contract

> Owner Domain: `S-RUNTIME-*`
> Topic: `2026-05-01-desktop-avatar-configuration-debug-workbench`

## S-RUNTIME-112 Avatar Control Client Boundary

SDK may expose Avatar configuration and debug workbench APIs only as typed
clients for Desktop, Runtime, and Avatar contracts admitted by this topic.

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

Until later implementation waves close, these names are contract targets only
and must not be reported as production support.

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

SDK must not provide helper APIs that let Desktop, Avatar, apps, Web, or mods
bypass Runtime-owned probe/replay/authorization semantics or Avatar-owned
backend resolver execution.
