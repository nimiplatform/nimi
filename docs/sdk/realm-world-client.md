# Realm Access from an App

User accounts, character personas (Character), virtual worlds (World), social graphs, virtual economies, historical facts, and shared assets are authoritatively managed by Realm. A Nimi App interacts with these assets through the standard `client.realm` methods on its host-bound client. Runtime acts as a secure mediation proxy, handling authorized Realm interactions without leaking sensitive Realm authentication tokens or exposing raw REST/WebSocket transport channels directly to the application layer.

## Strongly-Typed Domain Operations

Applications may invoke only those operations explicitly declared in their App manifest and granted by authorization policies. Both user account and application identities are derived automatically from the protected host session. Persona character mutations, World query interfaces, and Realm realtime channels maintain strict, strongly-typed inputs, permissions, and response contracts; unbounded generic proxies are disallowed.

The standalone `@nimiplatform/sdk/realm` facade serves external scripts that independently manage Realm authentication sessions. Standard Nimi Apps must not use it to escape the security boundaries of their host session. The retired `@nimiplatform/sdk/world` subpath remains permanently removed.

## Composing an Application Flow

1. **Read authoritative state**: Query necessary world information or character profiles via standard App Realm methods.
2. **Coordinate AI and Agents**: Execute application AI workflows via `client.ai`, and route autonomous agent tasks through authorized Agent methods.
3. **Manage app-local state**: Keep local drafts, UI state machines, and view layouts within the application.
4. **Commit state mutations**: When the user requests a Realm mutation, call the appropriate owner method and render the verified server response.

Local client caches, optimistic UI updates, or transient success messages do not constitute authoritative Realm state. When session tokens expire or operations are rejected, calls fail explicitly with typed errors; applications must not attempt raw `/api/...` side-channel requests.

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
