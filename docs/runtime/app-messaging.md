# App Coordination

Nimi Apps coordinate through purpose-specific protected operations. A formal App does not have a generic `SendAppMessage` / `SubscribeAppMessages` bus, arbitrary recipient routing, or a token-based shortcut to the internal Agent carrier.

## Choose the Operation for the Task

| Task | App surface |
| --- | --- |
| Call an operation exposed by another App or external service | `client.integration`, with a real provider and the user's standing permission |
| Converse with an authorized LocalAgent | `client.conversation`, using a current Agent handle |
| Run independent Agent work for an App project | `client.agentWork`, under its separately admitted declaration and access |
| Publish or inspect supported App activity records | `client.activity`, following its publisher, visibility, and record lifecycle rules |

These surfaces have different inputs, outputs, and lifetimes. An activity record is not an RPC reply, and a Conversation message is not a transport for arbitrary App business commands.

## Example: Ask Another App for Available Times

If a calendar App exposes an admitted Integration operation for availability, discover that operation and its schema through `client.integration`. Have the user grant the relevant target/operation permission, invoke the operation with schema-valid input, and observe the original call. The calendar App owns its calendar data and business handler; the calling App owns what to do with the result.

If the provider or permission is missing, show the actual unavailable or denied result. Do not synthesize a generic `free-time-query` message or open a private Runtime transport. See [Integrations](/runtime/integrations) for the complete boundary.

## Internal Agent Carrier

Runtime retains a private, fixed-subtype Agent ingress/projection carrier for its own execution. Its wire/service names can remain in implementation and generated types without becoming public App operations. The ordinary public transport rejects those message RPCs, and protected Local App calls are also rejected.

Use the canonical Conversation and Realtime operations for their respective tasks. Current session admission, a caller-supplied App ID, or knowledge of an internal message name does not widen the App's operation set.

## Source Basis

- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/integration.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/integration.authority.yaml)
- [`sdks/typescript/core/app/local-app-runtime-platform.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform.ts)
