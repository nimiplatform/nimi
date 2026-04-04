# ParentOS nimi-kit Reuse Audit

Date: 2026-04-03
Scope: `apps/parentos` Phase 1 closeout

## Conclusion

ParentOS Phase 1 does not adopt `@nimiplatform/nimi-kit/ui` or `@nimiplatform/nimi-kit/features/chat` in the current implementation pass.

This is an explicit product-and-architecture decision, not an accidental omission.

## Inputs Reviewed

- `D:\nimi-realm\nimi\AGENTS.md`
- `D:\nimi-realm\nimi\apps\parentos\AGENTS.md`
- `D:\nimi-realm\nimi\kit\README.md`
- `D:\nimi-realm\nimi\kit\features\chat\README.md`
- `D:\nimi-realm\nimi\spec\platform\kernel\tables\nimi-kit-registry.yaml`

## Reuse Decision

### `kit.ui`

Not reused for ParentOS timeline, profile, journal, or settings shells.

Reason:
- These screens are already app-local and stable.
- Their interaction model is ParentOS-specific rather than cross-app generic.
- Refactoring them into kit primitives in this pass would create churn without reducing a current duplication problem across multiple apps.

### `kit.features.chat`

Not reused for ParentOS advisor in Phase 1.

Reason:
- ParentOS advisor persists messages in local SQLite through app-owned typed bridges.
- ParentOS advisor must gate runtime free generation by `reviewed` vs `needs-review` domains.
- ParentOS advisor must append structured fallback facts and source labels when runtime generation is disallowed.
- Those boundaries are app-specific policy and persistence concerns outside the current generic kit chat surface.

## Phase 1 Expectation

ParentOS keeps app-local shells for:
- timeline
- profile
- journal
- settings
- advisor

This does not block future kit admission. If a ParentOS-specific shell later proves reusable across at least two apps, it can be proposed separately for `nimi-kit`.
