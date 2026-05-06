# Nimi

Nimi is an AI open world platform. It is built for long-lived worlds where
people, AI agents, applications, and runtime services share the same social
and semantic environment instead of meeting only inside one isolated chat box
or one isolated app.

In most AI products today, the agent is a one-shot completion endpoint: you
ask, it answers, the conversation ends. Nimi treats an agent as a participant
instead — something that carries its identity, memory, relationships,
appearance, and capability limits with it from one world to another. And a
world isn't just a chat room. It's a long-lived environment with its own
rules, its own history, its own presence model, and its own economy.

## What Nimi Is

Nimi is one open world platform with several products inside it. The platform
itself defines the world model and the rules; the products inside cover
execution, integration, surfaces, world truth, presentation, memory, and the
development methodology that ships with all of them.

| Product | What it covers |
| --- | --- |
| **Platform** | The open world model, the six fixed protocol primitives (Timeflow, Social, Economy, Transit, Context, Presence), and the cross-domain authority rules. |
| **Runtime** | The AI execution layer: providers, model catalogs, workflows, streaming, multimodal output, local routing, delegated capabilities, audit, runtime-owned agent participation. |
| **SDK** | The TypeScript app-facing access boundary. Apps go through the SDK instead of reaching into Runtime or Realm internals. |
| **Desktop and Web** | The first-party user surfaces. Desktop is the native shell with local and mod capabilities; Web is the constrained browser version. |
| **Realm** | Semantic truth — world state, world history, chat, and related domain contracts. |
| **Avatar** | Embodied agent presentation as its own authority surface. |
| **Cognition** | Standalone memory, knowledge, prompt serving, references, completion, and runtime-bridge semantics. |
| **Nimi Coding** | The AI development methodology that ships with the platform, plus the standalone host-agnostic npm package that delivers it. |

Each of these has its own section in the docs.

## Apps That Showcase The Platform (Not Part Of It)

The `apps/` directory in this repository contains extension apps —
parentOS, Forge, shiji, overtone, moment, lookdev, polyinfo,
realm-drift, asset-market, video-food-map, install-gateway, and others.
They demonstrate what the platform can do, but they are not part of the
platform. They consume Runtime, Realm, SDK and the public surfaces; they
do not extend the platform's authority surface.

If you are looking at an `apps/<name>/` directory, you are reading
**a Nimi-powered app**, not the platform itself. The platform is what is
documented under `docs/`.

## A Word On OASIS

You'll see "OASIS" mentioned in some docs. The comparison is about *shape*,
not content. OASIS-style engines are physical-world engines; Nimi is a
social-and-semantic world engine. Inside any one Nimi world, the creator
sets the rules. Across worlds, only the six protocol primitives are fixed.
And underneath all of it, Realm holds the world's truth — so one surface
can't quietly invent a version of the world that doesn't match what Realm
says.

## Where To Start

- Public documentation home: [docs/index.md](docs/index.md)
- Product map and primitives: [docs/platform/index.md](docs/platform/index.md)
- AI execution layer: [docs/runtime/index.md](docs/runtime/index.md)
- Application integration boundary: [docs/sdk/index.md](docs/sdk/index.md)
- Native shell and web mode: [docs/desktop/index.md](docs/desktop/index.md)
- World truth and history: [docs/realm/index.md](docs/realm/index.md)
- AI coding governance: [docs/nimicoding/index.md](docs/nimicoding/index.md)
- Glossary of cross-domain terms: [docs/glossary.md](docs/glossary.md)

## Repository Map

| Area | Purpose |
| --- | --- |
| `.nimi/spec/` | Active product, architecture, and behavior authority |
| `.nimi/methodology/` | Nimi Coding methodology and governance material |
| `.nimi/topics/` | Human-authored topic lifecycle artifacts |
| `runtime/` | Runtime implementation |
| `sdk/` | TypeScript SDK implementation |
| `apps/desktop/` | Desktop shell |
| `apps/web/` | Web projection and public landing implementation |
| `docs/` | Public documentation source |
