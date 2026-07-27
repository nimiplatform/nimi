# Cross-Domain Product Stories

These stories show how owner boundaries compose in user-facing flows.

## Create a Character and use a LocalAgent

1. The user creates or selects a Character in a Realm-owned product surface.
2. Realm produces the Character Source.
3. Runtime materializes an owner-scoped LocalAgent from that source.
4. Nimi Home or an App receives only the authorized LocalAgent projection
   through the SDK.
5. Runtime keeps Conversation, operational Memory and Knowledge, route,
   readiness, and credentials private to its owner boundary.

The host does not create Character identity, and Realm does not execute the
LocalAgent.

## Continue a Conversation on another surface

1. Runtime opens a Conversation and returns an explicit anchor.
2. Desktop renders committed turns and keeps ephemeral UI state.
3. Avatar attaches a visible instance to the same authorized anchor.
4. Runtime remains the continuity owner; neither surface copies local history
   as recovery truth.

Renderer motion and playback remain Avatar-local. Conversation, voice, state,
and presentation timing remain Runtime projections.

## Use a scaffolded App

1. Nimi Home launches the App through the current protected local path.
2. The App supplies typed intent and an explicit LocalAgent target through the
   standard SDK.
3. Runtime derives account, App identity, authorization, and access from the
   active session.
4. The App receives a bounded typed result and no Realm JWT, provider
   credential, Runtime proof, or account-wide LocalAgent inventory.

Direct SDK and scaffolded App usage share this product contract. Host
integration is not a user-selectable product profile.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
