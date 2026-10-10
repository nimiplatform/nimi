# Delegated Capability

Delegated or external action is an optional Runtime capability. It is not a
prerequisite for Local AI, LocalAgent Conversation, Memory, voice,
SDK use, Nimi Home, Avatar, or ordinary App capability execution.

## Boundary

When a delegated capability is separately admitted, Runtime owns its gateway,
authorization, output validation, approval decision, and audit projection. An
external provider may propose typed input, but it cannot directly mutate Realm
truth, create LocalAgent truth, or bypass the active session.

Provider-native payloads, tool schemas, credentials, and external execution
state stay behind the Runtime boundary. Consumers receive only a typed,
authorized result.

## Failure behavior

An unavailable external capability reports its own typed unavailable or failed
state. Runtime must not convert that state into LocalAgent failure or a global
readiness blocker.

MCP can be an adapter to the separately owned [Integration](/runtime/integrations) contract. Ordinary App Integration calls do not require a delegated Agent session, suggestion firewall, quarantine, or approval replay. Actual adapter and operation availability must be checked separately. A2A remains a future seam. Consumers do not instantiate private protocol clients to bypass Runtime.

## Source Basis

- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
