# Nimi Docs

> **Rapid Development Phase** — Nimi is still moving extremely quickly.
> Runtime, SDK, and desktop flows are usable today, but contracts and APIs may tighten between releases. Use [`spec/`](https://github.com/nimiplatform/nimi/tree/main/spec) as the normative source of truth, and read `spec/future/` as backlog rather than a release promise.

Documentation for using, building with, and extending Nimi — the open-source AI runtime.

Nimi gives you one runtime and one SDK for local and cloud AI, instead of stitching together separate model SDKs, local runners, streaming glue, and operational scripts.
For app entrypoints, prefer `createPlatformClient()` from `@nimiplatform/sdk`; drop to subpath packages only when you explicitly need lower-level control.

## Fastest Path

```bash
nimi start
nimi run "What is Nimi?"
nimi run "What is Nimi?" --provider gemini
```

The first command starts the runtime. The second proves the local path. The third proves the one-shot cloud path.

## By Role

### Users

Just want to use Nimi? No coding needed.

- [Quickstart](./user/index.md) — install, start, generate
- [Install](./user/install.md) — detailed installation guide
- [CLI Commands](./user/cli.md) — all `nimi` commands
- [Cloud Providers](./user/providers.md) — set up Gemini, OpenAI, and others
- [Models](./user/models.md) — manage local models
- [Desktop App](./user/desktop.md) — graphical AI experience
- [Troubleshooting](./user/troubleshooting.md) — fix common issues
- [FAQ](./user/faq.md) — frequently asked questions

### App Developers

Building an app that integrates Nimi?

- [Overview](./app-dev/index.md) — what Nimi offers app developers
- [SDK Setup](./app-dev/sdk-setup.md) — install the SDK and run first example
- [App Developer Guide](./app-dev/guide.md) — integration patterns and scaffold
- [Recipes](./app-dev/recipes.md) — runnable building blocks
- [Production Checklist](./app-dev/production-checklist.md) — ship with confidence

### Mod Developers

Building extensions for the Nimi desktop app?

- [Overview](./mod-dev/index.md) — what a mod is and how it works
- [Development Guide](./mod-dev/guide.md) — full development workflow
- [Release & Submission](./mod-dev/release.md) — publishing and catalog listing

### Other

- [Runtime Integrator Guide](./guides/runtime-integrator.md) — embed the runtime daemon in a host app

## Reference

- [SDK Reference](./reference/sdk.md)
- [Runtime Reference](./reference/runtime.md)
- [Protocol Reference](./reference/protocol.md)
- [Error Codes](./reference/error-codes.md)
- [Provider Matrix](./reference/provider-matrix.md)
- [Compatibility Matrix](./reference/compatibility-matrix.md)

## Architecture

- [Architecture Overview](./architecture/index.md)
- [Agent Companion Core Protocol](./architecture/agent-companion-core-protocol.md)
- [Agent Companion Design Memory Register](./architecture/agent-companion-design-memory-register.md)
- [Agent Companion Design Corpus Preservation](./architecture/agent-companion-design-corpus-preservation.md)
- [Live2D Companion Architecture](./architecture/live2d-companion.md)
- [Spec Map](./architecture/spec-map.md)

## Normative Source Of Truth

This portal explains how to use Nimi. Normative contracts live in [`spec/`](https://github.com/nimiplatform/nimi/tree/main/spec).

- Human-readable generated spec entry: [`spec/generated/nimi-spec.md`](https://github.com/nimiplatform/nimi/blob/main/spec/generated/nimi-spec.md)
- Runnable samples live in [`examples/`](https://github.com/nimiplatform/nimi/tree/main/examples)
- Internal plans, reports, and audit artifacts do not belong in this portal
