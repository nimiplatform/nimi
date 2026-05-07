# Start

This page helps you choose the right reading path. Nimi is pre-launch, so
the public docs are primarily a product and architecture guide. Nimi
Coding has its own npm package; the rest of the platform docs explain
the product surface before they become a runnable onboarding flow.

If you arrived here looking for setup information, jump to
[Installation And Availability](/start/install). That page separates the
published Nimi Coding package from the broader platform surfaces.

## If You Are New To Nimi

Read the docs in this order:

1. [Platform](/platform/) for the product model, the world idea, and the
   six protocol primitives.
2. [Runtime](/runtime/) for how AI work is actually executed.
3. [SDK](/sdk/) for the app-facing access boundary.
4. [Desktop](/desktop/) for the first-party native shell and how Web
   differs from it.
5. [Realm](/realm/) for semantic truth and world history.

That sequence builds the mental model before you encounter implementation
details. It moves from "what kind of system this is" into "how AI work
gets done" and then into "how apps see it."

If you want a single reference page for vocabulary, the
[Glossary](/glossary) collects cross-domain terms used in every section.

## If You Are Evaluating The Project

For a quick evaluation pass, read in this order:

1. [Platform Vision](/platform/vision) — the north-star framing.
2. [Platform Architecture](/platform/architecture/) — the cross-layer map.
3. [Runtime Overview](/runtime/) and
   [Runtime Workflows And Multimodal](/runtime/workflows-and-multimodal)
   — what the AI substrate is responsible for.
4. [SDK Overview](/sdk/) and [SDK Boundaries](/sdk/boundaries) — the
   integration discipline expected of apps.
5. [Nimi Coding Whitepaper](/nimicoding/whitepaper) — how AI-assisted
   engineering is governed in this repository.

This path takes about as long as reading a long blog post and gives a
faithful picture of what the public surface contains today.

## If You Are Building Against Nimi

Start with [SDK](/sdk/) and [Runtime](/runtime/). The SDK is the public
access surface for applications. Runtime and Realm private boundaries
should not be crossed directly from apps; the SDK exists exactly so that
apps do not have to.

For native shell behavior, read [Desktop](/desktop/). For Web behavior,
read [Web Mode](/desktop/web-mode). Web is a constrained projection and
does not inherit Desktop-native capabilities by implication.

## Reader Scenario: An App Author Walks Through The Docs

Suppose you are an app author who just heard about Nimi. A useful first
walkthrough looks like this:

1. Read [Platform](/platform/) to find out that worlds, not chat sessions,
   are the central object.
2. Read [Runtime](/runtime/) to find out that providers, workflows,
   streaming, and multimodal artifacts follow Runtime contracts,
   not by your app code.
3. Read [SDK](/sdk/) to find out that your app should consume those
   contracts through `sdk/runtime`, `sdk/world`, `sdk/realm`,
   `sdk/ai-provider`, `sdk/scope`, and `sdk/mod`, not by importing
   private internals.
4. Read [Desktop](/desktop/) and [Web Mode](/desktop/web-mode) to learn
   why Desktop and Web do not have the same capability envelope and what
   that means for your app's distribution plans.
5. Read [Nimi Coding](/nimicoding/) once you start contributing, because
   that is the workflow other contributors will expect you to follow on
   high-risk or cross-surface changes.

After that walkthrough, the [Spec Map](/reference/spec-map) tells you
where to read the underlying contracts when public prose is not precise
enough.

## If You Are Looking For Setup Instructions

Public setup material must be backed by admitted evidence: the command
must exist, the route must be supported, and the release or distribution
channel must be real. Today that is true for Nimi Coding's npm package;
other surfaces still use contract pages to describe the product model.

See [Installation And Availability](/start/install) for the current
split between installable package and product documentation.

## Source Basis

- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/sdk/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/index.md)
- [`.nimi/spec/desktop/web-adapter.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/web-adapter.md)
- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
