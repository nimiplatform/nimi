# Glossary

## Identity and execution

**Character.** Realm-owned persistent identity and social/world truth.
PersonaCharacter and WorldCharacter are Character forms.

**Character Source.** Realm-issued identity source from which Runtime may
materialize a LocalAgent.

**World Source.** Realm-owned World context source. It may contribute context
but cannot establish LocalAgent identity by itself.

**LocalAgent.** Owner-scoped Runtime materialization for local AI execution. It
owns no Realm identity or World truth.

**Conversation anchor.** Explicit Runtime-owned identity for one LocalAgent
Conversation. A LocalAgent may have more than one Conversation.

**Operational Memory.** Runtime-owned LocalAgent recall, retention, isolation,
and authorized projection.

**Operational Knowledge.** Runtime-owned LocalAgent ingestion, retrieval,
isolation, lifecycle, and authorized projection.

## Product surfaces

**SDK.** Typed public access boundary for Runtime and Realm consumers.

**Kit.** Demand-driven shared UI and host composition. It is not a prebuilt
catalog of every possible product capability.

**Nimi Home.** Current product home and Desktop host surface. Hosting does not
make it the Realm or Runtime owner.

**Avatar.** Embodiment shell and rendering owner. Avatar consumes typed Runtime
presentation input and owns renderer-local behavior.

**Simulator.** Development qualification tool for selected App modules, not a
current product platform or product host.

## Access and failure

**Session-derived access.** Runtime derives account, App identity,
authorization, target LocalAgent or scope, and operation from the active
session.

**Typed unavailable.** Explicit result indicating that an optional or
inapplicable capability is not available. It is not synthetic success.

**Projection.** Bounded owner-provided view. A projection does not transfer
ownership to its consumer.

**Owner.** The domain responsible for a product truth and its mutation rules.
Code location, package name, docs, cache, or host role does not create
ownership.

## Six protocol primitives

**State.** Current owner-controlled product condition.

**Event.** Typed occurrence projected by its owner.

**Intent.** Typed requested outcome, not an authorization proof.

**Action.** Admitted operation performed by the owning domain.

**Audit.** Owner-controlled record of security or product-relevant activity.

**Permission.** Owner decision authorizing a scoped operation.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
