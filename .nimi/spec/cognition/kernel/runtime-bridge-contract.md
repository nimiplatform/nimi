# Cognition Runtime Bridge Contract

> Owner Domain: `C-COG-*`

## C-COG-033 Runtime Bridge Registry

The authoritative runtime bridge registry is `tables/runtime-bridge-boundary.yaml`.

Fixed rules:

- every admitted runtime/cognition overlap concern must declare cognition owner, runtime owner, admitted bridge direction, and forbidden owner inversion
- bridge registry rows define coexistence boundaries, not implementation sharing permission by default
- runtime bridge registration must not collapse cognition and runtime into one owner surface
- runtime-facing republication of overlap semantics must point to
  `RuntimeCognitionService` plus explicit retained runtime-private depth rather
  than reviving `RuntimeMemoryService` / `RuntimeKnowledgeService` as
  co-equal steady-state owners

## C-COG-034 Overlap Upgrade And No-Downgrade Rule

Overlap with runtime memory or runtime knowledge is allowed only under explicit upgrade posture.

Fixed rules:

- standalone cognition must not become semantically weaker than runtime on overlapping claimed capability
- implementation shape differences are admitted only when semantic closure and fail-closed strength remain at least as strong
- reusing runtime terminology without matching semantic strength is not admitted as parity
- runtime-facing full replacement of memory/knowledge service topology does not
  transfer runtime-private review, provider, bank, or replication ownership
  into cognition

## C-COG-035 Runtime Independence Rule

Standalone cognition must remain viable without runtime presence.

Fixed rules:

- cognition build, test, mutation, retrieval, prompt serving, and cleanup semantics must remain valid without runtime being installed or linked in
- runtime-only lifecycle, replication, provider, or review truth must not become hidden prerequisites for standalone cognition correctness
- if an implementation requires runtime semantics to appear complete, that implementation is not admitted as completed cognition

## C-COG-036 Runtime Consumption Boundary

Runtime may consume standalone cognition only as a bridge/adapter consumer.

Fixed rules:

- runtime may adapt cognition artifacts or outputs into runtime-owned services only through explicit bridge logic
- runtime may republish overlap semantics through `RuntimeCognitionService`, but
  that republishing must not create a dual-owner or adapter-first steady state
- runtime must not treat cognition internal storage layout as runtime-owned truth
- runtime and cognition must not silently share one semantic owner database, backlog, or review lane
- cognition authority remains in cognition even when runtime is the current consumer
