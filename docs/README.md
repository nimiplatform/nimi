# Nimi Docs

Public developer documentation for building apps, integrations, and desktop extensions on Nimi.

Nimi is an open-source AI runtime for apps. It gives developers one runtime and one SDK for local and cloud AI, instead of stitching together separate model SDKs, local runners, streaming glue, and operational scripts.

## Fastest Path

```bash
nimi start
nimi run "What is Nimi?"
nimi run "What is Nimi?" --provider gemini
```

The first command starts the runtime. The second proves the local path. The third proves the one-shot cloud path.

For public onboarding, stay on `nimi run` and `runtime.generate()/stream()`. Advanced explicit model ids belong to lower-level surfaces such as `nimi ai text-generate --model-id ...` and `runtime.ai.text.generate({ model: ... })`.

## Start Here

- [Getting Started](./getting-started/index.md): install Nimi, start the runtime, and run the first end-to-end flow
- [App Developer Guide](./guides/app-developer.md): integrate Nimi into an application
- [Runtime Integrator Guide](./guides/runtime-integrator.md): work directly with the runtime and operational surface
- [Mod Developer Guide](./guides/mod-developer.md): build desktop extensions for the Nimi host
- [Mod Release Guide](./guides/mod-release.md): release official mods and process third-party catalog submissions
- [Mod Release Guide (CN)](./guides/mod-release_cn.md): 中文版 mod 发布与第三方申请处理指南
- [Quick Recipes](./cookbook/quick-recipes.md): copyable patterns and runnable building blocks

## What This Portal Explains

- How to use Nimi as an application-facing AI runtime
- How the SDK, runtime, examples, and desktop host fit together
- Practical integration paths for app developers, runtime integrators, and mod builders
- Reference material for SDK, runtime, protocol, providers, compatibility, and errors

## What Makes Nimi Worth Looking At

- One execution surface for local and cloud models
- A real runtime, not just a provider wrapper
- Streaming, health, model lifecycle, and operational tooling in the same system
- A path from SDK integration to desktop-hosted AI experiences

## Where To Go Deeper

- [SDK Reference](./reference/sdk.md)
- [Runtime Reference](./reference/runtime.md)
- [Provider Matrix](./reference/provider-matrix.md)
- [Compatibility Matrix](./reference/compatibility-matrix.md)
- [Architecture Overview](./architecture/index.md)
- [Spec Map](./architecture/spec-map.md)

## Normative Source Of Truth

This portal explains how to use Nimi. Normative contracts live in [`spec/`](../spec/).

- Human-readable generated spec entry: [`spec/generated/nimi-spec.md`](../spec/generated/nimi-spec.md)
- Runnable samples live in [`examples/`](../examples/)
- Internal plans, reports, and audit artifacts do not belong in this portal
