# Design Pattern

> Domain: Platform / Design Pattern

## 0. Normative Imports

- `P-DESIGN-001`, `P-DESIGN-002`, `P-DESIGN-003`, `P-DESIGN-004`, `P-DESIGN-005`, `P-DESIGN-006`, `P-DESIGN-007`, `P-DESIGN-008` from `kernel/design-pattern-contract.md`
- `P-DESIGN-010`, `P-DESIGN-011`, `P-DESIGN-012`, `P-DESIGN-013`, `P-DESIGN-014`, `P-DESIGN-015`, `P-DESIGN-019` from `kernel/design-pattern-contract.md`
- `P-DESIGN-020`, `P-DESIGN-021`, `P-DESIGN-090` from `kernel/design-pattern-contract.md`
- `P-GOV-*` from `kernel/governance-contract.md`

## 1. Purpose

Nimi Design Pattern defines the shared design foundation and external consumer contract for `@nimiplatform/nimi-kit/ui`.
It is the only normative source for:

- semantic design tokens
- shared primitive families
- theme scheme delivery
- consumer manifest schema and hard gates

## 2. Model

- Shared foundation: one cross-app spec and one shared lib, `@nimiplatform/nimi-kit/ui`
- Foundation schemes: `nimi-light`, `nimi-dark`
- Shared accent pack: `nimi-accent`
- Consumer accent packs: defined by each consuming app's local spec manifest and projected into kit output without becoming platform design authority
- Controlled exceptions: app-local manifests only; platform design authority does not carry concrete app exception inventories

## 3. Authority Split

- `.nimi/spec/platform/kernel/design-pattern-contract.md` owns the normative design contract.
- App-local specs own concrete kit adoption inventories, retained app-owned compositions, and product art direction, but they must reference `P-DESIGN-*` and must not redefine shared primitives.
- App implementation must consume the generated shared lib projection and pass `pnpm check:nimi-ui-pattern`.
