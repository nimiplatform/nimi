# Design Pattern

> Domain: Platform / Design Pattern

## 0. Normative Imports

- `P-DESIGN-001`, `P-DESIGN-002`, `P-DESIGN-003`, `P-DESIGN-004`, `P-DESIGN-005`, `P-DESIGN-006`, `P-DESIGN-007`, `P-DESIGN-008` from `kernel/design-pattern-contract.md`
- `P-DESIGN-010`, `P-DESIGN-011`, `P-DESIGN-012`, `P-DESIGN-013`, `P-DESIGN-014`, `P-DESIGN-015`, `P-DESIGN-019` from `kernel/design-pattern-contract.md`
- `P-DESIGN-020`, `P-DESIGN-021`, `P-DESIGN-090` from `kernel/design-pattern-contract.md`
- `P-GOV-*` from `kernel/governance-contract.md`

## 1. Purpose

Nimi Design Pattern defines the shared design foundation for `desktop`, `forge`, `relay`, and `overtone`.
It is the only normative source for:

- semantic design tokens
- shared primitive families
- theme scheme delivery
- adoption registry and hard gates

## 2. Model

- Shared foundation: one cross-app spec and one shared lib, `@nimiplatform/nimi-kit/ui`
- Foundation schemes: `nimi-light`, `nimi-dark`
- Accent packs: `desktop-accent`, `forge-accent`, `relay-accent`, `overtone-accent`
- Controlled exceptions: `desktop world-detail` and Overtone waveform / transport visualization

## 3. Authority Split

- `spec/platform/kernel/design-pattern-contract.md` owns the normative design contract.
- App-local design docs may describe art direction and narrative expression, but they must reference `P-DESIGN-*` and must not redefine shared primitives.
- App implementation must consume the generated shared lib projection and pass `pnpm check:nimi-ui-pattern`.
