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

## Surfaces Documented As Contract

The following surfaces are documented at the contract level. Their
read paths describe what the surface is, what it owns, and how it
relates to the rest of the platform.

| Surface | Read path | What it documents |
| --- | --- | --- |
| Platform | [Platform](/platform/) | The world model, six protocol primitives, authority rules |
| Runtime | [Runtime](/runtime/) | AI execution, workflows, streaming, multimodal, provider routing |
| SDK | [SDK](/sdk/) | The app-facing access boundary |
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

- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/bootstrap-state.yaml)
- [`.nimi/spec/platform/kernel/web-release-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/web-release-contract.md)
- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/package.json)
- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
