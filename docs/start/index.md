# Start

Pick a reading path that matches your role. Each path moves you from
the platform model into the part of Nimi you actually need.

For specific personas (newcomer evaluator, world creator, mod
developer, app developer, AI agent integrator, Nimi Coding adopter,
auditor / reviewer), see [Personas](/start/personas).

For installable surfaces and where each one lives, see
[Installation And Availability](/start/install).

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
   [Runtime Workflows](/runtime/workflows) — what the AI substrate
   is responsible for.
4. [SDK Overview](/sdk/) and
   [SDK Boundaries](/sdk/boundaries) — the integration discipline
   expected of apps.
5. [Nimi Coding Whitepaper](/nimicoding/whitepaper) — how AI-assisted
   engineering is governed in this repository.

This path takes about as long as reading a long blog post and gives a
faithful picture of what the public surface contains today.

## If You Are Building Against Nimi

Start with [SDK](/sdk/) and [Runtime](/runtime/). The SDK is the
public access surface for applications. Runtime and Realm private
boundaries should not be crossed directly from apps; the SDK exists
exactly so that apps do not have to.

For native shell behavior, read [Desktop](/desktop/). For Web
behavior, read [Web Mode](/desktop/web-mode). Web is a constrained
projection and does not inherit Desktop-native capabilities by
implication.

## If You Are Adopting Nimi Coding

Nimi Coding is admitted as a host-agnostic methodology and a
publishable npm package. Read in this order:

1. [Nimi Coding Overview](/nimicoding/) — the paradigm and the
   package.
2. [Topic Workflow](/nimicoding/topic-workflow) — the topic / wave /
   packet / preflight / audit / closeout lifecycle.
3. [Installation](/nimicoding/installation) — package install and
   adoption path.
4. [First Topic Bootstrap](/nimicoding/tutorials/first-topic) — a
   tutorial that walks the first topic end-to-end.

## Reader Scenario: An App Author Walks Through The Docs

Suppose you are an app author who just heard about Nimi. A useful
first walkthrough:

1. Read [Platform](/platform/) to find that worlds, not chat sessions,
   are the central object.
2. Read [Runtime](/runtime/) to find that providers, workflows,
   streaming, and multimodal artifacts follow Runtime contracts, not
   app code.
3. Read [SDK](/sdk/) to find that your app should consume those
   contracts through `sdk/runtime`, `sdk/world`, `sdk/realm`,
   `sdk/ai-provider`, and `sdk/scope`, not by importing private
   internals.
4. Read [Desktop](/desktop/) and [Web Mode](/desktop/web-mode) to
   learn why Desktop and Web do not have the same capability envelope
   and what that means for your distribution plans.
5. Read [Nimi Coding](/nimicoding/) once you start contributing,
   because that is the workflow other contributors expect for
   high-risk or cross-surface changes.

After that walkthrough, [Spec Map](/reference/spec-map) tells you
where to read the underlying contracts when public prose is not
precise enough.

## Source Basis

- [`.nimi/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/INDEX.md)
- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/sdk/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/index.md)
- [`.nimi/spec/desktop/web-adapter.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/web-adapter.md)
- [`nimi-coding/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/spec/product-scope.yaml)
