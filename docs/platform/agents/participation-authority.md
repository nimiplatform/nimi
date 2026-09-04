# LocalAgent Access and App Authorization

Every App sees the same LocalAgent model. Whether an App talks to the SDK
directly or was built from a scaffold, it uses the same typed Runtime
capability surface — only the way it plugs into its host differs, never the
product model itself.

## Session-derived access

For each operation, Runtime works out from the active session who the account
is, which App is asking, what it is authorized to do, which LocalAgent or
scope is the target, and which operation is requested. The caller passes typed
intent and, where needed, an explicit LocalAgent ID.

An ID you supply is a target, not proof that you own or may access it. Runtime
rejects an unauthorized or stale target without leaking any internal session
material.

## App boundary

An authorized App may:

- submit typed LocalAgent intent;
- read or subscribe to bounded Conversation, state, voice, presentation,
  Memory, and Knowledge views;
- observe typed ready, blocked, unavailable, or failed status.

It never receives Realm credentials, provider keys, Runtime session proofs,
private authorization evidence, an account-wide LocalAgent list, raw provider
events, or material that could rebuild internal context.

Nimi Home and Desktop host the current local App path, but they do not replace
Runtime as the decider of authorization or the runner of LocalAgents.

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
