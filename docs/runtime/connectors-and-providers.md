# Connectors and Providers

Connectors and providers are Runtime-managed cloud configuration. They define
how Runtime can reach admitted cloud implementations; they are not App request
controls and do not appear in owner `AIConfig`.

For Runtime-managed local assets, see [Local Models](/runtime/local-models).

## Connectors

A connector is a machine-side identity and credential record for an admitted
cloud provider. Runtime owns its creation, validation, storage, revocation, and
use.

| Property | Owner |
| --- | --- |
| Credential custody | Runtime daemon configuration |
| Provider identity | Runtime catalog |
| Validation and lifecycle | Runtime |
| Capability compatibility | Runtime catalog and Driver |
| Request-time connector selection | Runtime only |

An App does not create a request-level connector, pass a connector id, inspect a
connector's model list, or reuse connector diagnostics as routing authority.
Desktop and CLI may expose connector administration to the machine owner, but
that surface changes Runtime configuration rather than an App contract.

## Providers and Drivers

A provider is an admitted cloud implementation family. A Runtime Driver
translates canonical capability operations into provider-specific calls and
normalizes results, streams, errors, and evidence.

| Source | Purpose |
| --- | --- |
| `provider-catalog.yaml` | Admitted Runtime provider families |
| `provider-capabilities.yaml` | Runtime capability compatibility |
| `provider-extension-registry.yaml` | Admitted Runtime/Driver extensions |

Provider and implementation catalogs are Runtime authority. Apps consume the
canonical capability surface and do not select a catalog row. Adding provider
support or changing a Driver therefore does not require an App to rewrite its
request.

## Credential Custody

Provider credentials stay in Runtime-owned configuration or an admitted host
custody mechanism. Ordinary capability requests contain no provider credential,
credential selector, connector id, provider id, or endpoint. Runtime resolves
all required credential material after admitting the caller and capability.

Credentials and native provider handles must not leak into normalized SDK
results, logs, or App-owned storage. Missing or invalid credentials produce a
typed failure; the client does not synthesize a fallback.

## Health and Diagnostics

Runtime may monitor provider and connector state for machine administration and
internal implementation selection. `nimi doctor` can identify the affected
Runtime area without granting Apps provider-health or route-readiness controls.

For an App, the supported signals are:

- Runtime-wide reachability;
- the typed result or failure of the requested capability; and
- Runtime-issued execution diagnostics, when the operation contract includes
  them.

Those diagnostics explain what Runtime did. They do not authorize an App to pin
or switch a provider, connector, model, route, or endpoint on the next request.

## Reader Scenario: Configure Cloud Capability

1. **Configure Runtime.** A machine administrator adds admitted provider
   credentials through Desktop or CLI.
2. **Validate.** Runtime validates and stores the configuration under its own
   custody.
3. **Express owner intent.** An App or Agent owner records Cloud intent for an
   admitted capability in `AIConfig`; no provider or connector is named.
4. **Invoke.** The App sends caller identity, scenario content, and supported
   operation parameters.
5. **Execute.** Runtime selects an admitted implementation and credential record,
   then returns a typed result or failure.

## Reader Scenario: Provider Degradation

1. Runtime detects an upstream problem while servicing a request.
2. Runtime follows its admitted execution policy and either completes the
   operation or emits a typed terminal failure.
3. Runtime records provider and connector details as internal diagnostic or
   audit evidence.
4. The App displays the operation outcome without presenting a provider switcher
   or fabricating success.
5. A machine administrator can inspect and repair Runtime configuration through
   the administration surface.

## Public Boundary

- Connectors, provider catalogs, credentials, endpoints, and Drivers belong to
  Runtime configuration.
- `AIConfig` Cloud intent does not select any of them.
- App requests contain no provider, connector, model, route, target, endpoint,
  credential, or fallback policy.
- Provider health and route readiness are not App selection surfaces.
- Runtime owns implementation choice and emits typed failures when no admitted
  implementation can execute.

## Source Basis

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`config/runtime-provider-catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-provider-catalog.yaml)
- [`config/runtime-provider-capabilities.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-provider-capabilities.yaml)
- [`config/runtime-provider-extension-registry.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-provider-extension-registry.yaml)
