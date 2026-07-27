# LocalAgent Access and App Authorization

An App does not receive a product profile that changes the LocalAgent model.
Direct SDK consumers and scaffolded Apps use the same typed Runtime capability
surface; their host integration differs, not the product ontology.

## Session-derived access

For each operation, Runtime derives the current account, App identity,
authorization, target LocalAgent or admitted scope, and requested operation from
the active session. The caller supplies typed intent and, where required, an
explicit LocalAgent ID.

A supplied ID is a target, not proof of ownership or access. Runtime rejects an
unauthorized or stale target without exposing internal session material.

## App boundary

An authorized App may:

- submit typed LocalAgent intent;
- read or subscribe to bounded Conversation, state, voice, presentation,
  Memory, and Knowledge projections;
- observe typed ready, blocked, unavailable, or failed status.

It may not receive or maintain Realm JWTs, provider credentials, Runtime
session proof, private authorization evidence, account-wide LocalAgent
inventory, raw provider events, or reconstructable internal context.

Nimi Home and Desktop host the current local App path, but they do not replace
Runtime as the authorization or LocalAgent owner.

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
