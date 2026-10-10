# Connectors and Cloud Providers

Runtime owns cloud Connector resources, credentials, provider catalogs, and execution Drivers. Configure a connection in Nimi Home's Cloud Services, then select its safe reference and an admitted target in the relevant AIConfig.

## Configuration and Execution

| Layer | Carries |
| --- | --- |
| Runtime Connector | Current-account connection, credential custody, endpoint policy, and lifecycle |
| AIConfig Cloud route | Exact `connectorRef`, `implementation`, and `providerModelTarget` |
| App AI request | Content and supported operation parameters; no routing override or credential |

Use the host-bound App client's AIConfig options and settings UI. A safe Connector reference is not a secret or authorization grant. Runtime still checks ownership, App access, credential validity, and policy. The CLI and standalone clients do not provide a parallel Connector custody path.

At Job submission, Runtime validates and captures the committed Cloud inputs. It does not search for another provider or silently choose another model when the configured target fails. Later configuration changes apply to future submissions; current authorization and original-Connector admission still govern subsequent outbound actions for existing Jobs.

## Providers and Drivers

The Runtime provider catalog describes admitted families, and a CapabilityImplementationDriver translates the canonical operation into that provider's protocol. Support depends on the exact implementation, target, features, and execution mode, not merely a provider name.

Apps consume typed results and failures. Provider credentials, endpoints, native handles, and private protocol state stay out of App results and storage. Safe configuration options and execution evidence do not permit request-time overrides.

## Resolve a Cloud Failure

1. Inspect the capability's committed AIConfig and Runtime-issued effective selection.
2. In Cloud Services, inspect the referenced connection and correct its credentials or availability through the protected flow.
3. If changing the target, save the whole AIConfig against the current revision.
4. Submit new work only as an explicit App action. For an existing asynchronous Job, observe its original identity instead of resubmitting it.

See [Credential Custody](/runtime/key-source-routing) and [Local Models](/runtime/local-models).

## Source Basis

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
