# Start

Pick a reading path that matches your role. Each path moves you from
the platform model into the part of Nimi you actually need.

For specific personas (newcomer evaluator, world creator, app
developer, AI agent integrator, Nimi Coding adopter,
auditor / reviewer), see [Personas](/start/personas).

For installable surfaces and where each one lives, see
[Installation And Availability](/start/install).

If you are creating an app, start with
[Create A Nimi App](/start/create-an-app) before reading the deeper SDK,
Runtime, and Kit sections.

If an SDK call, Tester lane, or generated app scaffold fails, use
[Troubleshooting](/start/troubleshooting) to map the visible error to the
public surface that owns it.

## If You Are New To Nimi

Read in this order:

1. [Platform](/platform/) for the product model, the world idea, and
   the six protocol primitives.
2. [Runtime](/runtime/) for how AI work is executed.
3. [SDK](/sdk/) for the app-facing access boundary.
4. [Desktop](/desktop/) for the native shell, and
   [Web Mode](/desktop/web-mode) for how Web differs.
5. [Realm](/realm/) for semantic truth, world state, and world
   history.

That order builds the mental model from "what kind of system this is"
into "how AI work gets done" and then into "how apps see it." When a
term is unfamiliar, [Glossary](/reference/glossary) collects the
cross-domain vocabulary every section uses.

## If You Are Evaluating The Project

For an evaluation pass:

1. [Platform Vision](/platform/vision) — the north-star framing.
2. [Platform Architecture](/platform/architecture/) — the cross-layer
   map.
3. [Runtime Overview](/runtime/) and
   [Memory And Knowledge](/runtime/memory-and-knowledge) — what the AI
   substrate owns.
4. [SDK Overview](/sdk/) and
   [SDK Boundaries](/sdk/boundaries) — the integration discipline
   expected of apps.
5. [Nimi Coding Whitepaper](/nimicoding/whitepaper) — how AI-assisted
   engineering is governed in this repository.

This path takes about as long as reading a long blog post and gives a
faithful picture of what the public surface contains today.

## If You Are Building Against Nimi

Start with [Create A Nimi App](/start/create-an-app) if you need a new
developer repository. Start with [SDK](/sdk/) and [Runtime](/runtime/) if you
are integrating from an existing app. The SDK is the public access surface for
applications. Runtime and Realm private boundaries should not be crossed
directly from apps; the SDK exists exactly so that apps do not have to.

If the immediate task is one Runtime-backed text generation call from a
TypeScript app, use [First AI Call](/sdk/first-ai-call) after Runtime is
running.

For a concrete reference app, read
[Use Tester As A Reference App](/start/use-tester-as-reference). For shared UI,
auth, shell, telemetry, and model configuration, read
[Use Kit In An App](/platform/kit/use-kit-in-app).

For a failing local run, SDK call, or app-tools scaffold check, read
[Troubleshooting](/start/troubleshooting) before changing app code.

For native shell behavior, read [Desktop](/desktop/). For Web
behavior, read [Web Mode](/desktop/web-mode). Web is a constrained
projection and does not inherit Desktop-native capabilities by
implication.

## If You Are Adopting Nimi Coding

Nimi Coding is admitted as a host-agnostic methodology and a
publishable npm package. Read in this order:

1. [Nimi Coding Overview](/nimicoding/) — the paradigm and the
   package.
2. [Run A Governed Codex Project](/nimicoding/tutorials/project-to-governed-execution) —
   how Codex-owned execution uses spec, methodology, gates, and evidence.
3. [Installation](/nimicoding/installation) — package install and
   adoption path.
4. [Verify The Nimi Governance Setup](/nimicoding/tutorials/project-bootstrap) —
   check host ownership, projections, and canonical truth.

## Reader Scenario: An App Author Walks Through The Docs

Suppose you are an app author who just heard about Nimi. A useful
first walkthrough:

1. Read [Platform](/platform/) to find that worlds, not chat sessions,
   are the central object.
2. Read [Runtime](/runtime/) to find that providers, LocalAgent,
   Conversation, Memory, Knowledge, streaming, and multimodal artifacts
   follow Runtime contracts, not app code.
3. Read [SDK](/sdk/) to find that your app should consume those
   contracts through the root `@nimiplatform/sdk` client, public subpaths such
   as `@nimiplatform/sdk/runtime` and `@nimiplatform/sdk/realm`, feature
   modules, and independent adapter packages, not by importing private
   internals.
4. Read [Create A Nimi App](/start/create-an-app),
    [Use Tester As A Reference App](/start/use-tester-as-reference), and
    [Use Kit In An App](/platform/kit/use-kit-in-app) before writing app-local
    shell, model config, or shared UI code.
5. Keep [Troubleshooting](/start/troubleshooting) open while wiring Runtime,
   SDK, AIConfig, and scaffold checks.
6. Read [Desktop](/desktop/) and [Web Mode](/desktop/web-mode) to
    learn why Desktop and Web do not have the same capability envelope
    and what that means for your distribution plans.
7. Read [Nimi Coding](/nimicoding/) once you start contributing,
    because that is the workflow other contributors expect for
    high-risk or cross-surface changes.

After that walkthrough, [Spec Map](/reference/spec-map) tells you
where to read the underlying contracts when public prose is not
precise enough.

## Source Basis

- [`docs/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/INDEX.md)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`docs/spec/runtime-domain-index.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/runtime-domain-index.md)
- [`docs/spec/sdks-domain-index.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/sdks-domain-index.md)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
