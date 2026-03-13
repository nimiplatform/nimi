# Analytics Contract — FG-ANA-*

> Deferred creator analytics extension for future Forge iterations.

**Status: non-blocking extension — out of current execution scope.**

## FG-ANA-001: Scope

Forge may eventually include creator analytics views such as:
- KPI overview
- funnel analysis
- retention cohorts
- content heatmaps

These are not part of the current Forge delivery scope.

## FG-ANA-002: Current Boundary

- No analytics controller or aggregation job is required in the current plan
- No analytics endpoint is required by the current `api-surface.yaml`
- `/analytics` remains a placeholder route only
- Advisor features may still use runtime AI and existing world/revenue inputs without introducing a standalone analytics backend

## FG-ANA-003: Future Design Gate

If analytics work is revived later, it must be approved as a separate module with:
- a concrete data source inventory
- explicit freshness and aggregation requirements
- a scoped set of views rather than a blanket dashboard commitment

The prior four-endpoint analytics backend design is retired and must not be treated as an active implementation target.
