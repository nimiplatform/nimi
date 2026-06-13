# Realm Spec Projection Rules

## Scope

- Applies to `.nimi/spec/realm/**`.

## Authority

- In this repository, `.nimi/spec/realm/**` is a public projection surface for
  Realm contracts.
- Do not edit projected Realm spec files as implementation authority.
- Projection updates must arrive with external verification proof accepted by
  the public repository projection guard.

## Required Workflow

- Realm projection changes must be generated from the admitted external
  projection pipeline, not hand-edited in the public projection subtree.
- Run the projection sync/check commands from that pipeline before committing
  public projection changes.
- `NIMI_ALLOW_REALM_SPEC_PROJECTION_SYNC=1` only acknowledges a verified Realm
  projection update. It is not a general force switch.
