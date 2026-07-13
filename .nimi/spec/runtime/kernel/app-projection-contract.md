# Runtime App Projection Contract

> Owner Domain: `K-APP-*`

Runtime-owned app health, response-state, next-action, storage, package
readiness, account inventory, and local-record projection authority.

This file is a semantic split from `app-messaging-contract.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

## K-APP-019 AppHealth Typed Diagnostic Projection

`MUST` (eight typed diagnostic dimensions). The `AppHealth` typed
projection MUST report exactly eight typed diagnostic dimensions, each
producing a typed sub-state:

| Dimension | Typed sub-states |
|---|---|
| `integrity` | `ok` / `digest_mismatch` / `signature_unverified` / `provenance_unverified` / `mirror_unreachable` |
| `runtime` | `ok` / `registration_missing` / `lifecycle_supervisor_failed` / `dependency_unready` |
| `nimi_api_permissions` | `ok` / `scope_missing` / `scope_revoked` / `scope_expired` |
| `storage` | `ok` / `root_missing` / `migration_pending` / `os_storage_disclosure_missing` |
| `publisher_disclosed_network` | `ok` / `disclosure_missing` / `disclosure_mismatch` |
| `data` | `ok` / `app_data_corrupt` / `cache_corrupt` |
| `review` | `approved` / `revision-requested` / `rejected` / `kill-switched` |
| `response` | `ok` / `forced_update_required` / `rollback_available` / `publisher_suspended` / `report_received` / `kill_switch_active` |

The eight dimension names (`integrity`, `runtime`,
`nimi_api_permissions`, `storage`, `publisher_disclosed_network`,
`data`, `review`, `response`) are exactly the eight names admitted by
this rule. Each dimension produces exactly one typed sub-state per
`AppHealth` projection emission; the sub-state vocabulary above is the
admitted enum for that dimension.

**Disambiguation from `P-NAPP-008`.** `P-NAPP-008` at
`.nimi/spec/platform/kernel/nimi-app-admission-contract.md:103-118`
admits the typed `health_repair_projection` set of eight overall
**STATES** the app can be in:

- `unavailable`
- `setup-required`
- `needs-confirmation`
- `in-progress`
- `failed`
- `unsupported`
- `repair-required`
- `stale-projection`

`K-APP-019` admits eight typed **DIMENSIONS** (the orthogonal
evaluation surfaces above). The two "eights" are different in
semantics: `P-NAPP-008` 's eight are mutually-exclusive overall
states; `K-APP-019` 's eight are orthogonal dimensions each emitting
its own sub-state per projection emission. The overall `P-NAPP-008`
state is **DERIVED** from the eight dimensions' sub-states per the
lookup table below. The two eights MUST NOT be conflated; consumers
MUST NOT pick one as a substitute for the other.

`MUST` (derivation table — dimensions to overall states). The
derivation from `K-APP-019` 's eight diagnostic dimensions to
`P-NAPP-008` 's eight overall states is admitted as a typed lookup
table inside this rule body. The table is the canonical mapping;
free-form interpretation by the projection layer is forbidden.

Reading the table: each row enumerates one `(dimension, sub-state)`
pair and the `P-NAPP-008` overall state it raises. Where one
`(dimension, sub-state)` row raises multiple overall states (e.g. the
`review` dimension 's `kill-switched` sub-state independently
contributes to both `unavailable` and `repair-required` overall-state
candidacy), all raised states are listed; the projection layer
resolves the final overall state by precedence
`unavailable > repair-required > failed > setup-required >
needs-confirmation > in-progress > unsupported > stale-projection`,
admitted as part of this table.

| Dimension | Sub-state | Raised overall state(s) |
|---|---|---|
| `integrity` | `ok` | (none — clears integrity contribution) |
| `integrity` | `digest_mismatch` | `failed` |
| `integrity` | `signature_unverified` | `failed` |
| `integrity` | `provenance_unverified` | `failed` |
| `integrity` | `mirror_unreachable` | `stale-projection` |
| `runtime` | `ok` | (none) |
| `runtime` | `registration_missing` | `setup-required` |
| `runtime` | `lifecycle_supervisor_failed` | `failed` |
| `runtime` | `dependency_unready` | `setup-required` |
| `nimi_api_permissions` | `ok` | (none) |
| `nimi_api_permissions` | `scope_missing` | `needs-confirmation` |
| `nimi_api_permissions` | `scope_revoked` | `repair-required` |
| `nimi_api_permissions` | `scope_expired` | `repair-required` |
| `storage` | `ok` | (none) |
| `storage` | `root_missing` | `repair-required` |
| `storage` | `migration_pending` | `in-progress` |
| `storage` | `os_storage_disclosure_missing` | `unsupported` |
| `publisher_disclosed_network` | `ok` | (none) |
| `publisher_disclosed_network` | `disclosure_missing` | `unsupported` |
| `publisher_disclosed_network` | `disclosure_mismatch` | `unsupported` |
| `data` | `ok` | (none) |
| `data` | `app_data_corrupt` | `repair-required` |
| `data` | `cache_corrupt` | `repair-required` |
| `review` | `approved` | (none) |
| `review` | `revision-requested` | `needs-confirmation` |
| `review` | `rejected` | `unavailable` |
| `review` | `kill-switched` | `unavailable` |
| `response` | `ok` | (none) |
| `response` | `forced_update_required` | `unavailable` |
| `response` | `rollback_available` | `repair-required` |
| `response` | `publisher_suspended` | `unavailable` |
| `response` | `report_received` | `needs-confirmation` |
| `response` | `kill_switch_active` | `unavailable` |

When all eight dimensions report `ok` (or the no-raise sub-states
above), the projection layer emits no `P-NAPP-008` raised state. The
`P-NAPP-008` overall state in this case is the absence-of-degraded
projection ("the app is OK on the eight admitted dimensions"); this
absence is the typed default and is not itself one of `P-NAPP-008` 's
admitted degraded states.

The typed reason `os_storage_disclosure_missing` (`P-NAPP-028` at
`.nimi/spec/platform/kernel/nimi-app-admission-contract.md` MUST NOT
clause) covers both "missing under app-owned-os-storage" and
"populated under nimi-mediated-default" admission-time invariants.
`K-APP-019` 's `storage` dimension surfaces the same typed reason at
projection time for the app-owned-os-storage branch; the projection
layer MUST surface a differentiated user message between
"disclosure missing" and "disclosure cross-populated" cases using
typed message text (the typed reason itself is shared by admission
intent; this rule does not invent a new typed reason).

`MUST NOT`. `K-APP-019` MUST NOT redefine `P-NAPP-008` 's overall
state set; this rule cross-references `P-NAPP-008` and admits the
derivation table only. `K-APP-019` MUST NOT collapse the eight typed
dimensions into a single "health" sub-state; each dimension is
independently emitted. The projection layer MUST NOT infer an
overall state outside the derivation table 's enumeration; free-form
"close enough" derivation is forbidden.

## K-APP-020 AppResponseState Typed Projection

`MUST` (typed fields). The `AppResponseState` typed projection MUST
surface exactly the following typed fields:

| Field | Type | Semantics |
|---|---|---|
| `kill_switch_active` | bool | projects from `P-ECO-004` `kill-switched` review-state — true when the app 's admitted descriptor 's `review.decision` (`P-NAPP-025`) or the registry row 's runtime kill-switch posture resolves to `kill-switched` |
| `forced_update_required` | bool | true when Runtime response-state policy resolves that the active descriptor requires a remediated version before next launch |
| `rollback_available` | bool | true when a previous admitted release descriptor remains eligible per the descriptor 's `rollback_eligibility` (`P-NAPP-018`) and is materializable |
| `publisher_suspended` | bool | true when Runtime response-state policy resolves that the publisher namespace is suspended for app launch/support purposes |
| `report_received` | uint32 (typed-counted) | typed monotonic counter of post-release community reports received against this descriptor; `0` is "no report"; a non-zero count indicates the admitted report aggregate has delivered at least one report and is the support-UX entry into report-driven detection |

Apps consume this projection. The Apps surface MUST NOT compute these
typed fields from raw data (raw review-state polling, raw descriptor
diffing, raw publisher-status fetches); Runtime owns the projection
and Apps reads it as typed truth.

`MUST` (source posture). `K-APP-020` cross-references `P-ECO-004`
for `kill-switched` review-state and `P-NAPP-018` for
`rollback_eligibility`. The remaining response-state policy inputs
(`forced_update_required`, `publisher_suspended`, `report_received`)
are Runtime projection inputs for this rule and must be resolved as
typed evidence before Runtime emits them. Runtime MUST NOT derive one
response field from another or from host execution dossiers.

`MUST NOT`. `K-APP-020` MUST NOT extend the five-field set above
under this rule; the typed field set is closed. A new response-state
field is a separate authority-bearing
admission event. `K-APP-020` MUST NOT silently coerce one typed
field 's value from another (e.g. inferring
`forced_update_required: true` from `kill_switch_active: true`); the
five fields are orthogonal projections. The Apps surface MUST NOT
read raw P-ECO, descriptor, publisher, report, or host task state directly
to compute these fields; the projection seam is `K-APP-020`.

## K-APP-021 Support Next-Action Mapping

`MUST` (closed ten-token next-action enum). Every typed degraded
`AppHealth` state (`K-APP-019`) and every degraded `AppResponseState`
(`K-APP-020`) MUST map to a typed next-action token. The admitted
token enum is exactly the following ten values, closed at this
admission:

1. `request_permission`
2. `repair_runtime_materialization`
3. `reinstall_descriptor`
4. `rollback`
5. `clear_cache`
6. `export_diagnostics`
7. `contact_publisher`
8. `stop_kill_switched`
9. `stop_rejected`
10. `await_forced_update`

The enum is closed. Extending the enum beyond ten values, or
contracting it below ten values, is a separate authority-bearing
admission event.

**Disambiguation from `K-APP-016`.** `K-APP-016`
`HealthRepairApp` at this file lines 293–307 admits an RPC with
exactly four typed action tokens: `cancel`, `retry`, `repair`,
`reinstall`. `K-APP-021` 's ten next-action tokens are NOT a
superset, subset, or rename of `K-APP-016` 's four RPC action
tokens. The two enums are different in domain:

- `K-APP-016` 's four tokens are RPC ACTIONS the caller invokes
  against `RuntimeAppService` to drive a lifecycle job; the typed
  enum lives at the gRPC surface.
- `K-APP-021` 's ten tokens are UX NEXT-ACTION PROJECTIONS the
  Support surface displays so the user knows what to do next; the
  typed enum lives at the projection surface. Some `K-APP-021`
  tokens map onto a `K-APP-016` action invocation
  (`repair_runtime_materialization` ultimately drives a
  `K-APP-016` `repair`; `reinstall_descriptor` ultimately drives a
  `K-APP-016` `reinstall`); others do not (`request_permission`,
  `rollback`, `clear_cache`, `export_diagnostics`,
  `contact_publisher`, `stop_kill_switched`, `stop_rejected`,
  `await_forced_update` are not `K-APP-016` actions). The two
  enums MUST NOT be conflated; the projection layer MUST NOT
  rewrite a `K-APP-021` token into a `K-APP-016` token without
  going through the action-binding semantics above.

`MUST` (state-to-action mapping table). The mapping from
`{AppHealth degraded state × AppResponseState flag}` to the ten
next-action tokens is admitted as a typed lookup table inside this
rule body. Free-form UX inference of next-action is forbidden; the
Support surface consumes this table.

Reading the table: rows are keyed on either a `K-APP-019` `(dimension,
sub-state)` row or a `K-APP-020` typed-flag value. Where a row 's
condition holds simultaneously with another row 's condition, the
projection layer resolves the final next-action by precedence
`stop_kill_switched > stop_rejected > await_forced_update > rollback >
request_permission > repair_runtime_materialization >
reinstall_descriptor > clear_cache > export_diagnostics >
contact_publisher`, admitted as part of this table.

| Source (dimension/sub-state OR response field) | Next-action token |
|---|---|
| `review` = `kill-switched` OR `AppResponseState.kill_switch_active` = true | `stop_kill_switched` |
| `review` = `rejected` | `stop_rejected` |
| `AppResponseState.forced_update_required` = true | `await_forced_update` |
| `AppResponseState.rollback_available` = true (when surfaced for a degraded condition that rollback resolves) | `rollback` |
| `nimi_api_permissions` = `scope_missing` | `request_permission` |
| `nimi_api_permissions` = `scope_revoked` | `request_permission` |
| `nimi_api_permissions` = `scope_expired` | `request_permission` |
| `runtime` = `registration_missing` | `repair_runtime_materialization` |
| `runtime` = `lifecycle_supervisor_failed` | `repair_runtime_materialization` |
| `runtime` = `dependency_unready` | `repair_runtime_materialization` |
| `storage` = `root_missing` | `repair_runtime_materialization` |
| `storage` = `migration_pending` | `repair_runtime_materialization` |
| `data` = `app_data_corrupt` | `reinstall_descriptor` |
| `integrity` = `digest_mismatch` | `reinstall_descriptor` |
| `integrity` = `signature_unverified` | `reinstall_descriptor` |
| `integrity` = `provenance_unverified` | `reinstall_descriptor` |
| `integrity` = `mirror_unreachable` | `export_diagnostics` |
| `data` = `cache_corrupt` | `clear_cache` |
| `storage` = `os_storage_disclosure_missing` | `export_diagnostics` |
| `publisher_disclosed_network` = `disclosure_missing` | `contact_publisher` |
| `publisher_disclosed_network` = `disclosure_mismatch` | `contact_publisher` |
| `AppResponseState.publisher_suspended` = true | `contact_publisher` |
| `AppResponseState.report_received` non-zero | `export_diagnostics` |
| `review` = `revision-requested` | `contact_publisher` |

The table covers every degraded condition admitted by `K-APP-019`
and every typed-flag condition admitted by `K-APP-020` that maps to a
support next-action. Conditions whose admitted sub-state is the
`ok` / `approved` / `(none)` no-raise case do not map to a
next-action token — there is no next-action to project when the app
is on the happy path of that dimension.

`MUST` (cross-references). `K-APP-021` cross-references `K-APP-016`
(the four-token RPC action enum from which `K-APP-021` is explicitly
distinct), `K-APP-019` (the eight diagnostic dimensions whose typed
sub-states the table reads from), and `K-APP-020` (the typed response
fields the table reads from).

`MUST NOT`. `K-APP-021` MUST NOT extend the ten-token next-action
enum under this rule. `K-APP-021` MUST NOT silently rewrite a token
to a `K-APP-016` RPC action token without going through the binding
semantics in the disambiguation clause above. The Support surface
MUST NOT skip the mapping table and infer a next-action from prose;
the typed table is the contract face.

`K-APP-019` derivation table 与 `K-APP-021` state-to-action mapping
table 是 closed contract faces，不接受 free-form 投影层重新解释。

## K-APP-022 App Storage Truth Projection

`MUST`：app-private storage is Runtime-owned principal-scoped truth. A
local-app session resolves its opaque principal internally; the request does
not accept `app_id` or a principal override. Runtime derives the following
roots:

- `<nimi_data>/apps/<local-app-principal-id>/data`
- `<nimi_data>/apps/<local-app-principal-id>/cache`
- `<nimi_data>/apps/<local-app-principal-id>/tmp`
- active release root, only when an active installed release pointer resolves

`MUST`：an active development principal may receive data/cache/tmp roots without
an immutable release. Same-app-id principals remain isolated. Tombstoned data
is not rebound to a new authorization and is delete-only after fresh presence.

`MUST NOT`：apps, Desktop, or SDK consumers must not read `~/.nimi/nimi.json`,
`~/.nimi/runtime/config.json`, or concatenate `<nimi_data>/apps/<app-id>` as an
alternate storage authority. Missing `dataRootRef`, invalid principal/path shape,
symlink/non-directory corruption, or unsupported storage policy must fail
closed with typed storage state/reason.

## K-APP-023 App Package Readiness Projection

0K freezes the projection fields needed to report immutable profile
unavailability, but no immutable package may become ready before 0P/P. Any
legacy catalog/download/install evidence is non-authorizing and must project
`blocked` with the stable immutable-profile-unavailable reason.

`MUST`：`GetAppPackageReadiness(local_app_record_id)` 是 Runtime-owned package readiness
projection。它读取 Runtime admitted registry / release descriptor、
selected `nimi_data` app layout、active release pointer、与
Runtime-written `install-evidence.json`，并返回 typed
`AppPackageReadinessProjection`：

- `ready` only after 0P/P is admitted and an active release pointer resolves and install evidence is in a
  verified state (`digest-verified` or `bundled-source`) for that active
  release;
- `install_required` when the app is admitted but has no active release;
- `update_required` when the active release is verified but differs from the
  currently bound release descriptor version;
- `repair_required` when active pointer / evidence / digest state is missing,
  corrupt, or not verified;
- `blocked` when Runtime package readiness cannot be evaluated because
  descriptor/storage authority is unavailable.

`MUST NOT`：Desktop, Kit, SDK, or apps must not scan
`<nimi_data>/apps/<app-id>/releases/*/.nimi/install-evidence.json`, parse
Runtime install evidence, or derive package readiness from file existence as
an alternate package authority. SDK may expose typed decoders and compose this
projection with Platform registry/admission rows for developer ergonomics, but
the readiness facts remain Runtime-owned.

## K-APP-024 Account App-Inventory Projection

`MUST`：`GetAccountAppInventory()` 是 Runtime-owned authenticated account
app-inventory projection。Runtime resolves the account id from the
current authenticated Runtime account projection; the request must not accept a
renderer- or app-supplied `account_id`.

`MUST`：schema version 2 separates account visibility from local
materialization. `AccountAppInventoryRow.account_state` carries
`verified | entitled | disabled | removed | revoked` semantics; `install_state`
carries `not-present | local-record-active | local-record-dormant | removed`.
Account eligibility and PC-local principal/record state remain separate and
must not be collapsed into one installed boolean.

`MUST`：immutable/development lifecycle mutations may only
change local materialization fields. They MUST NOT create account entitlement
truth or silently upgrade a row to verified.

`MUST`：the response distinguishes an absent projection (`exists=false`) from a
present, validated `AccountAppInventoryRecord`. Corrupt JSON, unsupported
schema, account-id mismatch, invalid row state, invalid install state, or
invalid data policy must fail closed with
`PROTOCOL_ENVELOPE_INVALID`.

`MUST NOT`：Desktop, SDK, Kit, or apps must not read
`~/.nimi/accounts/<account-id>/apps/inventory.json`, derive the authenticated
account directory, or expose a mutation path as an alternate inventory
authority. SDK may expose typed request/response helpers and decoders over this
Runtime surface, but Runtime remains the writer and validator.

## K-APP-025 Retired Local Adoption Boundary

The predecessor local-adoption family is retired and must be removed from
Proto, generated clients, Runtime handlers/stores, SDK/Kit exports, Desktop UX,
tests, and inventory states in the atomic public wire epoch. It has no active
success behavior and no alias.

Mutable source enters through K-APP-027 Developer Mode and creates a fresh
isolated development principal/record only after Runtime presence and approval.
Immutable bytes remain typed unavailable until 0P/P. Package-manager roots,
workspace/source scanning, app-local manifests, app id, file presence, process
liveness, or an inventory-only record cannot create runnable truth.
