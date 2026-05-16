# Runtime Avatar Package Projection Contract

> Owner Domain: `K-AGCORE-*`
> Topic: `2026-05-16-avatar-asset-distribution-admission`

## K-AGCORE-133 Avatar Package Projection Authority

Runtime owns the launch-time Avatar package projection used by Desktop and
Avatar consumers. The projection is derived from Asset Market `Package` records
with `package_kind: "avatar"` plus Runtime-authorized materialization evidence.

Runtime does not own package publication, package lifecycle, package review,
package library inventory, UGC submission identity, ranking, or Asset Market
API truth.

If the Asset Market package record, readiness state, backend compatibility
diagnostics, or materialization evidence is unavailable, Runtime must fail
closed and must not fabricate a launch projection.

## K-AGCORE-134 Resolve Launch Projection Method Shape

The admitted Runtime method id is:

- SDK public method name: `runtime.avatarPackage.resolveLaunchProjection`
- Runtime RPC owner: `RuntimeAgentService`
- Planned proto RPC: `ResolveAvatarPackageLaunchProjection`
- Full Runtime method id:
  `/nimi.runtime.v1.RuntimeAgentService/ResolveAvatarPackageLaunchProjection`
- Required protected scope: `runtime.agent.avatar_package.read`

The RPC request must use Runtime-owned agent identity and a launch instance
selector only:

- `AgentRequestContext context`
- `avatar_instance_id`

The request must not carry package descriptors, local filesystem paths,
package bytes, backend runtime roots, Desktop-local activation bindings,
review/moderation payloads, or Avatar-local endpoint configuration.

The response is a Runtime Avatar package launch projection. SDK may decode it
internally with `decodeAvatarPackageHandoff`, but Desktop, Web, and app
consumers must not receive public model-layout, provenance, bundle membership,
or package lifecycle authority through stable SDK exports.

## K-AGCORE-135 Launch Eligibility Gate

Runtime may emit a launch projection only when all of the following are true:

- the Asset Market package has `package_kind: "avatar"`
- the package status is published and readiness is positive
- `backend_kind` is `live2d` or `vrm`
- `backend_capability_profile_ref` is present
- compatibility diagnostics contain no blocking diagnostic
- materialization evidence is Runtime-authorized and projects an opaque
  `materialization_ref`

The projection must not use `sprite2d`, `canvas2d`, or `video` as launched
Avatar backend kinds.

## K-AGCORE-136 Agent Center Non-Authority

Agent Center resolver plumbing may materialize an already authorized package
handoff into local files. It must not choose the active Avatar package, define a
package manifest lifecycle, persist activation truth, own rollback/update
channels, or bypass the Runtime Avatar package projection.

Desktop and Avatar consumers must treat Agent Center local records as
materialization evidence only.

## K-AGCORE-137 Runtime Emit Implementation Gate

`ResolveAvatarPackageLaunchProjection` is admitted as a typed
`RuntimeAgentService` RPC and SDK client method. Runtime must source the
projection through an injected Avatar package projection resolver that derives
from Asset Market package truth and Runtime-authorized materialization
evidence.

Runtime must fail closed when the resolver is unavailable, when the Asset
Market package projection is unavailable, or when resolver output violates
`K-AGCORE-135`.

The implementation closure must keep all of the following in one validated
wave:

- typed proto request/response messages, not a free-form `Struct`
- Go and TypeScript protobuf artifacts regenerated from proto
- SDK unary codec and runtime bridge method parity
- Runtime authz posture for `runtime.agent.avatar_package.read`
- Runtime handler output validation before returning the projection
