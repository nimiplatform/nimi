# Error Codes

Nimi SDK and runtime return structured errors with stable `reasonCode` values.

```ts
type NimiError = Error & {
  code: string;
  reasonCode: string;
  actionHint: string;
  traceId: string;
  retryable: boolean;
  source: 'realm' | 'runtime' | 'sdk';
  details?: Record<string, unknown>;
};
```

## Runtime Reason Codes

Source of truth: `proto/runtime/v1/common.proto`.

Retryability below follows `@nimiplatform/sdk/types` `isRetryableReasonCode()`.

| Code | Description | Retryable |
|------|-------------|-----------|
| `PROTOCOL_ENVELOPE_INVALID` | Required protocol metadata or request envelope invalid | No |
| `PROTOCOL_DOMAIN_FIELD_CONFLICT` | Metadata domain/app_id conflicts with request body | No |
| `CAPABILITY_CATALOG_MISMATCH` | Requested capability/scope not recognized by catalog | No |
| `APP_NOT_REGISTERED` | App is not registered in runtime | No |
| `EXTERNAL_PRINCIPAL_NOT_REGISTERED` | External principal is not registered | No |
| `SESSION_EXPIRED` | Session expired | Yes |
| `PRINCIPAL_UNAUTHORIZED` | Principal authentication/authorization failed | No |
| `APP_AUTHORIZATION_DENIED` | App authorization rejected | No |
| `APP_GRANT_INVALID` | Grant/token chain invalid | No |
| `APP_TOKEN_EXPIRED` | App token expired | No |
| `APP_TOKEN_REVOKED` | App token revoked | No |
| `APP_SCOPE_FORBIDDEN` | Scope forbidden by app manifest/policy | No |
| `APP_SCOPE_CATALOG_UNPUBLISHED` | Scope catalog version not published | No |
| `APP_SCOPE_REVOKED` | Scope revoked in catalog | No |
| `APP_DELEGATION_FORBIDDEN` | Delegation not allowed by policy | No |
| `APP_DELEGATION_DEPTH_EXCEEDED` | Delegation depth exceeded | No |
| `APP_RESOURCE_SELECTOR_INVALID` | Resource selector format invalid | No |
| `APP_RESOURCE_OUT_OF_SCOPE` | Resource selection out of granted scope | No |
| `AUTH_CONTEXT_MISSING` | Runtime call missing auth context subject user id | No |
| `APP_CONSENT_MISSING` | Consent reference missing | No |
| `APP_CONSENT_INVALID` | Consent reference invalid | No |
| `EXTERNAL_PRINCIPAL_PROOF_MISSING` | Proof missing for external principal session | No |
| `EXTERNAL_PRINCIPAL_PROOF_INVALID` | Proof invalid for external principal session | No |
| `APP_MODE_DOMAIN_FORBIDDEN` | Domain forbidden by app mode | No |
| `APP_MODE_SCOPE_FORBIDDEN` | Scope forbidden by app mode | No |
| `APP_MODE_WORLD_RELATION_FORBIDDEN` | World relation forbidden by app mode | No |
| `APP_MODE_MANIFEST_INVALID` | App mode manifest invalid | No |
| `AI_MODEL_NOT_FOUND` | Model not found | No |
| `AI_MODEL_NOT_READY` | Model not ready | No |
| `AI_PROVIDER_UNAVAILABLE` | AI provider unavailable | Yes |
| `AI_PROVIDER_TIMEOUT` | AI provider timeout | Yes |
| `AI_ROUTE_UNSUPPORTED` | Route not supported for request/model | No |
| `AI_ROUTE_FALLBACK_DENIED` | Fallback route required but denied by policy | No |
| `AI_INPUT_INVALID` | AI input invalid | No |
| `AI_OUTPUT_INVALID` | AI output invalid | No |
| `AI_STREAM_BROKEN` | Stream interrupted/broken | Yes |
| `AI_CONTENT_FILTER_BLOCKED` | Content blocked by policy/filter | No |

## Runtime Config Reason Codes

These are emitted by `nimi config *` commands and desktop runtime-config bridge paths.

| Code | Description | Retryable |
|------|-------------|-----------|
| `CONFIG_PARSE_FAILED` | Runtime config JSON parsing failed or mutation payload invalid | No |
| `CONFIG_SCHEMA_INVALID` | Runtime config schema or field validation failed | No |
| `CONFIG_MIGRATION_FAILED` | Legacy config migration to new path failed | No |
| `CONFIG_WRITE_LOCKED` | Config write lock already held by another writer | Yes |
| `CONFIG_SECRET_POLICY_VIOLATION` | Plaintext `apiKey` detected; must use `apiKeyEnv` / `secretRef` | No |
| `CONFIG_RESTART_REQUIRED` | Config write succeeded; runtime restart required to apply | No |

Desktop bridge-specific wrappers:

| Code | Description |
|------|-------------|
| `RUNTIME_BRIDGE_CONFIG_PARSE_FAILED` | Desktop bridge failed to parse `nimi config --json` output |
| `RUNTIME_BRIDGE_CONFIG_CLI_START_FAILED` | Desktop bridge failed to spawn `nimi config` process |
| `RUNTIME_BRIDGE_CONFIG_CLI_FAILED` | `nimi config` process exited non-zero from desktop bridge |
| `RUNTIME_BRIDGE_MODE_INVALID` | Desktop bridge mode is invalid; expected `RUNTIME` or `RELEASE` |
| `RUNTIME_BRIDGE_RUNTIME_GO_NOT_FOUND` | Desktop bridge runtime mode requires `go` in `PATH` |
| `RUNTIME_BRIDGE_RUNTIME_ROOT_NOT_FOUND` | Desktop bridge runtime mode cannot locate workspace `runtime/` directory |
| `RUNTIME_BRIDGE_RUNTIME_BINARY_NOT_FOUND` | Desktop bridge release mode requires `nimi` binary (or `NIMI_RUNTIME_BINARY`) |

## SDK-Level Reason Codes

These are emitted before runtime execution or by SDK transport layers.

### Client creation / config

| Code | Description |
|------|-------------|
| `SDK_APP_ID_REQUIRED` | Runtime client missing required `appId` |
| `SDK_TARGET_REQUIRED` | Reserved legacy code (removed single-entry client initializer) |
| `SDK_REALM_BASE_URL_REQUIRED` | Realm client missing required `baseUrl` |
| `CONFIG_INVALID` | Realm request/config invalid (default mapping for HTTP 400/422) |
| `PROTOCOL_VERSION_MISMATCH` | Reserved legacy code (removed initializer protocol guard) |
| `SDK_RUNTIME_APP_ID_REQUIRED` | `createRuntimeClient` missing `appId` |
| `SDK_RUNTIME_AI_ROUTE_POLICY_REQUIRED` | AI request missing explicit `routePolicy` |

### App-auth request validation (runtime client)

| Code | Description |
|------|-------------|
| `SDK_RUNTIME_APP_AUTH_DOMAIN_REQUIRED` | Missing `domain` |
| `SDK_RUNTIME_APP_AUTH_APP_ID_REQUIRED` | Missing `appId` |
| `SDK_RUNTIME_APP_AUTH_EXTERNAL_PRINCIPAL_ID_REQUIRED` | Missing `externalPrincipalId` |
| `SDK_RUNTIME_APP_AUTH_EXTERNAL_PRINCIPAL_TYPE_REQUIRED` | Missing `externalPrincipalType` |
| `SDK_RUNTIME_APP_AUTH_SUBJECT_USER_ID_REQUIRED` | Missing `subjectUserId` |
| `SDK_RUNTIME_APP_AUTH_CONSENT_ID_REQUIRED` | Missing `consentId` |
| `SDK_RUNTIME_APP_AUTH_CONSENT_VERSION_REQUIRED` | Missing `consentVersion` |
| `SDK_RUNTIME_APP_AUTH_DECISION_AT_REQUIRED` | Missing `decisionAt` timestamp |
| `SDK_RUNTIME_APP_AUTH_POLICY_VERSION_REQUIRED` | Missing `policyVersion` |
| `SDK_RUNTIME_APP_AUTH_POLICY_MODE_REQUIRED` | Missing `policyMode` |
| `SDK_RUNTIME_APP_AUTH_PRESET_REQUIRED` | Preset mode missing `preset` |
| `SDK_RUNTIME_APP_AUTH_CUSTOM_SCOPES_REQUIRED` | Custom mode missing scopes |
| `SDK_RUNTIME_APP_AUTH_CUSTOM_TTL_REQUIRED` | Custom mode requires `ttlSeconds > 0` |
| `SDK_RUNTIME_APP_AUTH_CUSTOM_DELEGATE_REQUIRED` | Custom mode requires explicit `canDelegate` boolean |
| `SDK_RUNTIME_APP_AUTH_SCOPE_CATALOG_VERSION_REQUIRED` | Missing `scopeCatalogVersion` |

### Transport / codec

| Code | Description |
|------|-------------|
| `SDK_RUNTIME_REQUEST_ENCODE_FAILED` | Request protobuf encoding failed |
| `SDK_RUNTIME_RESPONSE_DECODE_FAILED` | Unary response decoding failed |
| `SDK_RUNTIME_STREAM_DECODE_FAILED` | Stream event decoding failed |
| `SDK_RUNTIME_CODEC_MISSING` | Method codec map missing entry |
| `SDK_RUNTIME_NODE_GRPC_*` | Node gRPC transport failures |
| `SDK_RUNTIME_TAURI_*` | Tauri IPC transport failures |

## Constants and Retry Helper

```ts
import { ReasonCode, isRetryableReasonCode } from '@nimiplatform/sdk/types';

if (error.reasonCode === ReasonCode.AI_PROVIDER_TIMEOUT) {
  // provider timeout branch
}

if (isRetryableReasonCode(error.reasonCode)) {
  // retry with backoff
}
```

Current retryable set:

- `SESSION_EXPIRED`
- `AI_PROVIDER_UNAVAILABLE`
- `AI_PROVIDER_TIMEOUT`
- `AI_STREAM_BROKEN`

## Handling Example

```ts
import type { NimiError } from '@nimiplatform/sdk/types';
import { isRetryableReasonCode } from '@nimiplatform/sdk/types';
import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime({
  appId: 'my_app',
  transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
});

try {
  await runtime.ai.text.generate({
    model: 'local/qwen2.5',
    subjectUserId: 'local-user',
    input: 'hello',
    route: 'local-runtime',
    fallback: 'deny',
  });
} catch (error) {
  const nimiError = error as NimiError;

  console.error(nimiError.reasonCode, nimiError.actionHint, nimiError.traceId);
  if (isRetryableReasonCode(nimiError.reasonCode)) {
    // retry strategy
  }
}
```

## Streaming Failure Events

For `ai.text.stream`, failures are emitted as stream parts:

```ts
for await (const part of streamResult.stream) {
  if (part.type === 'error') {
    console.error(part.error.reasonCode, part.error.actionHint);
  }
}
```
