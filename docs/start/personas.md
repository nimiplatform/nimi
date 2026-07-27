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
5. [Realm → Creator Economy](/realm/creator-economy) — economic
   semantics for creators across worlds.

## App Developer

You want to build an app on Nimi using the SDK.

1. [Start → Create A Nimi App](/start/create-an-app) — scaffold a developer
   app with app-tools, or map the same ownership rules onto an existing app.
2. [SDK → First AI Call](/sdk/first-ai-call) — make a Runtime-backed text
   generation call with AIConfig target resolution.
3. [SDK → Overview](/sdk/) and [SDK → Boundaries](/sdk/boundaries) — learn the
   public app boundary before importing SDK modules.
4. [Platform → Use Kit In An App](/platform/kit/use-kit-in-app) — reuse shared
   UI, shell, auth, telemetry, model configuration, and feature surfaces.
5. [Start → Use Tester As A Reference App](/start/use-tester-as-reference) —
   study the concrete reference app and app-tools source template.
6. [Start → Troubleshooting](/start/troubleshooting) — interpret Runtime, SDK,
   Tester, and scaffold failures.

## AI Agent Integrator

You want to integrate an external AI host as a participant.

1. [Platform → Vision](/platform/vision) — agents as first-class
   participants.
2. [Platform → External Agents](/platform/agents/external-agents) and
   [Platform → Participation Authority](/platform/agents/participation-authority)
   — the security and participation model for external agents.
3. [Runtime → Delegated Capability](/runtime/delegated-capability) —
   the gateway and output firewall.
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
3. [Nimi Coding → Governed Codex Project](/nimicoding/tutorials/project-to-governed-execution) —
   the boundary between host execution and project truth, gates, and evidence.
4. [Reference → Forbidden Claims](/reference/forbidden-claims) — the
   evidence-gated public-claim policy applied to docs.
5. [Reference → Schemas](/nimicoding/reference/schemas) — the contracts
   for reconstruction, evidence, and acceptance.

## Auditor / Reviewer

You are reviewing Nimi against admitted authority. You need to trace
public claims back to source.

1. [Reference → Spec Map](/reference/spec-map) — the public-section
   to spec-area mapping.
2. [Reference → Authority Domains](/reference/authority-domains) — who
   owns what.
3. [Reference → Glossary](/reference/glossary) — vocabulary alignment.
4. [Nimi Coding → Governed Codex Project](/nimicoding/tutorials/project-to-governed-execution) —
   how authority, gates, runtime checks, and evidence support review.

## Source Basis

- [`docs/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/INDEX.md)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
- [`.nimi/methodology/core.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/core.yaml)
