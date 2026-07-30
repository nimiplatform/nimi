# nimi-shell-protected-local-node

Host-only Node-API projection of the shared Nimi protected carrier for Electron
main processes. The addon exposes the exact six Local App operations:

- `localAppSessionStatus`
- `localAppPermissionStatus`
- `localAppPermissionRequest`
- `localAppStorageReadJson`
- `localAppStorageWriteJson`
- `localAppStorageRemoveJson`

For Nimi Desktop it additionally exposes the generated first-party product
families:

- `desktopMachineProductUnary` and `desktopMachineProductStreamOpen`;
- `desktopAccountProductUnary` and `desktopAccountProductStreamOpen`; and
- shared opaque `desktopFirstPartyProductStreamNext` / `Close` lifecycle calls.

Each method is converted to the generated profile-and-kind-specific native enum
before the verified channel opens. Machine and account profile markers are fixed
by the named native entrypoint; renderer input cannot select them. Unrelated,
wrong-profile, and wrong-kind Runtime methods fail closed.

Every call returns either `{ status: "ok", value }` or
`{ status: "error", reasonCode, retryable, reasonMetadata? }`. Error metadata is
a bounded allowlisted diagnostic projection; unclassified bare gRPC failures carry
the numeric `grpc_status_code` without exposing the status message. The addon has no arbitrary Runtime
proxy and never returns an endpoint, token, principal, record, permission decision, launch,
process, session proof, account identifier, or Runtime boot epoch.
