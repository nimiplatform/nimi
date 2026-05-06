# Nimi Coding Installation

This page explains how to think about Nimi Coding availability in this
repository. It doesn't present a public package distribution promise.

## Current Usage Model

Inside this repository, Nimi Coding commands are available through the
local workspace tooling. Topic workflows, validation, packet handling,
runner steps, and closeout operations are executed as repository-local
governance commands.

For public users, installation instructions need admitted distribution
evidence. Until that evidence is published, this page describes the
local-workspace posture rather than a general release channel.

## Reader Scenario: Why The Public Install Page Is Not Yet Here

Suppose a reader expects a one-line install command that gets them
Nimi Coding tooling outside this repository. The same logic that
applies to platform installation applies here:

- A public install command implies a packaged distribution.
- A public install command implies an authentication or configuration
  story.
- A public install command implies a verification path.
- A public install command implies a recovery path when something
  breaks.

Until each of those is admitted, a public install page would be an
optimistic onboarding promise the project cannot keep.

## What A Complete Public Installation Page Needs

A complete public page should include:

- supported package or binary source;
- supported host environments;
- authentication or configuration requirements;
- first command and expected output;
- validation command;
- failure recovery path.

Those details should be published only when the project can verify
them.

## Reader Scenario: Using Nimi Coding Inside This Repository

Suppose a contributor is working inside this repository and wants to
use Nimi Coding for a high-risk change. The local-workspace posture
is enough for that use case:

- The local tooling is invoked through the in-repo command surface.
- Topic artifacts land under `.nimi/topics/<state>/<topic-id>/`.
- Validation, audit, and closeout operations rely on the repo-local
  contract files under `.nimi/contracts/` and methodology files under
  `.nimi/methodology/`.
- The CLI is described conceptually in the
  [CLI Reference](/nimicoding/cli-reference); concrete commands come
  from the local tooling rather than from these docs.

That posture is intentionally narrower than a public release. It is
what allows the methodology to be exercised in the repository without
making promises it cannot honor outside the repository.

## Source Basis

- [`.nimi/spec/product-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/product-scope.yaml)
- [`.nimi/spec/bootstrap-state.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/bootstrap-state.yaml)
- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
