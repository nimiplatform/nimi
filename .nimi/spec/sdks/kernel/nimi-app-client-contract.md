# SDK Nimi App Client Contract

> Owner Domain: `S-APP-*`

## Scope

定义 SDK 对 Platform `Nimi App` catalog、Runtime local-record projection 与
final local-app carrier 的 typed consumer surface。0K 不 admit immutable
package install/import/update/promotion/repair accessor，也不让 SDK 选择
principal、launch target、account、process 或 session。Desktop hosted shell
（D-HOME-004 / D-HOME-005）通过 SDK projection 投影 Apps。

## S-APP-001 — Sole Admitted Access Path

`MUST`：SDK Nimi App client surface 是 app / developer / Desktop hosted
shell 消费 verified catalog、account inventory、Runtime local-record status
与 host-injected local-app carrier 的唯一 admitted typed path。

`MUST NOT`：app / developer / shell 不得：

- 绕过 SDK 直接读写 Platform `nimi-app-registry.yaml`
- 绕过 SDK 直接调用 Runtime app registration 私有 RPC
- 私自实现 installer / package-manager / source-selector 逻辑
- 通过 app id、path、manifest、renderer metadata 或 SDK argument 选择
  principal、launch、account、grant 或 session

## S-APP-002 — Logical Operation Set

`MUST`：0K SDK 暴露以下 inventory logical operation：

- `app.list()` — 列出当前用户可见的 unified Apps inventory。该集合由
  Platform ordinary catalog source、Runtime authenticated account inventory
  source、Runtime local-record source 合成；source 必须保留，不能互相推断。
- `app.get(appId)` — 获取单个 app inventory entry 与 source/state/action
  projection。
- `app.status(appId)` — 获取 app health/repair projection state。
- `app.subscribe(callback)` — 订阅 app lifecycle 事件；host-local
  event stream。

`MUST NOT`：0K Nimi App client 不暴露 `app.install`、`app.update`、
`app.uninstall`、`app.launch`、`app.healthRepair`、import、promotion 或 package
job mutation。Immutable readiness 只能通过 `S-APP-018` 返回 typed
unavailable；local-development launch is native-host initiated and never an SDK
app-id call.

## S-APP-003 — No SDK Launch Selector

`MUST`：local-development launch 只能由 verified native `local_app_control`
supervisor 执行 `PrepareLocalAppLaunch`、process bind 与 request-empty session
open。SDK/app code只消费已注入 carrier。

`MUST NOT`：SDK 不得暴露 app-id/path/scope/package/host selector 来创建或
恢复 local-app session，也不得从 active chat、renderer state、default scope
或 manifest 推断 launch authority。

## S-APP-004 — Non-Owner Of Installer / Selector / Marketplace

`MUST NOT`：SDK Nimi App client surface 不拥有：

- installer / package-manager / PATH / source-selector 逻辑
- marketplace / economy / review / kill-switch truth
- Nimi App admission decision（属于 Platform `P-NAPP-*`）
- runtime registration / sandbox / process supervision truth（属于
  Runtime）
- GitHub/npm/source workspace discovery truth

## S-APP-005 — Typed Projection State

`MUST`：所有 logical operation 返回 typed projection state，与 Platform
`P-NAPP-008` health/repair fail-closed semantics 对齐。

`MUST NOT`：不得从 transfer completion、endpoint reachability、process
liveness、file existence 推断 `ready`；不得通过 generic `unavailable`
collapse 多种 fail-closed reason。

## S-APP-006 — Projection Family Reuse

`MUST`：SDK Nimi App client surface 复用 `S-AICONF-001..S-AICONF-006`
与 `S-RUNTIME-119` 的 typed projection paths；与 factory AIProfile
selection / runtime local environment 的 binding 通过这些 projection
一致表达。

`MUST NOT`：不引入第二套 projection family；不暴露 raw runtime / realm /
cognition transport。

## S-APP-007 — No Fallback Knob

`MUST`：错误返回 typed error，遵守 `S-AICONF-002` no-fallback 模式。

`MUST NOT`：不暴露 `{ fallback: 'allow' }` 类参数；不静默降级到 partial
install / partial launch；不把 Runtime fail-close 隐藏为 success。

## S-APP-008 — Subscription Scope

`MUST`：`app.subscribe(callback)` 仅承载 catalog/account/local-record
projection event（source degraded、record active/dormant/removed、session or
grant posture changed 等 typed event）。

`MUST NOT`：subscription 不承载 audit / permission / spend 事件；permission
fabric 与 Realm audit 拥有 audit truth。

## S-APP-009 — Catalog Source Ordinary Visibility Filter

`MUST`：SDK `app.list()` 的 catalog source and Desktop Apps consumers must only
project catalog-sourced apps whose registry row resolves as ordinary visible:

- `admission_status=admitted`
- `ordinary_visibility=ordinary-visible`
- package kind is admitted
- release descriptor resolves
- trust/runtime/permission/storage policy refs resolve

Avatar must not appear from the catalog source for ordinary Apps, even when an
internal registry row exists for bundled package/update coordination.

`MUST NOT`：SDK must not expose unadmitted workspace apps, app-local spec rows,
Avatar hidden-internal rows, or source-discovered packages as catalog Apps.
Account inventory and local-record sources are admitted separately by
`S-APP-020` / `S-APP-021`; they MUST NOT be relabeled as ordinary catalog truth.

## S-APP-010 — Immutable Package Mutation Non-Admission

`MUST`：verified release descriptors are read-only discovery/review input in 0K.
SDK may project catalog metadata but cannot download, inspect, unpack, register,
install, import, update, promote, rollback, repair or execute an immutable
artifact. Those operations are absent from the Nimi App client and Runtime
package readiness maps to typed unavailable.

`MUST NOT`：SDK must not perform direct `npm install`, `npx`, GitHub clone,
source build/run, lifecycle script execution, digest-only admission, or local
file scanning as package truth.

## S-APP-011 — Principal-Keyed Storage Boundary

`MUST`：Runtime private storage is partitioned by the inherited
`local_app_principal_id`, never app id. The local-app SDK carrier exposes no
absolute root or root accessor. Its only admitted storage surface is the exact
JSON operation set defined by S-APP-017; all other storage and file operations
remain typed unavailable.

`MUST NOT`：SDK must not construct or return `<nimi_data>/apps/<app-id>` paths,
accept a principal selector, inspect Runtime config, or infer storage from
filesystem existence. Tombstoned data is delete-only owner state and cannot be
rebound by SDK.

## S-APP-012 — Declared Nimi-API Scopes Carrier

**Background fact.** The developer-authored manifest carries a
`permissions.declared_nimi_api_scopes` list of `{ scope, qualifier?,
purpose }` entries as transparency for review and UI, not as an enforcement
control. The verified catalog descriptor's `permissions_ref` (`P-NAPP-018`)
remains review vocabulary only. For `LOCAL_APP`, enforcement is the exact
Runtime K-GRANT account+principal record plus the canonical operation owner
policy; trust tier/class and manifest declarations have no permission effect.

`MUST` (transparency carrier surface). SDK Nimi App client surface
admits a typed read-only accessor that exposes the developer-submitted
manifest's declared Nimi-API scope list as it was reviewed for
admission. The accessor surfaces an array of entries each with the
typed fields:

- `scope` — a closed `P-PERM-002` scope enum value;
- `qualifier` — an optional typed qualifier string (e.g.
  `app-local-drafts` per `P-PERM-011`); absent when the declared scope
  does not require one;
- `purpose` — the developer-authored, review-vetted purpose string
  recorded on the manifest entry.

The accessor is read-only. It exposes the declared-scopes list to the
calling app, to Apps surface consumers, and to Desktop hosted shell
projections that display the manifest review trail. The shape of each
entry MUST mirror the parent manifest § 6 entry shape verbatim; the
SDK surface MUST NOT collapse the three sub-fields into a single
string, MUST NOT drop `purpose`, and MUST NOT re-derive entries from
runtime grant state.

`MUST NOT` (transparency, not enforcement). The declared-scopes
carrier MUST NOT be admitted as an enforcement surface. The carrier
does not grant, withhold, gate, or refuse any operation; it does not
substitute for Runtime K-GRANT or the per-operation fail-closed enforcement at
RuntimeAgent/Cognition and any independently consumed Realm owner path. Apps and
Apps-surface consumers MUST NOT infer that a scope listed in this carrier is
currently granted; local-app grant posture comes only from the host-injected
local-app carrier. `S-PERM-*` remains a separate consumer contract where
independently admitted and cannot substitute for the local grant. A SDK caller
MUST NOT short-circuit a grant request, a grant subscription, or a fail-closed
denial on the basis of this carrier; doing so
collapses the parent `PI-W1-8` "transparency for review and UI; not
control" invariant.

`MUST NOT` (no developer-supplied enforcement claim). The carrier MUST
NOT admit developer-asserted entitlement, deny-list, or any
"manifest-claimed grant" projection that would suggest the manifest
itself controls runtime behavior. The carrier is a projection of the
admitted-for-review manifest content over the verified descriptor; the
authoritative local-app grant truth is Runtime K-GRANT.

Cross-references: `P-NAPP-018` (descriptor `permissions_ref` field;
not redefined here), `P-PERM-002` (closed scope enum; not extended
here), `P-PERM-011` (`app-local-drafts` qualifier semantics; not
redefined here), parent invariant `PI-W1-8`.

## S-APP-013 — Destructive Local-App Data Deletion Non-Admission

0K admits no immutable uninstall or SDK delete-data prompt/action. A local-app
principal tombstone leaves retained durable data as Runtime-owned delete-only
state; reinstall, reauthorization, same app id, same project, or SDK inventory
composition cannot rebind it.

`MUST NOT`: SDK must not expose `app.uninstall`, force-delete, retain/delete
choice, absolute data path, size-derived deletion decision, direct filesystem
mutation, or pseudo-success cleanup. A future deletion surface requires its own
Runtime owner operation, fresh presence, impact preview, principal-bound target,
and positive/negative evidence without reshaping the 0K principal/record seam.

Cross-references: `K-APP-014` (0K tombstone/delete-only posture),
`P-NAPP-015` (principal-keyed storage policy), `S-APP-011` (no SDK path/root
projection).

## S-APP-014 — File-Scope Client Non-Admission

SDK Nimi App client surface does not admit a callable file-API client in
the current public SDK.

The following consumer-side operations are explicitly non-admitted and MUST
NOT be exposed as active SDK APIs:

- `file.read(path, range?)`
- `file.write(path, bytes, mode)`
- `file.list(path)`
- `file.delete(path)`
- `file.move(sourcePath, destinationPath)`

`P-PERM-011` admits the `app-local-drafts` qualifier as permission-review
and scope-expression semantics. `K-APP-018` explicitly does not admit a
generic Runtime-mediated file API. The three exact S-APP-017 JSON storage
operations are not a file client: they accept no bytes, directory, move, raw
delete, mode, range, root, or absolute-path input. Therefore the SDK MUST NOT map
`file.read.scoped` / `file.write.scoped` grants to hidden Runtime methods,
Desktop bridge helpers, Realm REST calls, generic HTTP proxy calls, or
direct filesystem paths. Missing file client support is a fail-closed
non-admission state, not a fallback to another transport.

SDK may expose read-only descriptor/projection data that tells a consumer a
file scope was declared or granted. That projection MUST NOT imply that a
callable Nimi-mediated file API exists.

Cross-references: `K-APP-018` (Runtime-mediated file-API non-admission),
`P-PERM-011` (`app-local-drafts` qualifier semantics; not a callable
surface), `P-PERM-002` (closed scope enum; not extended), `P-NAPP-027` /
`P-NAPP-028` (`nimi-mediated-default` vs `app-owned-os-storage` posture).

## S-APP-015 — Review-Evidence Accessor

**Background fact.** `P-NAPP-025` admits the `review.decision` closed
enum (`approved | revision-requested | rejected | kill-switched`) plus
the accompanying review-evidence sub-fields `review.adjudicator_kind`
(`human | nimi-automated-gate`), `review.adjudicator_ref`,
`review.decided_at`. `P-AUDIT-006` admits the review-evidence shape on
the admitted release descriptor (`audit_evidence_ref`,
`ai_audit_model_ref`, `scanner_results_ref`) and cross-references
`P-NAPP-025` without redefining it. Parent invariant `PI-W3-34`
records "review status" as a first-level Apps-surface display field.
Both `P-NAPP-025` and `P-AUDIT-006` are admitted authority; this rule
admits the SDK CONSUMER accessor only.

`MUST` (typed accessor surface). SDK Nimi App client surface admits a
typed read-only accessor over the admitted release-descriptor's
review block. The accessor exposes the typed fields owned by
`P-NAPP-025`:

- `decision` — closed enum `approved | revision-requested | rejected
  | kill-switched`;
- `adjudicator_kind` — closed enum `human | nimi-automated-gate`;
- `adjudicator_ref` — string reference (reviewer policy or human
  reviewer identifier);
- `decided_at` — terminal-decision timestamp owned by the review record.

The accessor is read-only; it returns the descriptor's terminal
review-decision record as admitted. The accessor is the SDK surface
the Apps first-level display ("review status" per parent invariant
`PI-W3-34`) and Desktop hosted shell admission-trail UX consume.

`MUST` (placement). The review-evidence accessor is admitted in
S-APP. It is NOT admitted in `S-PERM-*`. The Permission Client
Contract (`nimi-permission-client-contract.md`) covers permission
grant lifecycle only; the review-decision record is an
admission-evidence accessor over the admitted release descriptor,
not a permission grant lifecycle accessor. See `S-PERM-010` below for
the explicit S-PERM anti-target rule.

`MUST` (consume-only; no policy drive). The accessor reads the
admitted review record; it MUST NOT drive policy. The accessor MUST
NOT gate `app.launch`, MUST NOT gate `app.install`, MUST NOT gate
grant requests, MUST NOT alter `app.list` ordinary-visibility
filtering, and MUST NOT alter Apps-surface visibility decisions. The
authoritative launch gate is `K-APP-017` + `P-NAPP-008`; the
authoritative admission gate is the `P-AUDIT-001` publish-to-
admission gate sequence; the authoritative grant lifecycle is
`S-PERM-*`. This accessor is the SDK consumer surface over the
already-admitted decision record only.

`MUST NOT` (no schema redefinition). This rule MUST NOT redefine
`P-NAPP-025`'s decision schema, MUST NOT extend the
`review.decision` closed enum, MUST NOT extend the
`adjudicator_kind` enum, and MUST NOT introduce a parallel review
record that differs from the admitted descriptor's review block.
Decision schema ownership remains with `P-NAPP-025`; evidence shape
ownership remains with `P-AUDIT-006`; this accessor projects them
verbatim. Collapsing any two of the four typed fields into one
accessor field is a forbidden parallel-truth projection.

`MUST NOT` (no upstream-evidence accessor here). This accessor
exposes the `P-NAPP-025` decision schema. It MUST NOT expose the
three upstream audit-evidence references (`audit_evidence_ref`,
`ai_audit_model_ref`, `scanner_results_ref`) under this rule;
upstream evidence-record consumer surfaces are out of scope for this
rule. The Apps-surface "review status"
projection per `PI-W3-34` reads the terminal decision record; the
upstream evidence chain consumed by `P-AUDIT-006` is not part of the
first-level Apps display.

Cross-references: `P-NAPP-025` (review-decision schema; not
redefined), `P-AUDIT-006` (review-evidence shape; not redefined),
`K-APP-017` (launch gate authority; not driven by this accessor),
`P-AUDIT-001` (admission gate authority; not driven by this
accessor), `S-PERM-010` (anti-target rule recording that the
review-evidence accessor is NOT in S-PERM), parent invariants
`PI-W3-34`, `PI-W2-21`, `PI-W2-22`.

## S-APP-016 — Generated-App Runtime Platform Client Auth Helper

**Background fact.** Platform `P-SCAF-*` admits Nimi app scaffolding and
requires generated apps to consume SDK/Runtime auth/session authority without
self-declaring first-party status, owning tokens, or calling Realm login routes.
Runtime `K-ACCSVC-*` owns local account truth and the local-app operation
coordinator; `K-APP-*` owns local principal/record truth; `K-GRANT-*` owns local
grant truth; `K-PLOCAL-*` owns launch leases and process-bound sessions. The
helper consumes the final host-injected carrier and must not merge those owners.

`MUST` (exported names). SDK admits the following exact public exported names
for generated Nimi app auth/client construction:

- `createNimiAppRuntimePlatformClient`;
- `NimiAppRuntimePlatformClientInput`;
- `NimiAppAuthMode`;
- `NimiAppAuthProjection`;
- `NimiAppAuthUnavailable`;
- `NimiAppLocalSessionProjection`.

`MUST` (mode set). `NimiAppAuthMode` is a closed mode set:

- `local-first-party-app`;
- `local-app`.

`MUST` (`local-first-party-app`). This value is available only to the retained
bundled first-party composition. It cannot be selected by a third-party app,
project, manifest, fixture or mode string and cannot be inferred from Desktop
launch. Shipped Zhiyu/Avatar remain bundled; an isolated Zhiyu integration build
uses `local-app` instead.

`MUST` (`local-app`). This value maps only to Runtime `LOCAL_APP`. The SDK
receives a host-injected typed standard-shell carrier and projects session
status plus exact selected operations. It never receives principal/record/grant
identifiers, launch material, process proof, endpoint, bearer or authorization
metadata. A valid zero-grant session is projected as session-bound plus denied
operation posture, not authenticated success.

`MUST` (projection). `NimiAppAuthProjection` must distinguish session-bound
zero-grant, session-bound granted, action-required, revoked, process-replaced,
account-changed, Runtime-restarted, and unavailable states. It must not collapse
session validity and authorization. `NimiAppAuthUnavailable` is the typed
fail-closed branch for absent carrier, failed principal/record resolution,
custody unavailable, or unavailable operation owner.

`MUST NOT` (no app-owned auth truth). No mode may accept app-owned access
tokens, refresh tokens, session stores, subject providers, direct Realm login
credentials, refresh-token providers, raw JWTs, decoded subject fields, or any
app-controlled token custody as input.

`MUST NOT` (no Realm login bypass). Generated third-party/developer auth must not call
`/api/auth/login`, `/api/auth/refresh`, SDK Realm login routes, or direct Realm
token exchange as app auth truth. Realm data access, when later admitted for a
caller, must come through an exact Runtime-owned protected operation. No mode,
including first-party local composition, has a short-lived token exception.

`MUST NOT` (no pseudo-success). `local-app` must not use mock auth, disabled
gates, anonymous subject fallback, fixture-mode success, direct daemon access,
or first-party self-declaration. It must not become
`local-first-party-app` by setting a mode string, app id, app instance id,
workspace profile, package metadata or Desktop launch metadata.

Cross-references: `P-SCAF-002` (A2/A4 final local-app split),
`P-SCAF-008` (generated app authoring command
family), `K-ACCSVC-001..K-ACCSVC-021` (Runtime account/session custody and
deny-all public-token boundary), `K-BIND-001..K-BIND-015` (scoped app binding
authority), `K-APP-017` (launch authority), `P-NAPP-013` / `P-NAPP-018`
(public admission and descriptor authority; not redefined).

## S-APP-017 — App Storage Partition Projection

`MUST`：the general Runtime facade may expose a typed storage projection only to
an independently admitted host/owner caller backed by Runtime `GetAppStorage`
(`K-APP-022`). For `LOCAL_APP`, the final `standardShell` carrier does not expose
`GetAppStorage`, absolute roots, or a storage-root accessor. Runtime and the
native host re-key private storage by the inherited principal/session context;
the app observes no principal id and cannot request any root.

The 0K checkpoint admits exactly `storage.readJson`, `storage.writeJson`, and
`storage.removeJson` on the protected local-app carrier. SDK exposes them as
`storage.readJson(relativePath)`, `storage.writeJson(relativePath, value)`, and
`storage.removeJson(relativePath)`. Each call is bound to the matching
`app_storage.json.read|write|remove` operation, the exact
`storage:<canonical-relative-json-path>` resource, and the current process-bound
session/grant. Runtime enforces a 240-byte canonical relative `.json` path, a
256 KiB document bound, a 16 MiB principal-partition quota, symlink/non-regular
file rejection, and idempotent remove. The SDK projects only JSON value,
`sizeBytes`, or `removed`; it rejects any root/path/authority field.

`data.pathResolve`, generic file operations, directory operations, binary
storage, caller-selected quota/root, and every other `storage.*` operation
remain typed unavailable.

`MUST NOT`：SDK must not read `<runtime_owner_state_root>/nimi.json`, parse Runtime config, or
concatenate `<nimi_data>/apps/<app-id>` as a local fallback. It must not accept
app id, project path, renderer metadata, manifest data, or an app-supplied
principal as a storage selector. Enforcement and storage truth remain
Runtime-owned.

## S-APP-018 — App Package Readiness Accessor

`MUST`：SDK must expose typed app package readiness access backed by Runtime
`GetAppPackageReadiness` (`K-APP-023`). In 0K, immutable package/install/update/
promotion readiness returns typed unavailable while preserving opaque lineage,
attestation, revision, execution-profile and digest slots inside Runtime. SDK
must not expose those opaque internal refs as a positive package assertion.

`MUST NOT`：SDK must not scan Runtime-owned install-evidence files, infer
package readiness from file existence, or treat Desktop / Kit bridge evidence
as canonical package truth. SDK orchestration here is non-authoritative: it
submits explicit typed requests to Runtime and maps the Runtime projection
without hiding fail-closed states.

## S-APP-019 — Account App-Inventory Truth Accessor

`MUST`：SDK exposes typed access, request builders, response parsers, and
decoders for Runtime `GetAccountAppInventory` (`K-APP-024`). The Runtime
request carries no app- or renderer-supplied `account_id`; Runtime resolves the
authenticated account binding and validates the projection.

`MUST`：account visibility and local record state remain separate. 0K local
states are `not-present`, `local-record-active`, `local-record-dormant`, and
`removed`; immutable package install state is unavailable until 0P/P. An
account verified row without local materialization remains a valid catalog row.

`MUST NOT`：SDK must not read
`~/.nimi/accounts/<account-id>/apps/inventory.json`, infer account directories,
or convert absent/corrupt inventory state into success. SDK helpers may
preserve the explicit `exists=false` response and parse present records, but
Runtime owns account app-inventory validation, writes, and fail-closed reason
codes.

## S-APP-020 — Unified Apps Inventory Composition

`MUST`：`NimiAppClient.list()` returns `NimiAppInventoryEntry[]`. Each entry
MUST carry:

- `appId` and display metadata;
- `sources.catalog?`, `sources.account?`, and `sources.local?`;
- closed `trustTier`, `installState`, `openReadiness`, `activeJobs[]`,
  `nextActions[]`, and typed `reasonCode/detail`.

`MUST`：catalog/account composition is deterministic by `appId`; distinct local
records are deterministic by their Runtime-issued opaque record reference and
must not merge merely because their display `appId` matches. A source failure is emitted as
a typed source-degraded projection and MUST NOT fabricate entries from another
source. Valid entries from other sources may remain visible only with the
source-degraded reason preserved.

`MUST NOT`：SDK must not collapse account entitlement, local records, and
ordinary catalog admission into a single boolean `installed` or `ready`; it
must not infer account visibility from install evidence or infer a local record
from file existence.

## S-APP-021 — Local App Record Projection

`MUST`：SDK exposes read-only typed status for the current host-injected
local-app carrier: trust class, record state, session state, grant posture and
typed reason. The projection omits `local_app_principal_id`, lineage, SID
partition, launch/process/session identifiers, grant identifiers/revisions,
digests and provenance-attestation refs.

`MUST NOT`：SDK exposes no workspace-adoption, install, import, promote or
repair accessor in 0K.
Immutable positive package materialization remains typed unavailable until 0P/P.
SDK/Desktop/apps must not scan workspaces or infer a record from a manifest,
path, app id or file existence.

## S-APP-022 - Local App Bootstrap Custody Boundary

`MUST`: the local-app SDK bootstrap accepts exactly one host-neutral
`standardShell` input and exposes session status, read-only permission posture,
explicit exact-operation permission request, plus the selected typed operations
admitted by `P-KIT-044`: Runtime artifact bytes and explicit
RuntimeAgent open-conversation, send-turn, subscribe-turn and
conversation-snapshot. It preserves typed carrier failures and treats a valid
zero-grant session as denied for those operations.

`permission.request` maps only to Runtime `RequestLocalAppGrant`, carries exact
operation/resource/purpose, and returns only redacted request posture. It never
returns request/challenge/grant/principal/record identifiers and cannot approve,
revoke, enumerate grants, or proxy an Account method.

`MUST NOT`: SDK input/output must not contain Runtime or Realm clients, account
caller posture, local-app principal/record/grant ids, launch binding/nonce,
launch host, release/capability refs, app session metadata, endpoint,
authorization, credential, ordinary gRPC, generic method-id/bytes forwarding,
or developer-registration fallback. Missing/unadmitted carrier or unavailable
operation family is a typed fail-closed result and cannot be replaced by
renderer metadata.

Cross-references: `P-SCAF-016` (scaffolded local-app binding custody),
`K-ACCSVC-022` / `K-ACCSVC-026` (local-app caller and operation posture),
`K-APP-017` (Runtime local-app launch authority), `P-KIT-044`
(local-app standard shell capability set).

## S-APP-023 - Desktop Open Intent Data Surface

`MUST`: SDK `@nimiplatform/sdk/app` exposes `NimiDesktopOpenIntent`,
`NimiDesktopOpenEnvelope`, parser, and type guard surfaces for the Platform
`P-DOPEN-*` Desktop Open Intent protocol.

`MUST`: SDK is the TypeScript semantic parser owner for Desktop Open Intent.
SDK parser behavior must match
`.nimi/spec/platform/kernel/tables/desktop-open-intent-golden-vectors.yaml`.

`MUST NOT`: SDK must not expose an opener, import Kit, Electron, Tauri, browser
globals, OS opener code, Desktop private bridge code, or Runtime private
boundaries. Apps call Desktop Open Intent through Kit standard shell hosts, not
through SDK.

`MUST NOT`: SDK Desktop Open Intent data must not carry auth/session/token,
provider/model/connector credential truth, Runtime caller identity, or
executable LocalAgent truth.

Cross-references: `P-DOPEN-*`, `P-KIT-045`, `D-IPC-018`, `D-SHELL-039`.

## Fact Sources

- `.nimi/spec/sdks/kernel/ai-config-surface-contract.md` — `S-AICONF-001..S-AICONF-006`
- `.nimi/spec/sdks/kernel/local-environment-projection-contract.md` — `S-RUNTIME-119`
- `.nimi/spec/sdks/kernel/surface-contract.md` — `S-SURFACE-*`
- `.nimi/spec/sdks/kernel/error-projection.md` — `S-ERROR-*`
- `.nimi/spec/sdks/kernel/nimi-permission-client-contract.md` — `S-PERM-001..S-PERM-010` (`S-PERM-010` records the S-APP-vs-S-PERM placement anti-target for the review-evidence accessor admitted at `S-APP-015`)
- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-001..P-NAPP-029`, `P-NAPP-033..P-NAPP-034` (`P-NAPP-015` storage policy, `P-NAPP-018` catalog descriptor shape, `P-NAPP-019` opaque immutable-package slots, `P-NAPP-025` review-decision schema, `P-NAPP-027`/`P-NAPP-028` storage posture, `P-NAPP-034` protected local-app launch)
- `.nimi/spec/platform/kernel/nimi-app-local-admission-contract.md` — `P-NAPP-030..P-NAPP-032`, `P-NAPP-035..P-NAPP-036` (`P-NAPP-030` listing closure, `P-NAPP-031` unified inventory, `P-NAPP-032` local record creation boundary, `P-NAPP-035..036` local-app development/principal kernel)
- `.nimi/spec/platform/kernel/app-permission-contract.md` — `P-PERM-001..P-PERM-011` (`P-PERM-002` closed scope enum, `P-PERM-006` cross-app authorization, `P-PERM-011` `app-local-drafts` qualifier semantics)
- `.nimi/spec/platform/kernel/nimi-app-audit-pipeline-contract.md` — `P-AUDIT-001..P-AUDIT-006` (`P-AUDIT-006` review-evidence shape)
- `.nimi/spec/platform/kernel/mod-extension-retirement-contract.md` — `P-MOEX-001..P-MOEX-006`
- `.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-app-trust-tiers.yaml`
- `.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md` — `P-AIPS-001..P-AIPS-013`
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — `P-AISC-001..P-AISC-007`
- `.nimi/spec/runtime/kernel/local-engine-runtime-environment-contract.md` — `K-LENG-024..K-LENG-027`
- `.nimi/spec/runtime/kernel/local-environment-materializers-contract.md` — `K-LENG-028`
- `.nimi/spec/runtime/kernel/app-lifecycle-contract.md` — `K-APP-014` (uninstall lifecycle), `K-APP-017` (launch gate), `K-APP-018` (Runtime-mediated file-API non-admission)
- `.nimi/spec/runtime/kernel/app-projection-contract.md` — `K-APP-022` (principal-keyed app storage), `K-APP-023` (opaque package seam), `K-APP-024` (account/local record inventory), `K-APP-025` (retired adoption path)
- `.nimi/spec/runtime/kernel/account-session-contract.md` — `K-ACCSVC-*` (Runtime account/session custody, local-app coordinator and removed public-token boundary consumed by `S-APP-016`)
- `.nimi/spec/runtime/kernel/scoped-app-binding-contract.md` — `K-BIND-*` (Runtime-issued scoped app binding authority consumed by `S-APP-016`)
- `.nimi/spec/platform/kernel/nimi-app-scaffolding-contract.md` — `P-SCAF-*` (generated-app helper naming, final local-app mode and no first-party self-declaration consumed by `S-APP-016`)
- `.nimi/spec/platform/kernel/desktop-open-intent-contract.md` — `P-DOPEN-*`
- `.nimi/spec/platform/kernel/tables/desktop-open-intent-golden-vectors.yaml`
