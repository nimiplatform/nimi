# Runtime Memory Substrate Contract

> Owner Domain: `K-MEMSUB-*`

## K-MEMSUB-001 Authority Home

`RuntimeMemorySubstrate` is the runtime-private implementation contract that
binds retained runtime-private memory depth to any future admitted memory
provider.

It owns:

- the rule that runtime may project provider-backed memory through retained
  runtime-private memory depth and the absorbed `RuntimeCognitionService`
  memory family only when a future substrate is explicitly admitted
- runtime-owned overlay needed to preserve Nimi bank locator truth, embedding profile truth, and typed record identity above provider-native storage
- the rule that current extraction of runtime memory logic into internal runtime-owned libraries remains an overlay refactor rather than a provider admission event

It does not own:

- public memory RPC naming or public typed payload authority
- agent canonical memory semantics
- Realm replication authority
- local public engine target enumeration in `K-LENG-*`

## K-MEMSUB-002 Current Admission

No built-in runtime memory provider is currently admitted.

Fixed rules:

- runtime must not ship a default supervised or attached memory substrate path under `runtime/internal/**`
- runtime config must not advertise provider-specific memory bootstrap fields as active authority
- extracting runtime-owned memory logic into internal libraries or subpackages under the existing runtime module does not by itself admit a new provider, public engine identity, or public wire contract
- any future memory provider admission requires a later redesign under `.nimi/spec/runtime/kernel/**`

## K-MEMSUB-003 Runtime-Owned Overlay And Identity Binding

No provider owns Nimi locator truth or typed memory identity.

Fixed rules:

- runtime must preserve the authoritative mapping from scope-typed bank locator to provider `bank_id`
- runtime must preserve the authoritative embedding profile bound to each bank
- runtime must preserve authoritative typed record identity for retained
  runtime memory records, even when the provider stores only provider-native
  memory units
- if runtime internally normalizes locator identity through a typed-principal library model, the mapping must remain deterministic and compatibility-preserving with the admitted public locator family
- if a future provider returns a retained / recalled item that does not map back to an admitted runtime-owned bank or typed record identity, runtime must fail-close or explicitly suppress that item; it must not silently widen provider-native data into public truth

## K-MEMSUB-004 Feature Floor And Health Contract

If a future memory provider is admitted, it must expose a runtime-private feature floor sufficient for:

- bank lifecycle: list / create-or-update / get profile / delete
- memory operations: retain / recall / list memories / clear bank memories

Fixed rules:

- retained runtime-private memory depth may assume only this admitted feature
  floor; it must not depend on undocumented provider-native endpoints

## K-MEMSUB-005 Failure And Replay Semantics

Fixed rules:

- if no admitted memory provider is installed, provider-dependent memory operations must fail with `UNAVAILABLE`
- runtime must not use a substitute provider, shadow engine, or synthetic success path when no admitted memory provider exists
- when runtime-owned typed records are deleted or invalidated and the provider cannot perform an admitted per-record delete, runtime may rebuild provider state only through explicit runtime-owned replay from the surviving authoritative overlay
- replay must remain deterministic from runtime-owned bank + record truth; runtime must not rehydrate from provider-native blobs as canonical truth

## K-MEMSUB-006 Public Boundary Preservation

Fixed rules:

- public memory and agent-core RPC surfaces must continue to emit Nimi-owned typed payloads only
- provider-native wire shapes remain runtime-private
- internal extraction into a runtime-owned overlay library must not create a second public engine-facing contract, proto package, or provider-style identity boundary
- runtime may project provider-backed reflect / recall results into Nimi typed families, but the projection boundary must stay in runtime-owned code under `runtime/internal/**`

## K-MEMSUB-007 RealmSyncBridge Ingress Boundary

`RealmSyncBridge` remains a runtime-private ingress/egress boundary above the admitted local memory substrate.

Fixed rules:

- runtime-private downlink observations from Realm or governance must enter local memory truth through the same committed replication mutation path admitted by `K-MEM-009`
- bridge ingress may feed only admitted typed replication outcomes; provider-native or transport-native blobs must not mutate runtime memory truth directly
- backlog/outbox ownership remains with retained runtime-private memory depth;
  the substrate bridge must not become a second source of pending replication
  truth
- the current seam treats backlog/replay ownership on retained runtime-private
  memory depth as the stable runtime-owned boundary; moving that ownership
  requires a later redesign rather than routine internal extraction
- real endpoint, transport, and polling policy remain deferred for the current local-only phase; runtime must not imply active Realm memory sync without a later admitted redesign
- any future bridge implementation must preserve the same committed runtime-owned mutation path and fail-close semantics

## K-MEMSUB-008 Runtime-Owned Derived Replay Boundary

Provider-native substrates do not own derived projection lineage, review idempotency, or truth admission state.

Fixed rules:

- runtime-owned source-junction lineage and committed review-run identity must remain above provider-native storage semantics
- if provider-backed state must be rebuilt, runtime may replay only from committed canonical records plus committed runtime-owned derived-projection truth; provider-native reflect output must not become canonical or derived authority by itself
- provider-native storage must not become the source of truth for admitted narrative / truth lineage or `review_run_id` idempotency
- if replay, lineage, or review-commit mechanics are extracted into a runtime-owned internal library, the library remains an implementation carrier only; the admitted authority and fail-close semantics remain runtime-owned
- helper extraction must not be interpreted as moving backlog/replay ownership
  off the retained runtime-private memory path; deterministic replay/rebuild
  ownership remains runtime-owned unless a later redesign explicitly reopens
  that boundary
