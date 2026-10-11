# Architecture Invariants and Integration Anti-Patterns

When building Nimi applications or integrating platform capabilities, understanding architectural invariants and avoiding common anti-patterns is vital for robust software design. This guide contrasts common misconceptions with recommended verification practices.

## Common Anti-Patterns vs. Recommended Practices

| Misconception | Architectural Invariant & Recommended Practice |
| --- | --- |
| **Assuming that downloaded model weights imply instant AI readiness** | Model files are static disk assets; they must be bound into a Loadout, designated as the capability default, and validated against local driver readiness before inference can run. |
| **Assuming that connecting a cloud provider enables every capability** | Concrete operational support depends on the implemented capability driver dialect and the provider's feature matrix within Runtime. |
| **Assuming that receiving a completion event implies durable persistence** | Progress events provide immediate UI feedback; durable project persistence requires fetching final artifacts via `Get` endpoints and saving them to app storage. |
| **Assuming that Developer Mode disables security checks** | Developer Mode simplifies local sandbox onboarding; cryptographic signature verification and session scoping remain strictly enforced. |
| **Assuming that switching apps automatically merges all private memories** | Each LocalAgent maintains an isolated cognitive sandbox; memories are retrieved contextually within authorized sessions of that specific agent. |
| **Assuming that installing the SDK exposes internal unexported surfaces** | The platform enforces strict visibility boundaries; client apps consume exported public APIs, while internal transports remain sandboxed. |

## Actionable Structured Feedback

When encountering structured non-success codes (e.g., `unavailable`, `permission-required`, `blocked`):
- **Provide Actionable Prompts**: Surface the underlying cause directly to users, offering direct paths to resolution (such as requesting permissions or starting Runtime).
- **Avoid Silent Synthesized Fallbacks**: Refrain from silently substituting unconfigured models or simulating pseudo-success, maintaining high system determinism and transparency.

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/governance-release.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/governance-release.authority.yaml)
