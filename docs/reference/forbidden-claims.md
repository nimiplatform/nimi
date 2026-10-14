# Architecture Invariants and Integration Anti-Patterns

Building reliable Nimi applications requires respecting subsystem boundaries and verifying readiness at each step. This page contrasts common integration misconceptions with the platform's actual invariants.

## Common Anti-Patterns vs. Architectural Invariants

| Misconception | Architectural Invariant & Recommended Practice |
| --- | --- |
| **Downloaded model weights mean AI is ready to run** | Model files on disk are only static assets. Before inference can run, weights must be bound into a Loadout, set as the capability default, and backed by a ready local driver. |
| **Connecting a cloud provider unlocks every capability** | Actual support depends on the capability driver dialect implemented in Runtime and that provider's supported feature matrix. |
| **A completion event means data is durably saved** | Streamed events provide immediate UI progress. An AI Job result does not prove an App draft was saved. Retrieve the result through the operation’s supported result API and confirm that the App’s own save completed. |
| **Developer Mode turns off security checks** | Developer Mode streamlines local onboarding and self-signed testing, but session scoping and cryptographic verification remain active. |
| **Switching apps merges an agent's private memories** | Each LocalAgent has an isolated memory space in Cognition, accessed through Runtime only within authorized sessions for that agent. |
| **Installing the SDK exposes internal platform transports** | Visibility boundaries are strictly enforced. Apps can only call exported, admitted SDK operations; internal transports remain isolated. |

## Handling Structured Non-Success Codes

When the platform returns structured non-success codes (such as unavailable, missing access, or blocked states):
- **Surface Actionable Guidance**: Explain the specific cause to the user and point to the real fix—such as starting Runtime, configuring a model Loadout, or running within a protected host session.
- **Never Fake a Fallback**: Do not silently swap in unrelated models or fabricate success responses. Keep failure states explicit and deterministic.

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/governance-release.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/governance-release.authority.yaml)
