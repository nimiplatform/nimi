# Installation And Availability

Nimi has more than one public surface. The Nimi platform docs are
still primarily product and architecture docs; they do not provide a
single end-user install command for the whole platform. Nimi Coding is
the exception: it is available as the npm package
`@nimiplatform/nimi-coding`.

## What To Read Instead

These docs intentionally invest in the product model first. For the
platform surfaces, start with the architecture pages:

- [Platform](/platform/) explains the world model and the protocol
  primitives.
- [Runtime](/runtime/) explains the AI execution substrate and what it
  owns.
- [SDK](/sdk/) explains the supported app-facing boundary.
- [Desktop](/desktop/) explains the native shell and how it differs
  from Web.
- [Nimi Coding](/nimicoding/) explains the governance workflow used to
  bring high-risk changes through review.

If you want to adopt Nimi Coding in another project, use
[Nimi Coding Installation](/nimicoding/installation).

If you are tracking the project's readiness, the [Spec Map](/reference/spec-map)
is the most direct way to see which authority surfaces are present and
which still need admitted evidence.

## Source Basis

- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/bootstrap-state.yaml)
- [`.nimi/spec/platform/kernel/web-release-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/web-release-contract.md)
- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`nimi-coding/package.json`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/package.json)
