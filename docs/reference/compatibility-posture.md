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

The methodology's `forbidden_shortcuts` catalog enumerates the patterns
public docs and implementation refuse:

| Key | Refused pattern |
| --- | --- |
| `legacy_alias` | Keeping obsolete semantics alive via soft alias |
| `compat_shim` | Hiding owner-cut gaps behind temporary compatibility code |
| `dual_read` | Two parallel truth read paths without explicit admission |
| `dual_write` | Two parallel truth write paths without explicit admission |
| `mvp_subset_contract` | Cutting canonical contract truth into a temporary minimum subset |
| `time_phased_layering` | Replacing semantic layering with time-sliced (v1/v2/v3) layering |
| `placeholder_success` | Faking success or closure when required truth is missing |
| `happy_path_only_closure` | Claiming closure when only the happy path is closed |
| `app_local_shadow_truth` | App-local convenience state becoming hidden canonical truth |
| `silent_owner_cut_reopen` | Reopening owner-domain truth inside a downstream execution wave |

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

- [`.nimi/spec/platform/protocol.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/protocol.md)
- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/kernel/protocol-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/protocol-contract.md)
- [`.nimi/spec/platform/kernel/web-release-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/web-release-contract.md)
- [`.nimi/spec/runtime/kernel/cli-onboarding-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/cli-onboarding-contract.md)
- [`.nimi/spec/runtime/kernel/model-catalog-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/model-catalog-contract.md)
- [`.nimi/spec/runtime/kernel/provider-health-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/provider-health-contract.md)
- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
