# nimi-shell-protected-local-node

Host-only Node-API projection of the shared Nimi protected carrier for Electron
main processes. The addon exposes the exact fourteen Local App operations:

- `localAppSessionStatus`
- `localAppPermissionPosture`
- `localAppPermissionRequest`
- `localAppArtifactsReadRuntimeBytes`
- `localAppStorageReadJson`
- `localAppStorageWriteJson`
- `localAppStorageRemoveJson`
- `localAppAgentInventory`
- `localAppAgentOpenConversation`
- `localAppAgentSendTurn`
- `localAppAgentSubscribeTurn`
- `localAppAgentGetConversationSnapshot`
- `localAppAgentTranscribeVoice`
- `localAppAgentSubscribeVoiceStream`

For Nimi Desktop it additionally exposes two closed unary families:

- `desktopProductControlUnary`, whose selector must be one of the 21
  K-RPC-004 Desktop product-control operations; and
- `desktopRuntimeConsumerUnary`, whose selector must be one of the 10 exact
  K-PLOCAL-006 Desktop runtime-consumer methods.

Each selector is converted to its native enum before the verified channel
opens; unrelated Runtime methods and every stream fail closed.

Every call returns either `{ status: "ok", value }` or
`{ status: "error", reasonCode, retryable }`. The addon has no arbitrary Runtime
proxy and never returns an endpoint, token, principal, record, grant, launch,
process, session proof, account identifier, or Runtime boot epoch.
