# Spec Map

A spec-side map for tracing a public claim back to its source
authority and for navigating the spec directly.

## Public Sections And Source Areas

| Public section | Main source area |
| --- | --- |
| Platform | `.nimi/spec/platform/**` |
| Runtime | `.nimi/spec/runtime/**` |
| SDK | `.nimi/spec/sdks/**` |
| Desktop and Web | `.nimi/spec/desktop/**` |
| Realm | External Realm authority, local pointer docs in `docs/spec/realm-readme.md` and `docs/spec/realm-external-anchor.md`, and Nimi consumer contracts under `.nimi/spec/sdks/**` |
| Avatar | `.nimi/spec/avatar/**` |
| Cognition | `.nimi/spec/cognition/**` |
| Nimi Coding | `nimi-coding/spec/product-scope.yaml`, `nimi-coding/spec/_meta/spec-tree-model.yaml`, `nimi-coding/methodology/**`, `nimi-coding/contracts/**`, `nimi-coding/config/**` |

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

- Start at `docs/spec/INDEX.md` if you need cross-domain task-shaped
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

Private implementation workspaces are not described by public docs topology.
Realm-facing public docs may reference only admitted public projection surfaces;
they must not expose private repository layout, source checkout shape, or
implementation-owner paths.

## Source Basis

- [`docs/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/INDEX.md)
- `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope spec-human-doc`
