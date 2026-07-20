# Nimi Coding Contract Reference

Nimi Coding 0.3.x contracts define spec construction, authority placement,
managed projections, and deterministic validation. They do not define AI-host
task or execution records.

## Surface Taxonomy

Path: `.nimi/contracts/surface-taxonomy.schema.yaml`

Every candidate file receives one class, owner kind, authority rank, tracking
policy, mutability rule, and fail-closed cases. Product authority, thin
guidance, generated views, local evidence, package methodology, and managed
projections remain distinct classes.

## Placement Contract

Path: `.nimi/contracts/placement-contract.schema.yaml`

Placement binds each governed root to allowed classes, owners, tracking
policies, admissions, and validator scopes. Unknown roots and non-product
state under `.nimi/spec/**` fail closed.

## Domain Admission

Path: `.nimi/contracts/domain-admission.schema.yaml`

Every product domain names its root, authority class, owner, allowed and
forbidden classes, validation commands, and unadmitted migration disposition.
Directory presence alone does not admit a product domain.

## Table Families

Path: `.nimi/contracts/table-family.schema.yaml`

Every kernel table declares a supported semantic family. Product authority
tables and support registries have separate shapes, and operational status or
audit coverage fields are forbidden in both.

## Projection Edges

Path: `.nimi/contracts/projection-edge.schema.yaml`

One-way projection edges declare source and target classes, owners, allowed
and forbidden fields, and deterministic drift checks. A projection target
never gains more authority than its source.

## Host Spec Layout

Path: `.nimi/contracts/spec-layout.schema.yaml`

The host may admit instruction paths, tracked derived projections, and
table-family extensions as validation data. Layout admission does not grant
product authority.

## Spec Generation Inputs And Audit

Paths:

- `.nimi/contracts/spec-generation-inputs.schema.yaml`
- `.nimi/contracts/spec-generation-audit.schema.yaml`

Inputs are class-filtered before construction. The local generation audit maps
each canonical file to source references, source basis, coverage status, and
unresolved items. It belongs under
`.nimi/local/state/spec-generation/**`, never under `.nimi/spec/**`.

## Migration Inventory

Path: `.nimi/contracts/migration-inventory.schema.yaml`

Migration groups are descriptive and non-mutating. Semantic forks, owner
ambiguity, package-boundary ambiguity, and destructive deletion remain
explicit confirmations rather than executable work state.

## Source Basis

- [`.nimi/contracts/surface-taxonomy.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/surface-taxonomy.schema.yaml)
- [`.nimi/contracts/placement-contract.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/placement-contract.schema.yaml)
- [`.nimi/contracts/domain-admission.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/domain-admission.schema.yaml)
- [`.nimi/contracts/table-family.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/table-family.schema.yaml)
- [`.nimi/contracts/projection-edge.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/projection-edge.schema.yaml)
- [`.nimi/contracts/spec-layout.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-layout.schema.yaml)
- [`.nimi/contracts/spec-generation-inputs.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-generation-inputs.schema.yaml)
- [`.nimi/contracts/spec-generation-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/spec-generation-audit.schema.yaml)
