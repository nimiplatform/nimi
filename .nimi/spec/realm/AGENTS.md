# Realm Spec Projection Rules

## Scope

- Applies to `.nimi/spec/realm/**`.

## Authority

- In `~/nimi-realm`, `.nimi/spec/realm/**` is the parent Realm spec authority.
- In `~/nimi-realm/nimi`, `.nimi/spec/realm/**` is a projection from the parent
  repo. Do not edit the nested projection as source authority.

## Required Workflow

- To change Realm spec authority:
  1. edit `~/nimi-realm/.nimi/spec/realm/**`;
  2. run `pnpm spec:realm:generate`;
  3. run `pnpm spec:realm:sync:nimi`;
  4. run `pnpm spec:realm:check:nimi-sync`.
- In nested `nimi`, `NIMI_ALLOW_REALM_SPEC_PROJECTION_SYNC=1` may only bypass
  the local projection-diff guard for commits produced by parent root sync after
  the root gate has passed. It is not a general force switch.
