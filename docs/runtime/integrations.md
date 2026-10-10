# Integrations

Use `client.integration` on the host-bound App client to discover and invoke admitted external-service or Nimi App operations. An integration operation is a service action, not an AI CapabilityContract. Ordinary App calls do not need a LocalAgent or Conversation.

## Connect and Authorize

Home's Integrations workspace manages connections, user choices, and invocation history. A connection identifies the selected external account and its execution and credential-custody location. Runtime owns standing permission for the exact Nimi account, consumer App subject, operations, and target.

Discovery, installing a source, an App Access declaration, or a Skill does not grant invocation permission. The consumer cannot approve itself. Credential setup uses the trusted management flow and write-only secrets; safe target/configuration projections do not return credentials.

Current typed connection forms include MCP, Telegram, Weixin, Feishu, official QQ, and OneBot v11. Actual availability depends on the implemented adapter, selected account/protocol, and exact operation combination. A descriptor alone does not establish executable support; file and media support must be checked for the selected platform and recipient.

## Invoke and Observe

1. Discover the target and its described operations through the protected client.
2. Have the user configure the connection and standing permission through the management flow.
3. Call `invoke` with the admitted target, operation, and schema-valid parameters.
4. Retain the returned call identity and observe it with `getCall` or `listCalls`; handle `accepted`, `completed`, `failed`, `canceled`, and `unconfirmed` distinctly.
5. Adopt the result into the App's own project workflow.

Cancellation requests a stop; it does not promise rollback of an external side effect. Native messaging writes do not silently retry. Provider acceptance is not recipient delivery or read confirmation, and an unconfirmed result is not a safe instruction to resend.

## App Providers and Skills

An App can expose admitted operation descriptors and actual handlers through the provider interface. Runtime derives provider identity and handler lifetime from its exact protected Host. A Skill explains how to use an operation but creates no handler or permission.

Runtime owns bounded invocation and authorization facts. The consumer App owns goals, plans, waiting, business completion, and recovery. Restoring a technical session does not resume or replay business tasks. The optional delegated suggestion/firewall path is separate and is not a prerequisite for ordinary Integration calls.

## Source Basis

- [`.nimi/spec/runtime/integration.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/integration.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`sdks/typescript/core/app/local-app-runtime-platform-integration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-integration.ts)
