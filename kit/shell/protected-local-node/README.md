# nimi-shell-protected-local-node

Host-only Node-API projection of the shared Nimi protected carrier for Electron
main processes. The addon exposes the exact nine Local App operations:

- `localAppSessionStatus`
- `localAppPermissionPosture`
- `localAppPermissionRequest`
- `localAppArtifactsReadRuntimeBytes`
- `localAppAgentOpenConversation`
- `localAppAgentSendTurn`
- `localAppAgentSubscribeTurn`
- `localAppAgentGetConversationSnapshot`

For Nimi Desktop it additionally exposes `desktopProductControlUnary`, a
single closed family whose selector must be one of the 21 K-RPC-004 Desktop
product-control operations. The selector is converted to the native enum
before the verified channel opens; unrelated Runtime methods fail closed.

Every call returns either `{ status: "ok", value }` or
`{ status: "error", reasonCode, retryable }`. The addon has no arbitrary Runtime
proxy and never returns an endpoint, token, principal, record, grant, launch,
process, session proof, account identifier, or Runtime boot epoch.
