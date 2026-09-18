# Nimi

**让 AI 真正属于你。** Make AI truly yours.

Nimi is an installable, open-source, local-first personal AI product: use AI apps, talk with AI characters, and explore different worlds in one place — choose local or cloud AI, and build apps of your own.

[Download status](https://nimi.ai/download) · [Website](https://nimi.ai) · [Documentation](https://docs.nimi.ai) · [Releases](https://github.com/nimiplatform/nimi/releases) · [Discord](https://discord.gg/BQwHJvPn)

A stable public installer is not available yet. The earlier developer previews were withdrawn; the source remains available for development. The [Download page](https://nimi.ai/download) always carries the current per-platform status.

## What you can do with Nimi

- **Use apps.** Free Nimi apps cover work and creation, life management, and interests — writing, organizing, images, audio, family records, personality exploration, and personal rhythms.
- **Meet characters and worlds.** Talk with AI characters and explore the worlds they belong to.
- **Choose your AI.** Run models locally on your computer, or connect supported cloud capabilities. What you use is your choice.
- **Create your own app.** Build a local AI tool around your own tasks, steps, and results.
- **Keep the same AI.** The AI you talk to keeps its identity and memory across the apps it is connected to, so you do not start over each time.

See [nimi.ai](https://nimi.ai) for the product tour.

## Apps in the ecosystem

Every admitted app has a public source repository and an explicit open-source license. The current catalog includes:

| App | What it does | Platforms |
| --- | --- | --- |
| ParentOS | Keeps a child's growth journal and family observations, with records and stage reminders. | macOS arm64 · Windows x86_64 |
| Nimi Overtone | Organizes music projects, lyrics, and audio takes, and compares versions. | macOS arm64 · Windows x86_64 |
| Storybook | Reads and creates interactive stories where characters and choices move the narrative. | macOS arm64 · Windows x86_64 |
| Realm Persona Studio | Creates and manages your own Realm Personas, profiles, and drafts. | macOS arm64 · Windows x86_64 |
| 时镜 ShiJing | A personal rhythm companion built on deterministic traditional calendar charting. | macOS arm64 · Windows x86_64 |
| Inscape 心相 | A local tool for adults exploring personality and everyday reflection. | macOS arm64 · Windows x86_64 |
| Realm World Studio | Creation and maintenance for Realm world content. | macOS arm64 · Windows x86_64 |
| Vane | Admitted catalog app (text and embeddings). | macOS arm64 · Windows x86_64 |
| OpenMontage | Admitted catalog app (text, image, video, audio, and music capabilities). | macOS arm64 · Windows x86_64 |
| Next AI Draw.io | Admitted catalog app (text). | macOS arm64 · Windows x86_64 |

Verified Catalog discovery, installation, update, launch, focus, stop, access management, and uninstall are provided on Windows x86_64 and macOS arm64 through the protected Desktop path. The local-package import entry, package lifecycle on other platforms, and ordinary repair remain unavailable. Installing an app does not grant Nimi access; account and Runtime conditions still apply. The catalog page is informational: [nimi.ai/apps](https://nimi.ai/apps).

## For developers

Build something new, or adapt an existing project.

- **Nimi SDK** — one typed interface to local and cloud AI capabilities.
- **Adapters** — `@nimiplatform/sdk-adapter-vercel-ai` and `@nimiplatform/sdk-adapter-mastra` connect existing frameworks.
- **Scaffold** — create a local app project:

```bash
pnpm dlx --package @nimiplatform/app-tools nimi-app create --profile standalone
```

Start with the [Create a Nimi App guide](https://docs.nimi.ai/start/create-an-app) and the [first AI call](https://docs.nimi.ai/sdk/first-ai-call). Adapter notes live in [sdks/typescript](sdks/typescript/README.md).

## Open source and trust

- **Source** — the platform core (runtime, SDK, Kit, Proto) is open; the Realm implementation is not part of the public distribution. See [LICENSE](LICENSE) for the per-component map.
- **Security** — report vulnerabilities through [GitHub Security Advisories](https://github.com/nimiplatform/nimi/security/advisories/new) or `security@nimi.ai`. See [SECURITY.md](SECURITY.md).
- **Code signing** — the current signing scope and status are recorded in the [Code signing policy](https://nimi.ai/code-signing).
- **Local-first** — conversations and AI work can run on your own machine with local models; cloud capabilities are used only when you choose them.

## Platform

Nimi Home is the product entry. Realm owns world and identity truth. Runtime executes local and cloud AI capabilities across supported providers. The full architecture, protocol primitives, and ownership model are documented at [docs.nimi.ai/platform](https://docs.nimi.ai/platform).

## Release and versioning

Product and component releases are separate and always name their owner: `nimi/v<version>` for the complete product, `desktop/v<version>` and `runtime/v<version>` for component deliveries, and per-package prefixes for libraries. Third-party apps release from their own repositories. See [RELEASE.md](RELEASE.md) and the [Download page](https://nimi.ai/download).

## Working in this repository

- [CONTRIBUTING.md](CONTRIBUTING.md) — branch flow, tests, and DCO sign-off (`git commit -s`).
- [ONBOARDING.md](ONBOARDING.md) — first-day setup.
- [TESTING.md](TESTING.md) — test strategy.
- Per-directory `AGENTS.md` files are the module rule sources.

## Community

- GitHub: [github.com/nimiplatform/nimi](https://github.com/nimiplatform/nimi)
- Discord: [discord.gg/BQwHJvPn](https://discord.gg/BQwHJvPn)
- Working entity: Nimi Network Limited

## License

Nimi is multi-licensed by component: runtime, SDK, and Proto under Apache-2.0; apps and Kit under MIT; docs under CC-BY-4.0. Canonical license texts live in [licenses/](licenses/) and the full map is in [LICENSE](LICENSE).
