# Template Market Contract — FG-TPL-*

> Deferred world-template extension for future Forge iterations.

**Status: non-blocking extension — out of current execution scope.**

## FG-TPL-001: Scope

Forge may eventually support:
- exporting a published world as a reusable template
- browsing templates from other creators
- forking a template into a new world draft
- optional monetization around template reuse

These capabilities are not part of the current Forge delivery scope.

## FG-TPL-002: Current Boundary

- No `world-templates` backend module is required in the current plan
- No template marketplace API is required by the current `api-surface.yaml`
- `/templates`, `/templates/mine`, and `/templates/:templateId` remain placeholder routes only
- World CREATE and MAINTAIN continue to inherit from `FG-WORLD-*` and referenced `WS-*` contracts without template-specific backend work

## FG-TPL-003: Future Design Gate

If template work is revived later, it must be redesigned from the existing world semantics first:
- published world vs world draft boundaries
- World-Studio snapshot vocabulary
- fork behavior into Forge CREATE pipeline
- whether marketplace, pricing, and ratings belong in the same scope

The prior marketplace-first backend design is retired and must not be treated as an active implementation target.
