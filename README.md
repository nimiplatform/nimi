# Nimi

**Nimi is an AI open world platform.** It is built for long-lived worlds
where people, AI agents, applications, and runtime services share the
same social and semantic environment, instead of meeting only inside one
isolated chat box or one isolated app.

In most AI products today, an agent is a one-shot completion endpoint:
you ask, it answers, the conversation ends. Nimi treats an agent as a
participant. A participant carries identity, memory, relationships,
appearance, and capability limits with it from one world to another. And
a world here isn't just a chat room — it is a long-lived environment
with its own rules, its own history, its own presence model, and its own
economy.

The platform freezes a small cross-world contract surface so that very
different worlds can still interoperate. Inside any one world, the
creator sets the rules. Across worlds, only the protocol primitives are
fixed. Underneath all of it, Realm holds the world's truth — so one
surface can't quietly invent a version of the world that doesn't match
what Realm says.

## The Six Protocol Primitives

The platform spec freezes six fixed cross-world primitives. They are
deliberately small so worlds can be very different internally while
still interoperating.

| Primitive | What it covers |
| --- | --- |
| **Timeflow** | Progression, timing, and temporal meaning |
| **Social** | Relationships and social graph semantics |
| **Economy** | Value, exchange, and economic state |
| **Transit** | Movement between worlds or contexts |
| **Context** | Shared situational meaning |
| **Presence** | Who or what is present, and under what conditions |

A world is free to define its own internal rules. Its economy can be
barter, points, or a regulated currency. Its social graph can be flat,
hierarchical, or guild-shaped. What no world can do is invent its own
version of the cross-world contract — the meaning that crosses worlds
must fit these six.

## What Nimi Contains

Nimi is one open world platform with several products inside it. The
platform defines the world model and the rules; the products inside
cover execution, integration, surfaces, world truth, embodiment,
memory, and the AI development methodology that ships with all of them.

| Product | What it owns |
| --- | --- |
| **Platform** | The open world model, the six protocol primitives, the cross-domain authority rules. |
| **Runtime** | AI execution: providers, model catalogs, workflows, streaming, multimodal output, local routing, delegated capabilities, audit, and runtime-owned agent participation. |
| **SDK** | The TypeScript app boundary into Runtime, Realm, world semantics, AI providers, scope, and mods, without importing private internals. |
| **Desktop and Web** | First-party user surfaces. Desktop is the native shell with local and mod capabilities; Web is the constrained browser projection. |
| **Realm** | Semantic truth — world state, world history, chat, social and economy, asset binding, transit, creator economy. |
| **Avatar** | Embodied agent presentation as its own first-class authority surface. |
| **Cognition** | Standalone memory, knowledge, prompt serving, references, and completion. |
| **Nimi Coding** | The AI-native development methodology and the host-agnostic npm package that delivers it. |

Each product has its own section in the docs.

## The Three Layers

The platform splits into three layers that are easier to keep distinct
than to mix together.

```
+---------------------------------------------------------------+
|  Platform Model                                               |
|    World, Agent, six protocol primitives, authority rules     |
+---------------------------------------------------------------+
                              |
                              v
+---------------------------------------------------------------+
|  Execution Substrate                                          |
|    Runtime    : providers, workflows, streaming,              |
|                 multimodal, delegation, audit                 |
|    Cognition  : memory, knowledge, prompt serving,            |
|                 references, completion                        |
+---------------------------------------------------------------+
                              |
                              v
+---------------------------------------------------------------+
|  Public Surfaces                                              |
|    SDK app boundary           Desktop native shell            |
|    Web constrained projection Realm public read path          |
|    Avatar embodiment authority                                |
+---------------------------------------------------------------+
```

Runtime executes AI workflows. SDK gives apps the integration boundary.
Desktop carries native and local behavior; Web is the constrained
projection. Realm owns world truth. Avatar owns embodied presentation.
Cognition owns memory and knowledge as a standalone authority that
Runtime can bridge to but cannot absorb.

## Apps That Showcase The Platform

The `apps/` directory contains extension apps that demonstrate what the
platform can do. They consume Runtime, Realm, SDK, and the public
surfaces; they do not extend the platform's authority. If you are
reading an `apps/<name>/` directory, you are looking at a Nimi-powered
app, not the platform itself.

| App | What it explores |
| --- | --- |
| [`apps/desktop/`](apps/desktop/) | Native first-party shell — agent chat, local AI, knowledge, voice |
| [`apps/web/`](apps/web/) | Browser projection of public Desktop surfaces |
| [`apps/avatar/`](apps/avatar/) | Live2D embodied carrier for Nimi agents (floating desktop avatar) |
| [`apps/install-gateway/`](apps/install-gateway/) | Cloudflare Worker for release distribution |

## What's Installable Today

Nimi Coding is the AI-native development methodology, distributed as the
host-agnostic npm package
[`@nimiplatform/nimi-coding`](https://www.npmjs.com/package/@nimiplatform/nimi-coding).
It governs how authority, semantics, consumers, and drift-prevention
are checked across AI-assisted work — failure modes that compile,
pass tests, and survive code review can still violate any of those four
closures, and the methodology is built around catching them. Adoption
guidance lives in
[docs/nimicoding/installation.md](docs/nimicoding/installation.md).

The Platform, Runtime, SDK, Desktop, Web, Realm, Avatar, and Cognition
surfaces are documented at the contract level under `docs/` and authored
under `.nimi/spec/`. Their public release channels are not yet open.

## Quickstart

Once the runtime CLI is on `PATH`, three commands cover the
zero-config first-run path:

```sh
# Start the local runtime daemon (background).
nimi start

# Ask the local runtime to answer a question with the default provider.
nimi run "What is Nimi?"

# Same prompt, routed through Gemini (set the API key in your env first;
# see the provider configuration step below).
nimi run "What is Nimi?" --provider gemini
```

To configure a cloud provider before invoking `--provider gemini`:

```sh
nimi provider set gemini --api-key-env GEMINI_API_KEY
```

`nimi doctor` reports environment, daemon, and provider readiness.

## Documentation

Reader docs live under [`docs/`](docs/) (built with VitePress) and are
organized by product.

| If you want to understand... | Start here |
| --- | --- |
| The product, the world model, why it exists | [docs/platform/index.md](docs/platform/index.md) |
| The current setup and availability posture | [docs/start/index.md](docs/start/index.md) |
| Find the reading path for your role | [docs/start/personas.md](docs/start/personas.md) |
| How AI execution is governed | [docs/runtime/index.md](docs/runtime/index.md) |
| How apps integrate without crossing internal boundaries | [docs/sdk/index.md](docs/sdk/index.md) |
| Why Desktop and Web are not equivalent | [docs/desktop/index.md](docs/desktop/index.md) |
| Where world truth and history live | [docs/realm/index.md](docs/realm/index.md) |
| How embodied AI presentation is scoped | [docs/avatar/index.md](docs/avatar/index.md) |
| Where memory and knowledge authority live | [docs/cognition/index.md](docs/cognition/index.md) |
| The AI development methodology and its package | [docs/nimicoding/index.md](docs/nimicoding/index.md) |
| Cross-domain vocabulary | [docs/reference/glossary.md](docs/reference/glossary.md) |
| Reference tables (six primitives, authority domains, fields) | [docs/reference/index.md](docs/reference/index.md) |

To preview the docs site locally:

```bash
pnpm install
pnpm --filter @nimiplatform/docs dev
```

Chinese-language docs are mirrored under [`docs/zh/`](docs/zh/) as
original Chinese content, not sentence-by-sentence translation.

## Repository Map

| Area | Purpose |
| --- | --- |
| `.nimi/spec/` | Active product, architecture, and behavior contracts |
| `.nimi/methodology/` | Nimi Coding methodology and governance material |
| `.nimi/contracts/` | Machine contracts for reconstruction, audit, admission |
| `.nimi/topics/` | Human-authored topic lifecycle artifacts |
| `runtime/` | Go runtime daemon and CLI (`runtime/cmd/nimi`) |
| `sdk/` | TypeScript SDK (`@nimiplatform/sdk`) |
| `kit/` | Cross-app design system, auth, telemetry, and feature modules |
| `proto/` | Protocol Buffers and gRPC definitions |
| `apps/` | Active apps (Desktop, Web, Avatar, install gateway) |
| `nimi-cognition/` | Cognition implementation workspace |
| `docs/` | Public documentation source (VitePress) |
| `examples/` | SDK / runtime / app scaffold templates |
| `scripts/` | Build, generate, validate, and audit scripts |

The full module ownership map is described in per-module `AGENTS.md`
files; each top-level directory has its own.

## Building From Source

Prerequisites:

- Node.js `>=24`
- pnpm `>=10`
- Go `1.24+`
- Rust toolchain (for Tauri-based apps)
- Buf CLI (for proto changes)

Bootstrap:

```bash
pnpm install
```

Common commands:

```bash
pnpm build                          # SDK + install-gateway + desktop + web build
pnpm --filter @nimiplatform/sdk build
pnpm runtime:cmd                    # invoke the runtime CLI
pnpm runtime:health                 # query runtime health via gRPC
cd runtime && go test ./... -count=1
```

For first-day setup, including the `.env` template, runtime
initialization, and per-app dev commands, see
[ONBOARDING.md](ONBOARDING.md).

For the test strategy, see [TESTING.md](TESTING.md). For the release
model, see [RELEASE.md](RELEASE.md).

## Contributing

Contributions are welcome. Before opening a PR:

1. Read the nearest `AGENTS.md` to the directory you are touching — it
   is the authoritative module rule source.
2. Follow [CONTRIBUTING.md](CONTRIBUTING.md) for branch flow, test
   requirements, and DCO sign-off (`git commit -s`).
3. If you are using AI coding tools, follow the AGENTS hierarchy as the
   single rule source; `CLAUDE.md`, `.github/copilot-instructions.md`,
   and other host shims are navigation only.

The contributor code of conduct lives in
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Project governance lives in
[GOVERNANCE.md](GOVERNANCE.md).

## Security

Do not open public issues for security reports. Use the GitHub Security
Advisory (preferred) or email `security@nimi.ai`. Full reporting
guidance and supported-version policy live in [SECURITY.md](SECURITY.md).

## License

Nimi is multi-licensed by component:

| Path | License |
| --- | --- |
| `runtime/`, `sdk/`, `proto/` | Apache-2.0 |
| `apps/desktop/`, `apps/web/`, `apps/_libs/` | MIT |
| `docs/` | CC-BY-4.0 |

Canonical license texts are in [`licenses/`](licenses/). The full
per-component map is in [LICENSE](LICENSE).

## Community

- GitHub: [github.com/nimiplatform/nimi](https://github.com/nimiplatform/nimi)
- Discord: [discord.gg/BQwHJvPn](https://discord.gg/BQwHJvPn)

## A Word On OASIS

You'll see "OASIS" mentioned in some docs. The comparison is about
*shape*, not content. OASIS-style engines are physical-world engines;
Nimi is a social-and-semantic world engine. Inside any one Nimi world,
the creator sets the rules. Across worlds, only the six protocol
primitives are fixed. Underneath all of it, Realm holds the world's
truth.
