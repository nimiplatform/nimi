# SDK Connector Auth Acquisition Contract

> Owner Domain: `S-RUNTIME-*`

## Scope

定义第三方 managed OAuth acquisition 的 SDK/host typed facade 边界。该契约只覆盖
provider browser/device-code acquisition orchestration；Runtime ConnectorService
继续只拥有 sealed credential custody、connector create/update/probe/consume、以及
provider-native execution header derivation。

## S-RUNTIME-120 Host Connector Auth Acquisition Facade

SDK 可以提供 `runtime.connectorAuth.acquireManagedCredential(...)` 或等价 host
typed facade，用于把 provider browser/device-code flow 收敛出 Desktop renderer。

固定边界：

- facade owner 是 SDK host typed surface，不是 Runtime daemon RPC。
- Runtime 不新增 `AcquireManagedCredential`、`BeginProviderOAuth`、
  `RefreshManagedCredential` 或等价 connector RPC；`K-RPC-003` 的 ConnectorService
  method freeze 继续有效。
- facade 必须通过 adapter 注入 host primitives：browser open、provider network /
  proxy fetch、authorization-code token exchange、sleep/time source、以及 Runtime
  connector create/update client。
- SDK 不得 import Desktop、Tauri、renderer bridge、或 provider UI component。
- host adapter 返回的 sealed credential payload 只能经 existing Runtime
  `CreateConnector` / `UpdateConnector` write path 写入；不得建立第二条 credential
  persistence path。

## S-RUNTIME-121 Acquisition Profile Truth

OAuth acquisition constants 的唯一 SDK-side source 是
`tables/connector-auth-acquisition-profiles.yaml`。

该表只允许承载 acquisition metadata：

- `profile_id`
- `issuer`
- `client_id`
- `device_authorization_url`
- `device_token_url`
- `redirect_uri`
- `default_poll_interval_seconds`
- `min_poll_interval_seconds`
- `default_expires_in_seconds`

该表不得承载 sealed credential payload schema、refresh-token semantics、
provider execution header derivation、connector status truth、model/catalog truth、
或 Runtime-owned credential validation truth。

## S-RUNTIME-122 Refresh / Rotation Deferral

W1 admitted managed OAuth acquisition 不拥有 refresh / rotation automation。

- Refresh token may appear inside provider-defined sealed `credential_json` only as
  opaque payload material written through existing Runtime connector create/update path.
- SDK host facade must not silently refresh, rotate, rewrite, or repair sealed
  credential payload after acquisition completes.
- Runtime consume/probe must continue to fail closed on unusable managed payloads as
  defined by `K-CONN-018`.
- Re-authentication is manual reacquire unless a future spec redesign explicitly admits
  refresh / rotation owner, storage semantics, audit events, and failure behavior.
