# Compatibility Posture

Reference for the Nimi public docs' compatibility and migration posture.

## Posture Summary

| Property | Value |
| --- | --- |
| Posture name | `no_legacy_hard_cut` |
| Pre-launch | yes |
| Soft compatibility shims | forbidden |
| Time-phased layering | forbidden (layering is ontological: core / extended / custom) |
| Strict-only protocol versioning | yes |
| Fail-close on contract violation | yes |
| Retry rescues contract failure | no |

## Practical Implications For Readers

| Situation | Expected behavior |
| --- | --- |
| A page is removed | Preferred over a stale page |
| A typed contract fails | Surfaces a typed error, not a silent fallback |
| A retry happens | Only for transport / auth refresh, never to rescue a contract |
| An older route exists | Either kept as admitted public truth or hard-removed; not preserved as hidden compatibility |
| A new feature ships | Lands with full contract design, not as a temporary subset to be filled in later |

## Forbidden Compatibility Shapes

Repository authority rejects three broad shapes: retaining superseded product
semantics after a hard cut, creating an unadmitted parallel truth, and
returning pseudo-success when an admitted contract cannot be fulfilled.
Individual owner-domain contracts add narrower prohibitions where required;
there is no separate Nimi Coding anti-pattern catalog.

## Public Claim Constraints

| Claim type | Posture |
| --- | --- |
| Install commands (curl / npm / pnpm / brew / apt / yarn) | Withheld until admitted distribution evidence under the matching release contract |
| Download links | Withheld until admitted distribution evidence under the matching release contract |
| Release status / launch promises | Withheld until admitted release evidence |
| Concrete provider name / model name | Withheld until admitted catalog evidence under the runtime model-catalog contract |
| Provider availability matrix | Withheld until admitted catalog evidence under the runtime model-catalog contract |
| "Available now" / "GA" / "Stable" claims for defined-but-not-shipped surfaces | Forbidden |

The complete list of forbidden public docs claims with detection
patterns is in [Forbidden Claims](/reference/forbidden-claims).

## Contract Evolution Path

How a defined-but-not-shipped surface graduates to a public surface:

1. Kernel contract is admitted under the appropriate authority domain
   (`P-PROTO-*` / `K-*` / `S-*` / `D-*` / `R-*`).
2. Implementation lands under the owner domain.
3. Catalog evidence (for providers / models) is admitted.
4. Distribution / release evidence is admitted (for install / download).
5. Public docs page is updated to reflect availability.

A docs page cannot pre-announce a stage that the contract evolution
has not reached.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/governance-release.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/governance-release.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/platform/authority-admission.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/authority-admission.authority.yaml)
