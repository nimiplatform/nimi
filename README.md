# Nimi

**Nimi is an open-source, local-first, installable personal AI product.**
Nimi Home is its entry point, Realm owns ecosystem identity, and Runtime
executes local and cloud AI capabilities across multiple providers. Characters,
conversations, creations, stories, and worlds are experiences within Nimi;
Nimi is not reducible to Runtime, a chat product, Avatar, or any one experience.
Nimi Apps is the canonical product path for Registry-approved verified package
catalog, installation, update, launch, repair, and uninstall semantics, with
Developer Mode as a separate non-package local-development path. This pre-release
currently exposes Developer Mode plus protected-tag GitHub Actions and immutable
GitHub Release publication for explicitly configured pilot App repositories;
public catalog, ordinary installation, update, installed launch, repair,
uninstall, registry onboarding, and registry admission remain unavailable.

The broader project is an AI open world platform. It is built for long-lived
worlds where people, AI agents, applications, and runtime services share the
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

## Public Project Links and Release Status

- [Download](https://nimi.ai/download)
- [Code signing policy](https://nimi.ai/code-signing)
- [Documentation](https://docs.nimi.ai)
- [Source code](https://github.com/nimiplatform/nimi)
- [Security advisories](https://github.com/nimiplatform/nimi/security/advisories) and [`security@nimi.ai`](mailto:security@nimi.ai)

**Windows production signing is pending.** Windows is not yet available as a
production download, and no current Nimi Windows artifact should be treated as
production signed or SignPath-signed. The required unsigned bootstrap is now
public in the immutable [v0.2.2-preview.1 prerelease](https://github.com/nimiplatform/nimi/releases/tag/v0.2.2-preview.1),
but the SignPath Foundation application has not yet been submitted. Local
development self-signing is never a production-signing claim.

The Download and Code signing policy links above are the live canonical public
routes. Changes in a source checkout do not change those pages until the website
is deployed.

Unsigned previews, when published, use immutable `vX.Y.Z-preview.N` GitHub
prereleases and are marked **UNSIGNED PREVIEW — NOT PROMOTABLE**. They do not
update stable `latest`, publish registries, or become RC/Stable assets. The
current `v0.2.2-preview.1` scope is a Windows source-local Kit package, a
repo-assisted macOS candidate, and a portable unsigned Windows x64 Runtime ZIP;
it includes no Nimi Home installer or Linux asset. Download the exact
[Runtime bootstrap ZIP](https://github.com/nimiplatform/nimi/releases/download/v0.2.2-preview.1/Nimi-Runtime-v0.2.2-preview.1-windows-x64-unsigned-bootstrap.zip)
only from that prerelease.

The portable bootstrap is not an installer or protected Runtime service: use it
by extracting the archive and running `.\nimi.exe version --json`, then remove
it by closing the process and deleting the extracted directory. It does not
create a service, modify `PATH`, write Program Files or ProgramData, or install a
certificate. With that unsigned release now public, the project can apply to
SignPath Foundation; submitting the application is the next separate owner
action. Approval and a
SignPath-provided certificate then precede the first formally signed Windows x64 Runtime and the leaf certificate
SubjectPublicKeyInfo (SPKI) SHA-256 consumed by the protected-local package.
Preview bytes are never promoted or retrospectively described as signed.

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
memory, and the authority tooling used to maintain those boundaries.

| Product | What it owns |
| --- | --- |
| **Platform** | The open world model, the six protocol primitives, the cross-domain authority rules. |
| **Runtime** | LocalAgent execution and lifecycle, Conversation continuity, operational Memory and Knowledge, providers, model catalogs, streaming, multimodal output, local routing, protected access, and audit. Workflow, MCP, and World Evolution are not Runtime-core prerequisites. |
| **SDK** | The public app boundary into Runtime and Realm without importing private internals. Scaffolded local apps use Runtime-mediated Realm access; direct SDK consumers retain the standard Auth path. |
| **Nimi Home, Desktop, and Web** | First-party user surfaces. Nimi Home is the product contract; Desktop is its current replaceable native host, while Web is a constrained projection. |
| **Realm** | Semantic truth — world state, world history, chat, social and economy, asset binding, transit, creator economy. |
| **Avatar** | An embodied LocalAgent projection; it does not own LocalAgent execution, Memory, Knowledge, or Conversation truth. |
| **Cognition** | An independent capability domain whose complete product design is deferred. Runtime may consume it only through a public bridge; Cognition does not take over Runtime-owned LocalAgent truth. |
| **Nimi Coding** | Host-agnostic canonical-authority tooling. It operates on project-owned `.nimi/spec/**`; it is not another product authority. |

Each product has its own section in the docs.

## The Three Layers

The platform splits into three layers that are easier to keep distinct
than to mix together.

```
+---------------------------------------------------------------+
|  Platform Model                                               |
|    World, Character / LocalAgent, protocol primitives, rules  |
+---------------------------------------------------------------+
                              |
                              v
+---------------------------------------------------------------+
|  Execution Substrate                                          |
|    Runtime    : LocalAgent, Conversation, Memory, Knowledge,  |
|                 providers, streaming, protected access        |
|    Cognition  : independent deferred domain, public bridge    |
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

Runtime executes local and cloud AI capabilities across providers. SDK gives
apps the integration boundary.
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
| [`apps/lab/`](apps/lab/) | Nimi Lab capability integration and incubation app for SDK, Kit, app-tools, Runtime auth, and AI capability lanes |
| [`apps/install-gateway/`](apps/install-gateway/) | Cloudflare Worker for release distribution |

## What's Installable Today

The current public installable surface includes authority and app-authoring
tooling. Nimi Coding is distributed as the host-agnostic npm package
[`@nimiplatform/nimi-coding`](https://www.npmjs.com/package/@nimiplatform/nimi-coding).
It provides deterministic canonical-authority products. Version 0.6.1 provides
request-local, bounded TypeScript/TSX context reads and optional exact
authority links in TypeScript, TSX, Go, Python, and Rust source. These code reads do not
intercept host tasks, evaluate unannotated code, or prove implementation
conformance. Adoption guidance lives in
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
separate from the source checkout itself. Cloning the repo does not make those
products publicly installable.

## Source Checkout Quickstart

These commands are for a source checkout or locally built runtime binary.
Once the runtime CLI is on `PATH`, initialize config and run the daemon in the
foreground. Use background commands only on a build with an admitted manager or
service controller:

```sh
# Create runtime config if it is missing.
nimi init

# Run the local runtime daemon in the foreground.
nimi serve
```

Connector custody and ModelAsset/Loadout selection are managed through the
Desktop protected Runtime surface. App-facing AI execution uses the SDK rather
than a parallel CLI configuration owner.

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
| How to work with Nimi Lab | [docs/start/use-nimi-lab.md](docs/start/use-nimi-lab.md) |
| How to interpret Runtime, SDK, Nimi Lab, and scaffold failures | [docs/start/troubleshooting.md](docs/start/troubleshooting.md) |
| Why Desktop and Web are not equivalent | [docs/desktop/index.md](docs/desktop/index.md) |
| Where world truth and history live | [docs/realm/index.md](docs/realm/index.md) |
| How embodied AI presentation is scoped | [docs/avatar/index.md](docs/avatar/index.md) |
| Where memory and knowledge authority live | [docs/cognition/index.md](docs/cognition/index.md) |
| The canonical-authority tooling and its package | [docs/nimicoding/index.md](docs/nimicoding/index.md) |
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
| `.nimi/methodology/` | Managed canonical-authority authoring instructions |
| `runtime/` | Go runtime daemon and CLI (`runtime/cmd/nimi`) |
| `sdks/` | SDK family root; TypeScript vNext package target is `@nimiplatform/sdk` |
| `kit/` | Cross-app design system, auth, telemetry, and feature modules |
| `app-tools/` | Public app-authoring CLI (`nimi-app`) and scaffold templates |
| `proto/` | Protocol Buffers and gRPC definitions |
| `apps/` | Active apps (Desktop, Web, Avatar, Nimi Lab, install gateway) |
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
- Go `1.26.5+`
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
pnpm runtime:health                 # query manager-owned runtime health
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
guidance, signed-artifact verification status, and supported-version policy live
in [SECURITY.md](SECURITY.md). The canonical public
[Code signing policy](https://nimi.ai/code-signing) records the Windows signing
scope and current approval status once deployed.

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
- Maintainer and trusted committer: [@snowzane](https://github.com/snowzane),
  who also reviews external contributions and is the planned signing approver
- Working entity: Nimi Network Limited, the registered company supporting the
  project

The GitHub organization enforces MFA. Production signing remains unavailable
until the protected signing workflow and approval permission are configured;
no future SignPath access may be granted without MFA.

## A Word On OASIS

You'll see "OASIS" mentioned in some docs. The comparison is about
*shape*, not content. OASIS-style engines are physical-world engines;
Nimi is a social-and-semantic world engine. Inside any one Nimi world,
the creator sets the rules. Across worlds, only the six protocol
primitives are fixed. Underneath all of it, Realm holds the world's
truth.
