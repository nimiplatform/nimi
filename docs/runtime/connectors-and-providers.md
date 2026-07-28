# Connectors And Providers

Runtime treats cloud AI providers as governed runtime data, not as
marketing copy. A provider name, model capability, health status, or
routing promise can affect user expectations and integration
behavior, so each is admitted under contract.

This page describes the managed cloud route. For local routing see
[Local Models](/runtime/local-models).

## Connectors

A **connector** is a managed identity for a cloud AI provider. It
holds credentials, validates them, and reports the models that
identity can route to.

| Property | Value |
| --- | --- |
| Owner scope | `user` / `machine-global` / `runtime-system` |
| Credentials | Held under the daemon-config plane |
| Validation | On admission; periodically thereafter |
| Model listing | Reported through the connector |
| Lifecycle | `created → active → degraded → revoked` |

A connector is not a provider. The provider is the abstract route;
the connector is the particular identity using that route. One
user can have multiple connectors for the same provider (e.g.,
personal vs work). Specific provider route ids are governed
catalog data — see [Compatibility Posture](/reference/compatibility-posture)
for why the public docs do not list them.

## Providers

A **provider** is a normalized cloud route. Capabilities and
endpoints come from a static provider catalog plus a capability
matrix. Runtime doesn't fetch a remote dynamic catalog — provider
behavior is anchored in admitted catalog data.

| Source | Purpose |
| --- | --- |
| `provider-catalog.yaml` | The set of admitted provider routes |
| `provider-capabilities.yaml` | The capability matrix per provider |
| `provider-extension-registry.yaml` | Admitted provider-specific extensions |

A reader who wants to know which providers are admitted today goes
to those tables, not to docs prose. The docs do not list provider
names because that list is governed catalog data.

## nimiLLM

`nimiLLM` is the unified remote execution path. Provider-specific
adapters produce normalized streaming results regardless of which
cloud is behind the call.

| Layer | Role |
| --- | --- |
| Provider adapter | Translates Runtime calls into provider-specific shapes |
| Normalization | Unifies streaming, error, and metadata shape |
| Audit | Records every call under typed reason codes |

The adapter layer is what makes "swap providers without rewriting
your app" a real claim. An app that uses `@nimiplatform/sdk/runtime` does not
care which provider is behind the call; the normalized shape is
what the app sees.

## Provider Health

Provider health is a separate authority from connector health. A
healthy connector with an unhealthy upstream is still an unhealthy
route.

| State | Meaning |
| --- | --- |
| `healthy` | Provider is responding and returning expected shapes |
| `degraded` | Provider is responding but with elevated errors |
| `unhealthy` | Provider is not responding or returning malformed shapes |

Provider state machine is admitted in
`runtime/kernel/provider-health-contract.md`. State changes are
observable through `nimi doctor` and via runtime health streams.

## Credential Plane Split

Connectors hold credentials in the **daemon-config** plane.
Per-request credentials (from trusted hosts at request time) come
through the **request-credential** plane. The two are strictly
isolated:

| Plane | Source | Lifetime |
| --- | --- | --- |
| `daemon-config` | Connector-managed | Persistent |
| `request-credential` | Trusted host injection | Per request |

A connector's credential never leaks into a request-credential
slot. A request credential is never persisted into the daemon-config
plane. This separation is structural, not policy — runtime refuses
the cross-plane move.

## Reader Scenario: Adding A Cloud Provider Route

You want to route some requests through a cloud provider you have
an account with.

1. **Add connector.** Through the runtime CLI or Desktop's runtime
   config, you create a connector for the admitted provider.
2. **Credentials.** The connector holds the credentials in the
   daemon-config plane.
3. **Validation.** The connector validates the credentials and
   reports the models that identity can route to.
4. **Capability matrix.** Runtime knows which capabilities (text /
   image / embedding / etc.) this connector offers, anchored in
   the admitted capability matrix.
5. **Use.** An app issues a request through `@nimiplatform/sdk/runtime`. Runtime
   routes the request through the connector. Streaming arrives
   normalized; errors arrive typed.

What did **not** happen: docs did not list the provider's name as
a marketing claim. The provider list is admitted catalog data.

## Reader Scenario: A Provider Goes Degraded Mid-Session

A connector's upstream provider starts returning elevated error
rates while a generation is streaming.

1. **Provider health detects** elevated error rates and moves
   the provider state to `degraded`.
2. **Streaming contract** decides whether the in-flight stream
   can recover or must terminate. Transient transport errors
   may be retried; contract failures fail closed with a typed
   terminal frame.
3. **Health stream emits.** The runtime health subscription
   surface notifies subscribers of the state change.
4. **Apps degrade.** Apps that subscribe to provider health
   surface the change. The user sees "provider X is degraded";
   the app does not silently fall back to another provider that
   the user did not configure.
5. **Audit lineage.** The degradation event, the workflow
   terminal frame, and any subsequent runtime decisions are
   recorded.

There is no silent provider fallback. Routing is governed; if a
provider goes unhealthy, the user (or app) chooses what to do
next.

## Source Basis

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`config/runtime-provider-catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-provider-catalog.yaml)
- [`config/runtime-provider-capabilities.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-provider-capabilities.yaml)
- [`config/runtime-provider-extension-registry.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-provider-extension-registry.yaml)
