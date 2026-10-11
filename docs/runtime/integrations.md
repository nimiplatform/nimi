# External Integrations and Service Operations

Through the `client.integration` API in the SDK, Nimi applications can discover and execute authorized operations provided by external services (such as chat bots, developer tooling, or automated services) as well as peer Nimi Apps. Integration operations are deterministic service actions distinct from open-ended generative AI, providing efficient, structured execution.

## Connection Setup and Scoped Grants

Users manage third-party service connections and authorization permissions centrally in Nimi Home under "Integrations":

- **Account Linkage & Credential Storage**: Link external service accounts (such as Telegram Bots, Lark applications, or MCP servers). Secrets and access tokens are managed securely in protected local storage by Runtime; the UI only displays sanitized connection metadata.
- **Standing Permissions**: Standing permissions binding the app subject, target, and actions must be granted in Nimi Home under "Integrations". When an invocation lacks required permissions, Runtime returns `INTEGRATION_PERMISSION_REQUIRED`, and the application guides the user to grant permission in the management interface.
- **Supported Standards**: Supports Model Context Protocol (MCP) servers alongside messaging platform adapters. Operational capabilities depend on the declared JSON Schema of the integration.

## Standard Invocation Workflow

1. **Discovery**: The application calls `client.integration.listCatalog()` or `client.integration.listConnections()` to inspect available integration connectors, connection instances, and supported actions.
2. **Execution**: Dispatches `client.integration.invoke()` with the target identifier, action name, and validated arguments.
3. **Observation**: Tracks execution using `getCall`, handling terminal statuses (`completed`, `failed`, `canceled`, or `unconfirmed`).
4. **Integration**: Incorporates the structured result into the app's internal workflow.

## Error Handling and Idempotency

- **External Side Effects**: When dispatching actions with external side effects (such as outbound chat messages), check call status rather than issuing blind retries upon network timeout to avoid duplicated messages.
- **Graceful Failure**: If a remote integration service is unreachable or credentials have expired, Runtime returns actionable diagnostics guiding the user to re-link or verify network connectivity.

## Source Basis

- [`.nimi/spec/runtime/integration.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/integration.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`sdks/typescript/core/app/local-app-runtime-platform-integration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-integration.ts)
