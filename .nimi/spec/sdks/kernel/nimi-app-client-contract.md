# SDK Nimi App Client Contract

> Owner Domain: `S-APP-*`

## Scope

定义 SDK 对 Platform `Nimi App` admission / registry / install / launch
authority 的 typed consumer surface。本契约确保 SDK 是 app / developer 对
Nimi App lifecycle 的唯一接入入口；Desktop hosted shell（D-HOME-004 /
D-HOME-005）通过 SDK projection 投影 Apps。

## S-APP-001 — Sole Admitted Access Path

`MUST`：SDK Nimi App client surface 是 app / developer / Desktop hosted
shell 对 Nimi App install / update / uninstall / launch / status /
health-repair 的唯一 admitted access path。

`MUST NOT`：app / developer / shell 不得：

- 绕过 SDK 直接读写 Platform `nimi-app-registry.yaml`
- 绕过 SDK 直接调用 Runtime app registration 私有 RPC
- 私自实现 installer / package-manager / source-selector 逻辑

## S-APP-002 — Logical Operation Set

`MUST`：SDK 暴露以下 logical operation：

- `app.list()` — 列出当前用户可见的 unified Apps inventory。该集合由
  Platform ordinary catalog source、Runtime authenticated account inventory
  source、Runtime local adoption source 合成；source 必须保留，不能互相推断。
- `app.get(appId)` — 获取单个 app inventory entry 与 source/state/action
  projection。
- `app.install(appId, options?)` — 触发 Platform-mediated install
  flow；返回 typed job projection。
- `app.update(appId)` — 触发 Platform-mediated update flow；遵守
  `P-PKGREL-007` 三 surface 独立性。
- `app.uninstall(appId)` — 触发 Platform-mediated uninstall flow。
- `app.launch(appId, scopeRef)` — 触发 Runtime-mediated launch；必须
  携带 canonical `AIScopeRef`（`P-AISC-001`）。
- `app.status(appId)` — 获取 app health/repair projection state。
- `app.subscribe(callback)` — 订阅 app lifecycle 事件；host-local
  event stream。
- `app.healthRepair(appId, action)` — 触发 repair flow，仅 admit 显式
  action token（cancel / retry / repair / reinstall）。

## S-APP-003 — Mandatory AIScopeRef On Launch

`MUST`：`app.launch(appId, scopeRef)` 必须接收 canonical `AIScopeRef`
（`P-AISC-001`、`S-AICONF-003`）。

`MUST NOT`：SDK 不得从 active chat、renderer-local current app、或默认
scope 隐式推断 launch scope；不得允许 caller 省略 `scopeRef`。

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

`MUST`：`app.subscribe(callback)` 仅承载 app lifecycle 事件流（installed /
updated / uninstalled / launching / launched / failed / repair-required
等 typed event）。

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
Account inventory and local adoption sources are admitted separately by
`S-APP-020` / `S-APP-021`; they MUST NOT be relabeled as ordinary catalog truth.

## S-APP-010 — Install Descriptor Verification

`MUST`：`app.install(appId, options?)` must resolve the admitted release
descriptor before any download. For external artifacts it must compute `sha256`
over downloaded bytes and compare it with the descriptor before unpacking,
registration, execution, or installed projection mutation.

`MUST NOT`：SDK must not perform direct `npm install`, `npx`, direct mutable
GitHub clone, source build/run, or lifecycle script execution as ordinary-user
install truth. Digest mismatch must fail closed and must not be projected as
partial success.

## S-APP-011 — Install Storage Projection

`MUST`：SDK install/uninstall/status projections must preserve the app storage
root split:

- release payloads: `<nimi_data>/apps/<app-id>/releases/<version>`
- durable data: `<nimi_data>/apps/<app-id>/data`
- cache: `<nimi_data>/apps/<app-id>/cache`
- temp: `<nimi_data>/apps/<app-id>/tmp`

Uninstall removes release payloads by default and keeps durable data unless the
user explicitly confirms destructive deletion.

## S-APP-012 — Declared Nimi-API Scopes Carrier

**Background fact.** The developer-authored manifest carries a
`permissions.declared_nimi_api_scopes` list of `{ scope, qualifier?,
purpose }` entries as transparency for review and UI, not as an enforcement
control. The admitted release descriptor's
`permissions_ref` (`P-NAPP-018`) and the per-tier
`permission_ceiling_ref` (`P-PERM-*`) remain the enforcement surfaces.

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
substitute for the `P-PERM-*` grant lifecycle, the per-endpoint
fail-closed enforcement at Runtime / Realm / Cognition, or the
per-tier `permission_ceiling_ref`. Apps and Apps-surface consumers
MUST NOT infer that a scope listed in this carrier is currently
granted; grant state is the typed return of `S-PERM-002`
`permission.list(scopeRef)` / `permission.status(scopeRef)`. A SDK
caller MUST NOT short-circuit a grant request, a grant subscription,
or a fail-closed denial on the basis of this carrier; doing so
collapses the parent `PI-W1-8` "transparency for review and UI; not
control" invariant.

`MUST NOT` (no developer-supplied enforcement claim). The carrier MUST
NOT admit developer-asserted entitlement, deny-list, or any
"manifest-claimed grant" projection that would suggest the manifest
itself controls runtime behavior. The carrier is a projection of the
admitted-for-review manifest content over the admitted descriptor; the
authoritative grant truth is `S-PERM-*`.

Cross-references: `P-NAPP-018` (descriptor `permissions_ref` field;
not redefined here), `P-PERM-002` (closed scope enum; not extended
here), `P-PERM-011` (`app-local-drafts` qualifier semantics; not
redefined here), parent invariant `PI-W1-8`.

## S-APP-013 — Uninstall Data-Retention Prompt Surface

**Background fact.** `K-APP-014` admits the `UninstallApp` lifecycle
behavior: by default the Runtime removes
`<nimi_data>/apps/<app-id>/releases/` and keeps
`<nimi_data>/apps/<app-id>/data/` durable; destructive deletion of
`data/` happens only when the caller explicitly confirms it.
`P-NAPP-015` admits the install storage policy. Parent invariant
`PI-W1-26` records that uninstall removes `<nimi_data>/apps/<app_id>/`
"after an explicit user choice on `data/` retention". The
admitted-behavior owners are Runtime (`K-APP-014`) and Platform
(`P-NAPP-015`); this rule admits the SDK CONSUMER surface only.

`MUST` (prompt-shape carrier surface). SDK Nimi App client surface
admits a typed prompt-shape interface that the calling app (or Apps
surface, or Desktop hosted shell) uses to surface the user-facing
data-retention choice before invoking `app.uninstall(appId, ...)`.
The admitted prompt-shape fields are:

- `appId` — admitted app identifier (`P-NAPP-002`);
- `data_path` — the projected
  `<nimi_data>/apps/<app-id>/data` path (the projection of the same
  Nimi-owned data root admitted by `P-NAPP-015`);
- `data_bytes` — typed integer projection of the
  `artifact.size.user_data` field (`P-NAPP-019`); the surface MUST
  expose this as a distinct integer and MUST NOT collapse it with
  release/cache/shared_deps sizes;
- `default_choice` — closed enum `retain | delete`, default `retain`
  (consistent with `K-APP-014` default-preserve posture);
- `user_choice` — closed enum `retain | delete`, the caller-confirmed
  value supplied back into `app.uninstall(appId, {retainData: <bool>})`;
- `confirmation_required` — boolean; `true` whenever `user_choice ===
  'delete'` because `K-APP-014` requires explicit confirmation for
  destructive `data/` deletion.

`MUST` (caller-binding). The SDK `app.uninstall(appId, options?)`
admitted at `S-APP-002` MUST accept an explicit boolean (or equivalent
closed-enum) retainData flag whose value is taken from the prompt
surface above. The SDK MUST forward the explicit user choice to the
Runtime `UninstallApp` call; the choice MUST NOT be inferred from
caller defaults, host-bridge implementation detail, or renderer-local
state.

`MUST NOT` (no redefinition of admitted behavior). This rule MUST NOT
redefine `K-APP-014` (the Runtime-side uninstall lifecycle), MUST NOT
redefine `P-NAPP-015` (the install-storage policy), and MUST NOT
redefine `P-NAPP-019` (the `artifact.size` typed sub-object). The
default-preserve posture and the destructive-only-with-confirmation
posture both remain owned by `K-APP-014`; this rule admits only the
SDK consumer-side typed projection used to surface the user choice
back into that admitted call. Collapsing the prompt into a generic
"confirm uninstall" boolean fails closed against this rule; silently
defaulting `user_choice` to `delete` (i.e. omitting the explicit user
selection step) is a forbidden pseudo-success projection.

`MUST NOT` (no parallel-truth uninstall path). The SDK MUST NOT
expose any uninstall path that bypasses `app.uninstall(appId, ...)`
admitted at `S-APP-002`. Apps MUST NOT obtain a "force delete data"
shortcut that calls Runtime directly or that manipulates
`<nimi_data>/apps/<app-id>/data/` outside the Runtime-mediated
uninstall flow.

Cross-references: `K-APP-014` (Runtime uninstall lifecycle; not
redefined), `P-NAPP-015` (install storage policy; not redefined),
`P-NAPP-019` (`artifact.size.user_data` typed sub-field; not
redefined), `S-APP-002` (`app.uninstall(appId, options?)` logical
operation; this rule binds its `options` argument), `S-APP-011`
(install storage projection — this rule is the explicit
choice-surfacing complement), parent invariant `PI-W1-26`.

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
Runtime-mediated file API. Therefore the SDK MUST NOT map
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
- `decided_at` — terminal-decision timestamp distinct from the other
  lifecycle dates per `P-NAPP-019`.

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
`P-NAPP-019` (date-distinctness for `decided_at`; not redefined),
`K-APP-017` (launch gate authority; not driven by this accessor),
`P-AUDIT-001` (admission gate authority; not driven by this
accessor), `S-PERM-010` (anti-target rule recording that the
review-evidence accessor is NOT in S-PERM), parent invariants
`PI-W3-34`, `PI-W2-21`, `PI-W2-22`.

## S-APP-016 — Generated-App Runtime Platform Client Auth Helper

**Background fact.** Platform `P-SCAF-*` admits Nimi app scaffolding and
requires generated apps to consume SDK/Runtime auth/session authority without
self-declaring first-party status, owning tokens, or calling Realm login routes.
Runtime `K-ACCSVC-*` owns local account session truth and first-party
short-lived access-token projection; Runtime `K-BIND-*` owns scoped app binding;
Runtime `K-APP-*` owns app launch / lifecycle projection. This rule admits the
SDK generated-app helper surface only and keeps product trust tier separate from
Runtime local developer registration.

`MUST` (exported names). SDK admits the following exact public exported names
for generated Nimi app auth/client construction:

- `createNimiAppRuntimePlatformClient`;
- `NimiAppRuntimePlatformClientInput`;
- `NimiAppAuthMode`;
- `NimiAppAuthProjection`;
- `NimiAppAuthUnavailable`;
- `NimiAppDeveloperSession`.

`MUST` (mode set). `NimiAppAuthMode` is a closed mode set:

- `first-party-local-app`;
- `developer-registered-local-app`;
- `third-party-nimi-app`;
- `dev-standalone`.

`MUST` (`first-party-local-app`). `first-party-local-app` is admitted only for
true local first-party apps whose caller registration is admitted by Runtime app
registry / admission policy as first-party. This mode may consume
`RuntimeAccountService` account status and first-party short-lived access-token
projection only under `K-ACCSVC-*` exact registration policy. Shape-only app id,
workspace folder presence, generated scaffold state, or app-local spec presence
is not enough to enter this mode.

`MUST` (`developer-registered-local-app`). `developer-registered-local-app` is
the local development mode for generated / non-first-party Nimi Apps launched
with `pnpm dev:shell`. It may use Runtime-owned account custody, browser login,
account projection, Runtime app session, and scoped binding only after
Runtime's developer-registration double gate admits the app. It MUST NOT call
`RuntimeAccountService.GetAccessToken` or any first-party helper as a
self-declared first-party path.

`MUST` (`third-party-nimi-app`). `third-party-nimi-app` is the generated app
mode for third-party Nimi Apps. It consumes Runtime-issued app session and/or
scoped app binding surfaces admitted by Runtime authority. It MUST NOT call
`createLocalFirstPartyRuntimePlatformClient`, `RuntimeAccountService.GetAccessToken`,
or any first-party-local helper as a self-declared first-party path.

`MUST` (`dev-standalone`). `dev-standalone` uses an explicit
`NimiAppDeveloperSession` supplied by developer tooling or Runtime development
registration. If Runtime support or developer session material is absent,
`createNimiAppRuntimePlatformClient` MUST return or expose a typed unavailable
projection using `NimiAppAuthUnavailable`. The unavailable state is fail-closed
and must name the missing support; it is not a disabled auth gate or a mock
success.

`MUST` (projection). `NimiAppAuthProjection` must distinguish authenticated /
session-bound, unavailable, and action-required states without collapsing them
to generic success or generic unavailable. `NimiAppAuthUnavailable` is the
typed fail-closed branch for absent Runtime support, missing developer session,
registration mismatch, custody unavailable, or unavailable scoped binding.

`MUST NOT` (no app-owned auth truth). No mode may accept app-owned access
tokens, refresh tokens, session stores, subject providers, direct Realm login
credentials, refresh-token providers, raw JWTs, decoded subject fields, or any
app-controlled token custody as input.

`MUST NOT` (no Realm login bypass). Generated third-party auth must not call
`/api/auth/login`, `/api/auth/refresh`, SDK Realm login routes, or direct Realm
token exchange as app auth truth. Realm data access, when admitted for a caller,
must come through Runtime-issued short-lived projection or scoped app/session
authority, not app-owned login.

`MUST NOT` (no pseudo-success). `dev-standalone` must not use mock auth,
disabled auth gates, anonymous subject fallback, fixture-mode success, or
first-party self-declaration. `third-party-nimi-app` and
`developer-registered-local-app` must not become `first-party-local-app` by
setting a mode string, app id, app instance id, or workspace profile flag.

Cross-references: `P-SCAF-002` (A2/A4 accepted mode split and fail-closed
dev-standalone requirement), `P-SCAF-008` (generated app authoring command
family), `K-ACCSVC-001..K-ACCSVC-021` (Runtime account/session and short-lived
access-token authority), `K-BIND-001..K-BIND-015` (scoped app binding
authority), `K-APP-017` (launch authority), `P-NAPP-013` / `P-NAPP-018`
(public admission and descriptor authority; not redefined).

## S-APP-017 — App Storage Truth Accessor

`MUST`：SDK must expose a typed app storage projection accessor backed by
Runtime `GetAppStorage` (`K-APP-022`). The projection carries app id, typed
storage state, app root, durable data root, cache root, temp root, optional
active release root/version, storage policy ref, and typed reason/detail.

`MUST`：the accessor is the official shortcut for apps, Desktop hosted shell,
and developer tooling to obtain app storage truth. It preserves `S-APP-011`
root split and may return data/cache/tmp for a runtime-registered developer app
before any ordinary active release exists.

`MUST NOT`：SDK must not read `~/.nimi/nimi.json`, parse Runtime config, or
concatenate `<nimi_data>/apps/<app-id>` as a local fallback. SDK path helpers
may validate app-relative paths against the returned roots, but enforcement and
storage truth remain Runtime-owned.

## S-APP-018 — App Package Readiness Accessor

`MUST`：SDK must expose typed app package readiness access backed by Runtime
`GetAppPackageReadiness` (`K-APP-023`). SDK app-client status helpers may
compose Platform registry / release descriptor rows with this Runtime
projection to produce developer-friendly `AppLaunchReadiness`, installed
version, available version, verification state, and reason/detail fields.

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

`MUST`：schema version 2 separates account visibility (`verified` /
`entitled` / `disabled` / `removed` / `revoked`) from local materialization
(`not-installed` / `installed` / `adopted-local` / `removed`). An account
verified row with `not-installed` is a valid Apps inventory entry.

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

`MUST`：composition is deterministic by `appId`. A source failure is emitted as
a typed source-degraded projection and MUST NOT fabricate entries from another
source. Valid entries from other sources may remain visible only with the
source-degraded reason preserved.

`MUST NOT`：SDK must not collapse account entitlement, local adoption, and
ordinary catalog admission into a single boolean `installed` or `ready`; it
must not infer account visibility from install evidence or infer local adoption
from file existence.

## S-APP-021 — Local App Adoption Accessor

`MUST`：SDK exposes Runtime `AdoptLocalApp`, `ListLocalAppAdoptions`, and
`RemoveLocalAppAdoption` typed accessors. Local adoption is explicit:
the caller supplies a user-selected root and optional expected app id; Runtime
validates `nimi.app.yaml` / `nimi.app.json` and writes Runtime-owned adoption
truth only after validation passes.

`MUST NOT`：SDK/Desktop/apps must not scan workspaces, source trees, package
manager installs, or app-local specs to manufacture Apps inventory entries.
Local adoption is not Platform public admission and MUST NOT bypass Runtime
OpenApp permissions, AIConfig, storage, account/session, or manifest gates.

## S-APP-022 - Installed-App Bootstrap Custody Boundary

`MUST`: SDK installed-app bootstrap helpers consume Runtime/Desktop launch
binding only as a projection of `K-ACCSVC-022` and `K-APP-017`. The helper
surface may map host-owned launch binding into typed SDK/Runtime account
caller inputs, but it is a consumer of Runtime/Desktop truth, not an owner.

`MUST`: when a generated third-party app uses an installed-app SDK bootstrap
path, the app-owned renderer source must receive a host-owned installed-app
bridge projection. The renderer source must not construct, persist, or pass
`launchNonce`, `releaseDescriptorRef`, or `launchBinding` as app-supplied
truth.

`MUST NOT`: SDK installed-app bootstrap must not accept renderer-owned access
tokens, session stores, raw auth metadata, descriptor refs, launch nonces,
host ids, or caller posture as trust-bearing input from generated app code.
Absent host binding, missing descriptor binding, digest/install evidence
mismatch, or unavailable Runtime `OpenApp` projection is a typed fail-closed
state and must not fall back to developer registration.

Cross-references: `P-SCAF-016` (scaffolded installed-app binding custody),
`K-ACCSVC-022` (Desktop-launched installed Nimi App caller posture),
`K-APP-017` (Runtime OpenApp launch-resolution authority), `P-KIT-044`
(installed app standard shell capability set).

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
- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-001..P-NAPP-032` (`P-NAPP-015` storage policy, `P-NAPP-018` descriptor shape, `P-NAPP-019` typed sizes/dates, `P-NAPP-025` review-decision schema, `P-NAPP-027`/`P-NAPP-028` storage posture, `P-NAPP-031` unified inventory, `P-NAPP-032` local adoption)
- `.nimi/spec/platform/kernel/app-permission-contract.md` — `P-PERM-001..P-PERM-011` (`P-PERM-002` closed scope enum, `P-PERM-006` cross-app authorization, `P-PERM-011` `app-local-drafts` qualifier semantics)
- `.nimi/spec/platform/kernel/nimi-app-audit-pipeline-contract.md` — `P-AUDIT-001..P-AUDIT-006` (`P-AUDIT-006` review-evidence shape)
- `.nimi/spec/platform/kernel/mod-extension-retirement-contract.md` — `P-MOEX-001..P-MOEX-006`
- `.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-app-trust-tiers.yaml`
- `.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md` — `P-AIPS-001..P-AIPS-013`
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — `P-AISC-001..P-AISC-007`
- `.nimi/spec/runtime/kernel/local-engine-contract.md` — `K-LENG-024..K-LENG-028`
- `.nimi/spec/runtime/kernel/app-messaging-contract.md` — `K-APP-014` (uninstall lifecycle), `K-APP-017` (launch gate), `K-APP-018` (Runtime-mediated file-API non-admission), `K-APP-022` (app storage), `K-APP-023` (package readiness), `K-APP-024` (account app-inventory), `K-APP-025` (local adoption)
- `.nimi/spec/runtime/kernel/account-session-contract.md` — `K-ACCSVC-*` (Runtime account/session and short-lived access-token projection authority consumed by `S-APP-016`)
- `.nimi/spec/runtime/kernel/scoped-app-binding-contract.md` — `K-BIND-*` (Runtime-issued scoped app binding authority consumed by `S-APP-016`)
- `.nimi/spec/platform/kernel/nimi-app-scaffolding-contract.md` — `P-SCAF-*` (generated-app auth helper naming, auth modes, dev-standalone fail-closed posture, and no first-party self-declaration consumed by `S-APP-016`)
- `.nimi/spec/platform/kernel/desktop-open-intent-contract.md` — `P-DOPEN-*`
- `.nimi/spec/platform/kernel/tables/desktop-open-intent-golden-vectors.yaml`
