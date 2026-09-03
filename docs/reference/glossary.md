# Glossary

## Identity and execution

**Character.** A durable participant with a persistent identity, kept by
Realm. PersonaCharacter and WorldCharacter are forms of Character.

**Character Source.** The character description Realm issues; Runtime runs a
LocalAgent from it.

**World Source.** Realm's description of a world's context. It can inform a
LocalAgent, but on its own it cannot create one.

**LocalAgent.** A character brought to life locally by Runtime, scoped to the
user it runs for. It holds no Realm identity or world facts of its own.

**Conversation anchor.** The explicit name Runtime gives one LocalAgent
conversation. A LocalAgent can have more than one conversation.

**Operational Memory.** What a LocalAgent remembers while it runs: recall,
retention, isolation, and the authorized views Runtime provides of it.

**Operational Knowledge.** What a LocalAgent knows: how Runtime ingests it,
retrieves it, keeps it isolated, manages its lifecycle, and shares authorized
views of it.

## Product surfaces

**SDK.** The typed public boundary Apps use to talk to Runtime and Realm.

**Kit.** Shared UI and host composition, added when a product surface actually
needs it — not a catalog of prebuilt capabilities.

**Nimi Home.** The product's front door and the current Desktop host surface.
Hosting the experience does not make it the keeper of Realm or Runtime.

**Avatar.** The embodiment shell: it renders a character from the typed
presentation Runtime sends and manages its own renderer-local behavior.

**Simulator.** A development and qualification tool for selected App modules,
not a current product platform or product host.

## Access and failure

**Session-derived access.** Runtime works out the account, App identity,
authorization, target LocalAgent or scope, and operation from your active
sign-in session.

**Typed unavailable.** An explicit answer saying an optional or inapplicable
capability is not available — an honest "no", not a synthetic success.

**Projection.** A bounded view provided by whoever keeps the data. Seeing a
projection never transfers ownership to the viewer.

**Owner.** The part of the system responsible for a product fact and the rules
for changing it. Code location, package name, docs, cache, or host role never
creates ownership.

## Six protocol primitives

**State.** The current condition of something, controlled by the part of the
system that keeps it.

**Event.** A typed notice that something happened, published by its keeper.

**Intent.** A typed request for an outcome. Asking is not proof of
authorization.

**Action.** An operation the responsible part of the system has accepted and
performed.

**Audit.** A record of security- or product-relevant activity, kept by the
responsible part of the system.

**Permission.** A decision by the responsible part of the system authorizing a
scoped operation.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
