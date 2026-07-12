# Nimi

**Nimi is an open-source, local-first, multi-provider personal AI runtime with
Realm-owned ecosystem identity.** The broader project is an AI open world
platform. It is built for long-lived worlds
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
| **Runtime** | AI execution: providers, model catalogs, workflows, streaming, multimodal output, local routing, delegated capabilities, audit, supported agent chat, and narrow follow-up-turn hooks. |
| **SDK** | The TypeScript app boundary into Runtime, Realm, world semantics, AI providers, and governed scopes, without importing private internals. |
| **Desktop and Web** | First-party user surfaces. Desktop is the native shell for local runtime interaction; Web is the constrained browser projection. |
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

The `apps/` directory contains first-party and reference apps that demonstrate what the
platform can do. They consume Runtime, Realm, SDK, and the public
surfaces; they do not extend the platform's authority. If you are
reading an `apps/<name>/` directory, you are looking at a Nimi-powered
app, not the platform itself.

| App | What it explores |
| --- | --- |
| [`apps/desktop/`](apps/desktop/) | Native first-party shell — agent chat, local AI, knowledge, voice |
| [`apps/web/`](apps/web/) | Browser projection of public Desktop surfaces |
| [`apps/avatar/`](apps/avatar/) | Live2D embodied carrier for Nimi agents (floating desktop avatar) |
| [`apps/tester/`](apps/tester/) | Nimi Lab developer reference app for SDK, Kit, app-tools, Runtime auth, and AI capability lanes |
| [`apps/install-gateway/`](apps/install-gateway/) | Cloudflare Worker for release distribution |

## What's Installable Today

The current public installable surface is the governance and app-authoring
tooling. Nimi Coding is the AI-native development methodology, distributed as the
host-agnostic npm package
[`@nimiplatform/nimi-coding`](https://www.npmjs.com/package/@nimiplatform/nimi-coding).
It governs how authority, semantics, consumers, and drift-prevention
are checked across AI-assisted work — failure modes that compile,
pass tests, and survive code review can still violate any of those four
closures, and the methodology is built around catching them. Adoption
guidance lives in
[docs/nimicoding/installation.md](docs/nimicoding/installation.md).

`@nimiplatform/app-tools` is the app-authoring CLI for generated Nimi App
developer repositories. It creates scaffold inputs and local checks only; it
does not create public app admission, permission grants, release descriptors,
registry visibility, or installed-app update truth.

```bash
pnpm dlx --package @nimiplatform/app-tools nimi-app create --profile standalone
```

The Platform, Runtime, SDK, Desktop, Web, Realm, Avatar, and Cognition
surfaces are documented at the contract level under `docs/` and authored
under `.nimi/spec/`. Their stable public product release channels remain
release-gated and are not opened by the source checkout itself. Cloning the
repo does not make those products publicly installable.

## Source Checkout Quickstart

These commands are for a source checkout or locally built runtime binary.
Once the runtime CLI is on `PATH`, initialize config, start the daemon, and
verify a runnable route:

```sh
# Create runtime config if it is missing.
nimi init

# Start the local runtime daemon in the background.
nimi start

# Ask Runtime to answer a question through the configured route.
nimi run "What is Nimi?"

# Same prompt, explicitly routed through Gemini.
nimi run "What is Nimi?" --provider gemini

# Save Gemini as the default provider route for later calls.
nimi provider set gemini --api-key-env GEMINI_API_KEY --default
```

For local-first setup, replace the provider step with the relevant local model
pull and readiness check:

```sh
nimi model pull --model-ref <admitted-model-ref>
nimi model health --model-id <installed-model-id>
```

`nimi doctor` reports environment, daemon, and provider readiness.

## Public Existence Proof

For the first public existence event, run the named release-gate proof:

```bash
pnpm release:proof:first-public
```

This runs the `first-public-existence` tier from the release-gate registry and
writes `release-gate-evidence/v1` output under `.local/report/release/`. A pass
proves the frozen public promise boundary, SDK/app-tools developer entry, and
spec governance checks for this source checkout. It does not open product
release channels, app admission, permission grants, release descriptors, or
installed-app update truth.

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
| How a TypeScript app makes its first Runtime AI call | [docs/sdk/first-ai-call.md](docs/sdk/first-ai-call.md) |
| How apps reuse shared UI, shell, auth, model config, and feature modules | [docs/platform/kit/use-kit-in-app.md](docs/platform/kit/use-kit-in-app.md), [kit/README.md](kit/README.md) |
| How to create a Nimi App scaffold | [docs/start/create-an-app.md](docs/start/create-an-app.md) |
| How to study the reference app | [docs/start/use-tester-as-reference.md](docs/start/use-tester-as-reference.md) |
| How to interpret Runtime, SDK, Tester, and scaffold failures | [docs/start/troubleshooting.md](docs/start/troubleshooting.md) |
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
| `runtime/` | Go runtime daemon and CLI (`runtime/cmd/nimi`) |
| `sdks/` | SDK family root; TypeScript vNext package target is `@nimiplatform/sdk` |
| `kit/` | Cross-app design system, auth, telemetry, and feature modules |
| `app-tools/` | Public app-authoring CLI (`nimi-app`) and scaffold templates |
| `proto/` | Protocol Buffers and gRPC definitions |
| `apps/` | Active apps and references (Desktop, Web, Avatar, Tester/Nimi Lab, install gateway) |
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
- Go `1.26.4+`
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
| `runtime/`, `sdks/`, `proto/` | Apache-2.0 |
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
