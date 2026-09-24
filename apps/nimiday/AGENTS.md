# NimiDay App Instructions

## Scope
- `apps/nimiday/**` is a Nimi root-workspace App. Root AGENTS.md, dependency installation, lockfile and Nimi-coding guidance apply.
- Product code lives in `src/nimiday/`. Electron and renderer startup code is maintained in this repository, not by an independent scaffold sync.

## Boundaries
- Keep the existing App ID and Desktop-supervised registration; repository ownership grants no additional App Access.
- Runtime owns LocalAgent identity, execution and Conversation; Cognition owns canonical long-term Memory. This App owns its business state, methods and tool implementations.
- Use public SDK/Kit interfaces. Preserve the session-invalidation boundary and reject effects from a stopped or obsolete scope.
- Use workspace dependencies and the root pnpm lockfile. Do not add a nested workspace, lockfile, lifecycle-skill copy or independent release workflow.

## Verification
- From the repository root, run `pnpm --filter @nimiplatform/nimiday typecheck` and `pnpm --filter @nimiplatform/nimiday test` for affected behavior.
- Run `build` for integration changes; the supervised launcher runs `build:electron` against prepared workspace surfaces.
- Resume an existing registration for real acceptance and use its exact development CDP target. Source checks do not certify an installed package.
