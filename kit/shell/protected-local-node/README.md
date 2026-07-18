# nimi-shell-protected-local-node

Host-only Node-API projection of the shared Nimi protected carrier for Electron
main processes. The addon exposes the exact six Local App operations:

- `localAppSessionStatus`
- `localAppPermissionStatus`
- `localAppPermissionRequest`
- `localAppStorageReadJson`
- `localAppStorageWriteJson`
- `localAppStorageRemoveJson`

For Nimi Desktop it additionally exposes two closed unary families:

- `desktopProductControlUnary`, whose selector must be one of the 21
  K-RPC-004 Desktop product-control operations; and
- `desktopRuntimeConsumerUnary`, whose selector must be one of the 10 exact
  K-PLOCAL-006 Desktop runtime-consumer methods.

Each selector is converted to its native enum before the verified channel
opens; unrelated Runtime methods and every stream fail closed.

Every call returns either `{ status: "ok", value }` or
`{ status: "error", reasonCode, retryable }`. The addon has no arbitrary Runtime
proxy and never returns an endpoint, token, principal, record, permission decision, launch,
process, session proof, account identifier, or Runtime boot epoch.
