# Boundary Contract - MM-BND-*

> App/runtime/realm/mod ownership boundaries for Moment.

## MM-BND-001: App, Not Mod

Moment is an app-layer product under `apps/moment/`.

It is not:

- a desktop mod
- a mod host
- a mod browser
- a renamed mod shell

## MM-BND-002: Realm Truth Boundary

Moment may read upstream truth through approved typed surfaces when future integration requires it, but `MomentThreshold`, `MomentSession`, and `SavedMoment` are not Realm truth objects by default.

Moment must not claim ownership of canonical world truth or canonical agent truth.

## MM-BND-003: World State And History Boundary

Short-play story-opening output is private app output by default.

It must not silently become:

- shared world state
- canonical world history
- an implicit write into a creator-controlled world

Any future promotion into shared Realm data must be explicit, typed, authorized, and separately specified.

## MM-BND-004: Typed Integration Only

If Moment later connects to Runtime or Realm, it must do so through approved typed SDK surfaces.

This spec does not permit app-local raw REST path assembly, hidden fallback channels, or ad hoc contract bypasses.

## MM-BND-005: Neighboring Products Stay Neighboring

`scene-atlas`, `agent-capture`, `textplay`, `local-chat`, and `world-studio` are neighboring products.

They may become explicit upstream or downstream integrations later, but they must not erase Moment's own product identity.

## MM-BND-006: Internal Names Stay Out Of The Primary UX

Future system integrations may exist behind the product, but the primary user experience must remain self-contained.

The core front-door flow should not depend on exposing internal subsystem names to the user.
