# Library Contract - MM-LIB-*

> Local shelf behavior for saved story openings.

## MM-LIB-001: Local-First Shelf

Saved story openings are local-first by default.

The shelf is a lightweight memory surface for the user's preserved moments, not a shared canonical store.

## MM-LIB-002: Preservation Scope

Saving a story opening must preserve the app-owned fields defined in `tables/moment-model.yaml`, including:

- the opening card
- source type
- continuation timeline

## MM-LIB-003: Shelf, Not Dashboard

The library is a memory shelf.

It must not behave like:

- a metrics page
- a creator control plane
- a management dashboard

## MM-LIB-004: Reopen As Preserved Threshold

Reopening a saved story opening should feel like returning to a preserved instant rather than reopening an editable project.

## MM-LIB-005: App-Private Archive Boundary

Saved story openings are app-private continuity artifacts.

They must not be represented in this spec as Realm canonical world history, durable shared world state, or canonical truth.
