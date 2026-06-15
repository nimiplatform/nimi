# Realm Spec Guidance

## Scope

- Applies to `.nimi/spec/realm/**`.

## Reading Path

- Realm kernel index: `.nimi/spec/realm/kernel/index.md`
- Realm projection authority:
  `.nimi/spec/realm/kernel/projection-contract.md`
- Realm projection table:
  `.nimi/spec/realm/kernel/tables/projection-contract.yaml`
- Delegated projection admission:
  `.nimi/spec/platform/kernel/tables/delegated-projection-admissions.yaml`
- Projection guard implementation: `scripts/check-realm-spec-projection-guard.mjs`

## Editing Route

- For Realm projection changes, follow the projection authority and delegated
  admission above.
- Keep this file as navigation guidance; product rules live in kernel authority
  files and typed tables.
