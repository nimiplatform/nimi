# Cloud Connectors and Model Providers

Runtime manages cloud Connectors, provider catalogs, and low-level protocol execution drivers. Users configure API connections and endpoints in Nimi Home under "Cloud Services", and then link capabilities to those connectors within application AIConfigs.

## Architecture and Layering

| Layer | Responsibility | Security & Scope |
| --- | --- | --- |
| **Runtime Connector** | Third-party API keys, custom endpoints, retry and timeout policies | Credentials stored securely in protected local storage; hidden from renderers |
| **AIConfig Cloud Route** | References to active connectors (`connectorRef`) and targets (`providerModelTarget`) | Persisted as application configuration using safe symbolic references |
| **Application Layer** | High-level prompts, parameters, and business logic | Fully decoupled from wire protocols, HTTP headers, and credential handling |

Centralizing sensitive credentials within Runtime prevents API key leaks and eliminates complex networking plumbing from client applications.

## Driver Adaptation and Deterministic Scheduling

- **Protocol Translation**: Runtime's `CapabilityImplementationDriver` translates uniform platform operations into provider-specific REST, WebSocket, or gRPC requests.
- **Deterministic Routing**: Once submitted, Runtime routes calls strictly to the designated target. If a remote provider experiences an outage or rate limit, Runtime returns the exact upstream failure rather than falling back to an unverified model that could cause hallucinations or unexpected billing.
- **Normalized Outputs**: Applications consume standardized response streams and structured errors; proprietary headers and vendor-specific envelopes are stripped cleanly.

## Troubleshooting Cloud Failures

If a cloud inference call fails, follow this diagnostic workflow:

1. **Verify Route Configuration**: Ensure the active AIConfig references a valid, enabled Connector.
2. **Test Connector Health**: Use the "Test Connection" button in Cloud Services to verify API key validity and network connectivity.
3. **Check Provider Quotas**: Verify that your provider account (e.g., OpenAI, Anthropic) has sufficient credit balance and has not hit rate limits.
4. **Update Targets**: If switching to an alternative model, update the capability target in the AI configuration panel and save.

## Related Documentation

- [Key Source Routing Specification](/runtime/key-source-routing)

## Source Basis

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
