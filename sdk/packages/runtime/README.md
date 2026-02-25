# @nimiplatform/sdk-runtime

Runtime client package for `@nimiplatform/sdk/runtime`.

- Supports transport profiles:
  - `node-grpc`
  - `tauri-ipc`
- Exposes 8 runtime service clients:
  - `auth`, `appAuth`, `ai`, `workflow`, `model`, `knowledge`, `app`, `audit`

This package is transport-oriented and does not contain mod host/hook APIs.

## Payload Contract

- Runtime RPC payloads use raw protobuf bytes (`Uint8Array`).
- Caller passes encoded request bytes; transport returns response bytes.
- `tauri-ipc` bridge carries `requestBytesBase64` / `responseBytesBase64`.
