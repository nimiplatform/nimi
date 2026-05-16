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

## S-RUNTIME-231 Avatar Package Client Boundary

SDK may expose Avatar package client types only as a typed consumer projection
for Asset Market packages with `package_kind: "avatar"` and Runtime/Desktop
authorized avatar configuration flows.

SDK does not own package lifecycle, package inventory, activation truth,
publication, review, moderation, backend file resolution, or Avatar render
success.

## S-RUNTIME-232 Opaque Ref Projection

SDK Avatar package client types must preserve these values as opaque refs or
closed enum projections:

- `avatar_package_ref`
- `backend_capability_profile_ref`
- `package_kind`
- `backend_kind`
- readiness/status summaries
- compatibility diagnostic ids

The public `@nimiplatform/sdk/runtime` surface must expose only consumer-safe
handoff/readiness APIs for Avatar package launch. Full Runtime Avatar package
projection, model layout, Live2D/VRM file layout, provenance, bundle membership,
and Asset Market package identity types are implementation-side decoding inputs,
not public SDK runtime exports for Desktop, Web, or app consumers.

SDK must not dereference package descriptors, backend capability profiles,
asset bytes, filesystem paths, materialized bundle locations, or Agent Center
storage records.

## S-RUNTIME-233 Acquisition And Import Projection

SDK may expose request/result shapes for Avatar package acquisition and import
only when they align to Asset Market authority:

- `AM-LIB-005` for library acquisition/import semantics
- `AM-API-005` for package-kind-aware API posture
- `AM-PKG-014` through `AM-PKG-017` for active Avatar package shape

SDK must not introduce a direct app-local install endpoint, browser-reachable
Avatar driver protocol, local package registry, or fallback package activation
path.

## S-RUNTIME-234 Readiness And Compatibility Decoding

SDK readiness decoding must fail closed.

SDK may internally decode the full Runtime Avatar package projection to prove
launch eligibility. That decoder must not be exported from the public runtime
index. An Avatar package may be projected as launch-eligible only when the Asset
Market package projection reports:

- `package_kind: "avatar"`
- `backend_kind` is `live2d` or `vrm`
- required Avatar package fields are present
- readiness is positive
- compatibility diagnostics contain no blocking code

Missing readiness, missing backend capability profile, unsupported backend kind,
or blocking diagnostics must be represented as non-launchable status.

## S-RUNTIME-235 Avatar Handoff Projection

SDK may carry an authorized Avatar handoff record to Desktop or Avatar only as
typed refs and status summaries.

The handoff record must require an opaque `materialization_ref`; the earlier
Runtime projection may observe an unmaterialized package, but launch handoff must
fail closed until materialization is authorized.

The handoff record must not include:

- package descriptors
- package file paths
- package bytes
- backend runtime roots
- Agent Center materialization paths
- local activation bindings
- review/moderation payloads
- raw Asset Market API payloads

## S-RUNTIME-236 No Lifecycle Authority

SDK Avatar package client APIs must not become package publish, review,
takedown, moderation, ad, ranking, UGC, or rollback authority.

Those semantics remain with Asset Market contracts and their admitted future
domains. SDK remains a typed consumer/projection layer.

## S-RUNTIME-237 Resolve Launch Projection Method

SDK admits the consumer method name
`runtime.avatarPackage.resolveLaunchProjection` as the typed client projection
of Runtime `K-AGCORE-134`.

The method maps to RuntimeAgentService method id
`/nimi.runtime.v1.RuntimeAgentService/ResolveAvatarPackageLaunchProjection`
and requires protected scope `runtime.agent.avatar_package.read`.

SDK must keep the method under `Runtime.avatarPackage`, not under Desktop,
Avatar, Asset Market, Agent Center, or app-local REST surfaces.

## S-RUNTIME-238 Contract-Only Fail Closed Status

Until Runtime and Asset Market implement the real source for
`ResolveAvatarPackageLaunchProjection`, SDK must not report production support.

The SDK method may expose the method shape and route to the Runtime client when
the Runtime method exists. If the Runtime client method is missing, unavailable,
or returns a non-launch-eligible projection, SDK consumers must fail closed.

SDK must not fabricate a successful package handoff, read Agent Center local
config as package authority, call an app-local install endpoint, or return a
placeholder success.

## S-RUNTIME-239 Public Surface Narrowing

The public `@nimiplatform/sdk/runtime` index may expose only:

- `decodeAvatarPackageHandoff(input)`
- `RuntimeAvatarPackageHandoff`
- `RuntimeAvatarPackageBackendKind`

It must not export full Runtime Avatar package projection, model layout,
Live2D/VRM layout, provenance, bundle membership, readiness internals, or
package lifecycle types.
