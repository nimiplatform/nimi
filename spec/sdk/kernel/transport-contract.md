# SDK Transport Contract

> Owner Domain: `S-TRANSPORT-*`

## S-TRANSPORT-001 Runtime Transport 显式声明

Runtime SDK transport 必须显式声明：

- `node-grpc`
- `tauri-ipc`

禁止隐式默认 transport。

## S-TRANSPORT-002 Metadata 投影边界

Runtime SDK 必须遵循 metadata/body 分离：

- `connectorId` 在 request body
- provider endpoint/api_key 在 transport metadata

## S-TRANSPORT-003 流式行为边界

- SDK 不得隐式重连续流。
- 中断后必须由调用方显式重建订阅。

## S-TRANSPORT-004 Realm 请求引擎边界

Realm SDK 必须通过实例级配置完成 endpoint/token/header 合并，不允许共享全局 OpenAPI 运行态配置。
