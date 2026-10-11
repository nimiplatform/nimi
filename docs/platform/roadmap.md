# Product Roadmap & Architectural Direction

Nimi integrates local and cloud AI compute, interactive apps, and deeply realized AI characters into a unified personal product. Check [Download Status](https://nimi.ai/download) for client availability and [Development Setup](/start/install) for source toolchains.

## Building on Current Stable Interfaces

Current development interfaces establish clean separation between App AIConfig, local inference engine loadouts, protected application sessions, and Runtime execution. Agent conversations leverage Runtime-managed context continuity alongside optional Cognition long-term memory; Knowledge V1 currently has no active public interface.

Application development, local package import, verified catalog distribution, and public general release represent distinct stages. See [Application Development & Distribution](/start/#local-development-and-distribution) for prerequisites and current platform boundaries. Local compilation success alone does not equate to public release readiness.

## Forward-Looking Platform Capabilities

General workflow orchestration (Workflow), autonomous world evolution, distributed compute federation, marketplace settlement, and experimental protocol adapters do not become usable APIs simply by being mentioned in architectural roadmaps. Their deferred rollout does not block active stable capabilities, nor does an architectural mention imply a committed delivery timeline or automated activation.

When designing features, build against current typed interfaces in the [SDK](/sdk/). If a required capability or backend combination is not yet supported, handle typed refusals gracefully and track future releases before relying on them.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/governance-release.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/governance-release.authority.yaml)
