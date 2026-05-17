# Spec Map

A spec-side map for tracing a public claim back to its source
authority and for navigating the spec directly.

## Public Sections And Source Areas

| Public section | Main source area |
| --- | --- |
| Platform | `.nimi/spec/platform/**` |
| Runtime | `.nimi/spec/runtime/**` |
| SDK | `.nimi/spec/sdk/**` |
| Desktop and Web | `.nimi/spec/desktop/**` |
| Realm | `.nimi/spec/realm/**` |
| Avatar | `.nimi/spec/avatar/**` |
| Cognition | `.nimi/spec/cognition/**` |
| Nimi Coding | `nimi-coding/spec/product-scope.yaml`, `nimi-coding/spec/bootstrap-state.yaml`, `nimi-coding/methodology/**`, `nimi-coding/contracts/**` |

The spec is organized in a kernel + domain layout. Kernel directories
are the single source of truth; domain files are reading aids and
must not redefine kernel rules.

## Rule ID Families

The kernel uses domain-prefixed rule identifiers. A reader who sees a
rule citation can locate the owning kernel without guessing:

| Prefix | Owner |
| --- | --- |
| `P-*` | Platform |
| `K-*` | Runtime |
| `S-*` | SDK |
| `D-*` | Desktop |
| `R-*` | Realm |
| `F-*` | Reserved/historical future backlog anchors outside active spec authority |

Within Runtime, sub-families like `K-WF-*` (workflow), `K-STREAM-*`
(streaming), `K-MMPROV-*` (multimodal provider), `K-DELEG-*`
(delegated capability), and `K-AGCORE-*` (agent participation)
identify which contract a rule belongs to.

## Reading Tips

- Start at `.nimi/spec/INDEX.md` if you need cross-domain task-shaped
  reading paths.
- Start at the relevant kernel `index.md` if you know which domain
  you need.
- The kernel's `tables/` directories are structured fact sources for
  enumerations (states, error codes, capabilities); when public docs
  abstract a list, the table is the literal answer.
- Generated spec views are rendered on demand by
  `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope <scope>`.
  They are stdout artifacts, not tracked `.nimi/spec/**` files.

## Generated And Private Surfaces

Generated docs, build output, dependency directories, and private
owner surfaces are not public docs authority. They can provide
evidence or implementation context, but they do not silently become
the source of public product truth.

Private repositories (for example, `nimi-realm/.nimi/spec/**` for
backend, dashboard, and creator-side authority, and
`nimi-mods/spec/**` for mods workspace authority) are referenced
from the public docs only by name, not by content. Those public
mentions are placement information; they do not promote private
authority into public docs.

## Source Basis

- [`.nimi/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/INDEX.md)
- `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope spec-human-doc`
