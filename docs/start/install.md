# Installation And Availability

Nimi has multiple public surfaces. Each surface has its own
distribution channel, and the public docs only describe a surface as
installable when its release evidence has been admitted under the
matching authority contract.

## Installable Today

### Nimi Coding

Nimi Coding is admitted as a host-agnostic methodology and is
distributed as the npm package
[`@nimiplatform/nimi-coding`](https://www.npmjs.com/package/@nimiplatform/nimi-coding).

For the install command, project bootstrap layout, host adapter
selection, and adoption path, see
[Nimi Coding → Installation](/nimicoding/installation).

A minimal first-run path:

1. Add the package to a host project.
2. Run the bootstrap command described on the installation page.
3. Walk through
   [First Topic Bootstrap](/nimicoding/tutorials/first-topic) to
   confirm the methodology surface works end-to-end.

The package is host-agnostic, so the same install path applies under
any admitted AI host.

### Nimi App Tools

`@nimiplatform/app-tools` is the public app-authoring CLI for Nimi App
developer repositories.

```bash
pnpm dlx --package @nimiplatform/app-tools nimi-app create --profile standalone
```

For the full scaffold path, see [Create A Nimi App](/start/create-an-app).
The CLI creates scaffold inputs and local checks only. It does not create public
app admission, permission grants, registry visibility, release descriptors, or
installed-app update truth.

## Package Channel Matrix

| Package | npm install path | Source checkout path | Notes |
| --- | --- | --- | --- |
| `@nimiplatform/app-tools` | Public package with the `nimi-app` binary | `app-tools/` | Standalone scaffolds run it through `pnpm dlx --package`; workspace scaffolds may use `workspace:*`. |
| `@nimiplatform/kit` | Public package | `kit/` | Kit is not a Runtime substitute; apps use its published subpath exports only. |
| `@nimiplatform/sdk` | Public package for app consumers | `sdks/typescript/` private vNext workspace package | Generated standalone apps depend on the published SDK range from app-tools; repository development uses the workspace package. |

Do not assume a source checkout automatically opens every product release
channel. Use npm packages for standalone app repositories, and use `workspace:*`
only inside this monorepo or generated workspace-app scaffolds.

## Surfaces Documented As Contract

The following surfaces are documented at the contract level. Their
read paths describe what the surface is, what it owns, and how it
relates to the rest of the platform.

| Surface | Read path | What it documents |
| --- | --- | --- |
| Platform | [Platform](/platform/) | The world model, six protocol primitives, authority rules |
| Runtime | [Runtime](/runtime/) | AI execution, workflows, streaming, multimodal, provider routing |
| SDK | [SDK](/sdk/) and [First AI Call](/sdk/first-ai-call) | The app-facing access boundary and first Runtime-backed text generation path |
| App Tools | [Create A Nimi App](/start/create-an-app) | App authoring scaffold commands and local checks |
| Kit | [Platform Kit](/platform/kit/) | Shared UI, shell, auth, telemetry, model config, and feature modules |
| Tester / Nimi Lab | [Use Tester As A Reference App](/start/use-tester-as-reference) | Reference app scripts, Runtime auth, Kit, AIConfig, and fail-closed states |
| Desktop | [Desktop](/desktop/) | The native first-party shell |
| Web Mode | [Web Mode](/desktop/web-mode) | The constrained browser projection |
| Realm | [Realm](/realm/) | Semantic truth, world state, world history |
| Avatar | [Avatar](/avatar/) | Embodied agent presentation |
| Cognition | [Cognition](/cognition/) | Standalone memory, knowledge, prompt serving |

When a surface adds an install command, a download link, or a release
notes path, the corresponding section page is updated to expose it.

## Tracking Availability

The [Spec Map](/reference/spec-map) lists which authority surface a
public section traces to. The
[Compatibility Posture](/reference/compatibility-posture) page lists
the constraints that govern when a surface is allowed to publish
install or release information.

The [Forbidden Claims](/reference/forbidden-claims) page enumerates
the install-style and release-style strings that public docs refuse
to publish without admitted evidence.

## Source Basis

- [`nimi-coding/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/spec/product-scope.yaml)
- [`nimi-coding/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/spec/bootstrap-state.yaml)
- [`.nimi/spec/platform/kernel/web-release-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/web-release-contract.md)
- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`.nimi/spec/platform/kernel/nimi-app-scaffolding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/nimi-app-scaffolding-contract.md)
- [`app-tools/README.md`](https://github.com/nimiplatform/nimi/blob/main/app-tools/README.md)
- [`app-tools/lib/index.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/index.mjs)
- [`app-tools/lib/app-scaffold.mjs`](https://github.com/nimiplatform/nimi/blob/main/app-tools/lib/app-scaffold.mjs)
- [`kit/package.json`](https://github.com/nimiplatform/nimi/blob/main/kit/package.json)
- [`sdks/typescript/package.json`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/package.json)
- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi-coding/blob/main/package.json)
- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
