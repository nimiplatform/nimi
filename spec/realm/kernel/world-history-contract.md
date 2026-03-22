# World History Contract

> Domain: world-history
> Rule family: R

## Scope

This contract defines canonical happened-fact storage for `nimi` Realm open spec.

## R-WHIST-001

World History stores canonical happened facts only. It does not store arbitrary story traces, raw turn logs, or app-private archives.

## R-WHIST-002

History append is explicit. No app may rely on automatic story-stop persistence to convert runtime output into canonical world history.

## R-WHIST-003

Each history event must carry typed provenance: `appId`, `sessionId`, `actorRefs`, `reason`, `evidenceRefs`, and the related truth/state anchors that justify the append.

## R-WHIST-004

`REPLAY` and `PRIVATE_CONTINUITY` app runs must not append shared world history. Only `CANON_MUTATION` rows explicitly authorized by the commit authorization matrix may do so.

## R-WHIST-005

World History is append-only. Corrections are modeled by superseding events or explicit invalidation records, never by silent hard deletion.

## R-WHIST-006

If an app needs its own narrative archive, that archive must be app-owned and must not be represented as Realm canonical world history.
