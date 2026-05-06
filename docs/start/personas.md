# Personas

Reading paths for the most common readers of the Nimi public docs.
Each persona has a primary route through the documentation; pages
also link laterally so readers can cross between paths.

## Newcomer Evaluator

You heard about Nimi and want to decide in 30 minutes whether this
project matters to you.

1. [Platform → Vision](/platform/vision) — what this project is for.
2. [Platform → Six Primitives](/platform/protocol) — the cross-world
   contract surface that makes the platform a platform.
3. [Platform → Architecture](/platform/architecture/) — the cross-layer
   map that says who owns what.
4. [Nimi Coding → Overview](/nimicoding/) — the second co-positioned
   product thesis: Nimi Coding as an AI development paradigm.
5. [Reference → Glossary](/reference/glossary) — keep this open as you
   read.

After this path you can describe Nimi to someone else.

## World Creator

You want to design a world — its rules, lore, agents, scenes — and
publish it.

1. [Platform → Vision](/platform/vision) — what a world is.
2. [Realm](/realm/) — semantic truth, world state, world history.
3. [Reference → World Fields](/reference/world-fields) — exactly what
   a world looks like at the field level.
4. [Reference → Six Primitives](/reference/six-primitives) — the
   cross-world contracts your world participates in.
5. [Realm → World Creator Economy](/realm/) — economic semantics for
   creators (when admitted; some sub-pages land in later waves).

## Mod Developer

You want to extend Desktop with bounded capabilities.

1. [Desktop](/desktop/) — what Desktop is and why mods are first-class
   surfaces, not plugins.
2. [Desktop → Mods](/desktop/mods) — the hook capability boundary.
3. [SDK → Boundaries](/sdk/boundaries) — what mods can't bypass.
4. [Reference → Authority Domains](/reference/authority-domains) — the
   ownership lines mods must respect.

## App Developer

You want to build an app on Nimi using the SDK.

1. [SDK → Overview](/sdk/) — the single developer surface.
2. [SDK → Boundaries](/sdk/boundaries) — what apps can and cannot reach.
3. [SDK → Runtime Client](/sdk/runtime-client) — the app path into
   Runtime.
4. [SDK → Realm And World Client](/sdk/realm-world-client) — composing
   world truth and runtime-backed generation.
5. [Reference → State Machines](/reference/state-machines) — the state
   machines your app will observe.

## AI Agent Integrator

You want to integrate an external AI host as a participant.

1. [Platform → Vision](/platform/vision) — agents as first-class
   participants.
2. [Platform → AI Agent Security Interface](/platform/) — the security
   model for external agents (sub-page lands in later waves).
3. [Runtime → Delegated Capability](/runtime/) — the gateway and
   output firewall (sub-page lands in later waves).
4. [Reference → Agent Fields](/reference/agent-fields) — what an agent
   looks like, including external agent fields.
5. [Reference → State Machines](/reference/state-machines) — delegated
   provider and delegated session state machines.

## Nimi Coding Adopter

You want to adopt Nimi Coding as your AI development methodology in a
project of your own.

1. [Nimi Coding → Overview](/nimicoding/) — the paradigm and the
   package.
2. [Nimi Coding → Whitepaper](/nimicoding/whitepaper) — the paradigm
   thesis.
3. [Nimi Coding → Topic Workflow](/nimicoding/topic-workflow) — the
   topic / wave / packet / preflight / audit / closeout lifecycle.
4. [Reference → Forbidden Claims](/reference/forbidden-claims) — the
   forbidden-shortcuts mindset applied to docs.
5. [Reference → State Machines](/reference/state-machines) — topic and
   wave state machines.

(The full Nimi Coding section expands in a later wave; current sub-pages
remain reachable from the section overview.)

## Auditor / Reviewer

You are reviewing Nimi against admitted authority. You need to trace
public claims back to source.

1. [Reference → Spec Map](/reference/spec-map) — the public-section
   to spec-area mapping.
2. [Reference → Authority Domains](/reference/authority-domains) — who
   owns what.
3. [Reference → Glossary](/reference/glossary) — vocabulary alignment.
4. [Nimi Coding → Topic Workflow](/nimicoding/topic-workflow) — how
   work artifacts (topic.yaml, packet, preflight result, audit,
   closeout) are structured.

## Source Basis

- [`.nimi/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/INDEX.md)
- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
