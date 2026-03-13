# Copyright Contract — FG-IP-*

> Deferred copyright extension for future Forge iterations.

**Status: non-blocking extension — out of current execution scope.**

## FG-IP-001: Scope

Forge may eventually offer creator-facing copyright workflows such as:
- registration of original works
- license assignment
- attribution tracking
- infringement reporting

These capabilities are not part of the current Forge delivery scope and must not drive backend/API work in the current plan.

## FG-IP-002: Current Boundary

- No dedicated copyright backend module is required for current Forge execution
- No copyright Prisma schema is defined by this contract
- No copyright REST API is required by the current `api-surface.yaml`
- The `/copyright` route remains a placeholder page only

## FG-IP-003: Future Design Gate

If copyright work is revived later, it must be redesigned as an explicit platform extension with:
- a narrow problem statement
- a minimal backend/API proposal
- a clear relation to existing realm content entities
- an explicit product decision on whether it is launch-blocking or optional

The prior full-domain design is retired and must not be treated as an active implementation target.
