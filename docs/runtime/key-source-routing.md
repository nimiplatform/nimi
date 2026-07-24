# Key Source Routing

> Status: Running today. Key source routing
> (`K-KEYSRC-001..K-KEYSRC-004`) is the shipped credential routing
> surface for AI consume requests.

When an AI request reaches the runtime, the credential the runtime
will use to talk to the provider must come from one of two admitted
paths: a **managed connector** (recommended) or **inline metadata**
(escape hatch). Mixing the two is rejected; missing both falls
through to runtime config defaults.

## Two Admitted Paths

| Path | Credential custody | Recommended? |
| --- | --- | --- |
| `connector_id` | `RuntimeConnectorService` (`K-CONN-001`: custodian, not distributor) | Recommended |
| `inline` (`x-nimi-key-source=inline` + inline metadata) | Caller (gRPC metadata direct pass-through) | Escape hatch |

The managed-connector path is the production path. Inline is for
narrow scenarios listed below.

## Managed Connector Auth Shapes

Managed remote connectors admit two auth shapes:

| Auth shape | Payload |
| --- | --- |
| `API_KEY` | Connector custody holds the API key |
| `OAUTH_MANAGED` | Connector custody holds a provider-defined sealed secret + `provider_auth_profile` from `tables/connector-auth-profiles.yaml` |

Both shapes keep the credential under connector custody. The caller
submits only `connector_id` — never the raw key.

`OAUTH_MANAGED` connectors must remain **user-owned**. If the
runtime finds a machine- or system-owned `OAUTH_MANAGED` record, the
managed path fails closed with `NOT_FOUND`.

Local connectors are not AI consume execution entries in Phase 1;
they serve as local-category catalog / probe facades only
(`K-LOCAL-004`).

## Inline Path Positioning (Escape Hatch)

Inline is admitted for narrow scenarios:

- **Development / debug:** developer testing with their own API key
  without pre-configuring a connector
- **External agent direct connect:** third-party agent connects via
  SDK directly to the runtime, bypassing Desktop connector
  management UI
- **One-off / temporary calls:** scenarios where credential
  persistence isn't desired

Desktop (`D-SEC-009`) always uses the managed connector path; the
renderer never touches raw API keys. Inline credential security is
the caller's responsibility — the runtime applies audit redaction
(`K-AUDIT-005`, `K-AUDIT-017`) but does not provide additional
secret protection on inline credentials.

## Mutual Exclusion

`connector_id` + any inline credential field together is **rejected**:

| Combination | Outcome |
| --- | --- |
| `connector_id` only | Managed path |
| Inline metadata only | Inline path |
| Both | `AI_REQUEST_CREDENTIAL_CONFLICT` |
| Neither | Runtime config / anonymous local default route |

There is no "use connector but override key inline" mode.

## Phase 1 Metadata Keys

| Key | Use |
| --- | --- |
| `x-nimi-key-source` | `inline` or `managed` |
| `x-nimi-provider-type` | Provider name (canonical from catalog) |
| `x-nimi-provider-endpoint` | Endpoint URL |
| `x-nimi-provider-api-key` | Inline API key (inline path) |
| `x-nimi-app-id` | Required for management RPC audit |

## Evaluation Order

AI consume requests are evaluated in fixed order:

1. Parse body + metadata (empty `connector_id` normalizes to "not
   provided")
2. JWT validation (if present)
3. `app_id` non-empty check
4. Key-source + mutual-exclusion check
5. Connector load
6. Owner / status / credential check
7. Remote endpoint security check
8. Inline endpoint security check

Step 6 decrypts the credential and injects it into the request-scoped
execution context (e.g., `nimillm.RemoteTarget`). Downstream execution
modules (e.g., nimiLLM) read credentials from the execution context;
they do **not** access the credential store directly.

## Reader Scenario: A Production Call Through A Managed Connector

1. **App acquires `connector_id`** via Desktop's connector management
   UI (which talks to `RuntimeConnectorService`).
2. **App calls AI consume** with `connector_id` only — no
   `x-nimi-provider-api-key`.
3. **Runtime evaluates.** Step 4 sees managed path; step 5 loads the
   connector; step 6 decrypts credential into execution context.
4. **Provider call.** nimiLLM reads credential from execution
   context, calls the provider, returns response.

The renderer / app never saw the raw key. Connector custody is the
single owner.

## Reader Scenario: An External Agent Uses Inline

A third-party agent connects to runtime via SDK and wants to use
its own provider API key.

1. **SDK call.** Includes `x-nimi-key-source: inline`,
   `x-nimi-provider-type: ...`, `x-nimi-provider-endpoint: ...`,
   `x-nimi-provider-api-key: ...`.
2. **Runtime evaluates.** Step 4 sees inline path. Step 8 validates
   inline endpoint security.
3. **Provider call.** Inline credential injected into execution
   context for this request only; not persisted.
4. **Audit.** Audit log redacts the credential per
   `K-AUDIT-005` / `K-AUDIT-017`.

The third-party agent's credential security is its own
responsibility. The runtime ensures the credential does not leak
through audit but does not provide further secret protection.

## Reader Scenario: A Conflict

A caller submits both `connector_id` and `x-nimi-provider-api-key`.

1. **Runtime evaluates.** Step 4 detects mutual exclusion.
2. **Reject.** `AI_REQUEST_CREDENTIAL_CONFLICT`.
3. **No silent precedence.** The caller must pick one path.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Path selection rules + mutex | `K-KEYSRC-001..K-KEYSRC-002` |
| Metadata key shapes | `K-KEYSRC-003` |
| Evaluation order | `K-KEYSRC-004` |
| Connector custody | `RuntimeConnectorService` (`K-CONN-001`) |
| Inline credential security | Caller |

## Source Basis

- [`.nimi/spec/canonical/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/canonical/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/kernel/auth-service.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/auth-service.md)
