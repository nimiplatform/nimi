# Realm Spec Projection Rules

## Scope

- Applies to `.nimi/spec/realm/**`.

## Authority

- In `this repository`, `.nimi/spec/realm/**` is a public projection surface.
  Do not edit this subtree as implementation authority.
- Projection updates must arrive with an external verification proof accepted by
  the repository projection guard.

## Required Workflow

- Treat `.nimi/spec/realm/**` changes as projection updates only.
- Run `pnpm check:realm-spec-projection-guard` before committing any projection
  update.
- `NIMI_ALLOW_REALM_SPEC_PROJECTION_SYNC=1` acknowledges a verified projection
  update. It is not a general force switch.
