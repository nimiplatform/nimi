# Platform App Ecosystem - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/platform/app-ecosystem.authority.yaml`。

---

<!-- source: .nimi/spec/platform/kernel/agent-identity-floor-contract.md -->

# Agent Identity Floor Contract

> Owner Domain: `P-AGID-*`

## Scope

定义跨 app agent identity 的 platform-level floor。本契约固定：agent identity 不是 app-local
truth；apps 接收 account-scoped durable identity 的 projection。本契约不
拥有 chat transcript / `ConversationAnchor` 实现细节（仍由 Runtime 与
Desktop-hosted Home 拥有），也不拥有 Cognition memory access 政策（属
`C-APMEM-*`）。

## P-AGID-001 — Account-Scoped Durable Identity

`MUST`：agent identity 是 account-scoped durable truth，canonical owner
是 Realm。admitted identity primitive 至少包含：

- `AgentFamilyId` — agent family 标识。
- `AgentPersonaId` — persona 标识。
- `AgentProjectionRef` — 某 app 对某 persona 的 projection 引用。

`MUST NOT`：apps 不得自定义/持久化平行 identity schema。

## P-AGID-002 — Family / Persona / Projection Semantics

`MUST`：family / persona / projection 三层关系固定为：

- 一个 family 可拥有多个 persona。
- 一个 persona 可被多个 app projection 引用。
- projection 是 app-app 隔离的 identity 视图，绑定 Runtime-derived app
  principal、owner-issued selector 与对应 public permission decision
  (`P-PERM-*`)。

`MUST NOT`：apps 不得通过 cache、约定、或 inferred channel 在不同 app
之间共享 persona 的 raw identity material；persona 共享必须经 Realm 投影。

## P-AGID-003 — App-Specific Projection

`MUST`：每个 app 对某 persona 收到的 projection 是稳定的、selector-bound
的、可撤销的。projection 绑定到 Runtime-derived app principal 与 owner-issued
selected-Agent handle；app 不得提交 app/account/principal/agent raw identity
作为授权事实（`P-PERM-007`）。

`MUST NOT`：app 不得跨 principal 或 selector 重用 projection；projection
lifetime 与对应 public permission decision 和 owner policy 绑定。

## P-AGID-004 — ConversationAnchor Continuity Binding

`MUST`：agent chat 会话必须绑定到 Runtime `ConversationAnchor`，跨
surface 续会语义沿用现有 Runtime 合同
（`runtime-agent-service-contract.md`）。

`MUST NOT`：Home / Desktop / SDK 不得将 anchor binding 改为 renderer-local
state 或 chat-local cache。

## P-AGID-005 — No App-Local Mint

`MUST NOT`：apps、shell、SDK consumer 都不得：

- 自创 `AgentFamilyId` / `AgentPersonaId` / `AgentProjectionRef`
- 把 app-local user state 直接写入 Realm 的 canonical identity 字段
- 在缺少 projection 的情况下使用 persona 字符串作为 identity 默认

## P-AGID-006 — Agent Chat Transcript / History Owner

`MUST`：agent chat transcript / history 的 owner 是 Desktop-hosted Home
shell（`D-HOME-006`）。Home shell 拥有 transcript display / replay /
local cache，但其内容不构成 memory truth。

`MUST NOT`：transcript / history cache 不得：

- 被自动升格为 Cognition memory（必须经 `chat_derived.projection.admitted`
  policy，参见 `C-APMEM-003`）
- 被外部 app 直接读取（必须经 `P-PERM-*` 与 `C-APMEM-*` 授权）

## P-AGID-007 — Chat-Derived Memory Projection Rule

`MUST`：chat context → memory truth 的转换必须由 `C-APMEM-003` 的
`chat_derived.projection.admitted` policy 触发，且
projection record 必须携带 `ConversationAnchor` 引用、source app id、
target persona id、与 Realm audit event 引用。

`MUST NOT`：不得通过 background job / passive cache / chat replay 自
动产生 memory truth。

## P-AGID-008 — Projection Lifecycle

`MUST`：projection lifecycle 与 grant lifecycle 同源：

- app uninstall → projection 失效
- permission grant revoke → 对应 projection 失效
- account 退出 → 所有 projection 失效

`MUST NOT`：projection 不得 orphan；缺乏 grant 的 projection 必须 fail
closed。

## Fact Sources

- `.nimi/spec/platform/kernel/ai-scope-contract.md` — `P-AISC-001..P-AISC-005`
- `.nimi/spec/platform/kernel/nimi-home-contract.md` — `P-HOME-001..P-HOME-010`
- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-001..P-NAPP-011; P-NAPP-013..P-NAPP-015; P-NAPP-018..P-NAPP-029`
- `.nimi/spec/platform/kernel/nimi-app-local-admission-contract.md` — `P-NAPP-030..P-NAPP-032`
- `.nimi/spec/platform/kernel/app-permission-contract.md` — `P-PERM-001..P-PERM-010`
- `.nimi/spec/cognition/kernel/app-memory-access-contract.md` — `C-APMEM-001..C-APMEM-008`
- `.nimi/spec/sdks/kernel/nimi-permission-client-contract.md` — `S-PERM-001..S-PERM-008`
- `.nimi/spec/desktop/shell-ui.authority.yaml` — `rule.nimi.desktop.shell-ui.r049..r061`
- `.nimi/spec/desktop/agent-projection.authority.yaml` — `D-LLM-022..D-LLM-026`

---

<!-- source: .nimi/spec/platform/kernel/app-permission-contract.md -->

# Nimi App Permission Contract

> Owner Domain: `P-PERM-*`

## Scope

This contract defines the single product-facing authority model for third-party
Nimi Apps. It governs only access to protected resources owned by Nimi, Realm,
Agent, Cognition or another app. An app's own product domain, ordinary OS
rights, publishing review, launch approval, session health, product routes, AI
routing and usage metering are not user permissions.

## P-PERM-001 Product-Facing Permission Vocabulary

Platform owns the only public permission vocabulary through
`tables/nimi-app-permission-catalog.yaml`. A public permission describes one
user-recognizable product intent, not an RPC, endpoint, scope family, table,
file path or internal resource fingerprint. Each permission has exactly one
canonical decision owner. Backend owners may expand it into exact internal
checks, but may not expose a parallel public vocabulary.

## P-PERM-002 Closed Catalog And Current Admission

The public permission id set is exactly the `public_permissions` section of the
catalog. An id is requestable only when both `admission: admitted` and
`manifest_allowed: true`. The current admitted set is empty; all sixteen rows
are reserved. Apps that need only base entitlements, app-owned authority and OS
rights remain fully runnable. Unknown ids, reserved ids, old scopes, Runtime
operation ids and endpoint strings fail closed.

A row may move to admitted only as part of the complete P-PERM-017 slice. A
catalog edit, manifest declaration, CRUD endpoint or mock approval UI alone is
not admission.

## P-PERM-003 Public Posture And Owner Lifecycle

The app-facing posture is the closed set `prompt | pending | granted | denied |
unavailable`. Apps may query their own posture and request one admitted
permission with a user-facing reason. They cannot approve, revoke, mint, carry
or inspect owner-internal decision records.

A durable owner lifecycle, when admitted, uses monotonic revisions and the
closed internal states `pending | granted | denied | expired | revoked`.
Expired/revoked history is owner and audit truth, not an app workflow API.
There is currently no positive Runtime local permission lifecycle or store.

## P-PERM-004 Audit

Every admitted durable decision transition and every one-shot handle issuance
or consumption emits an owner audit event. It binds the owner-derived subject,
calling app principal, display app id, public permission id, selector digest,
old/new posture or one-shot action, trigger, timestamp and owner revision.
Protected operation/resource identities may appear only in protected owner
audit. Credentials, raw tokens and reusable proofs are never logged.

Audit events must not be silently coalesced across decisions. Missing audit or
unavailable audit persistence fails the affected positive path closed.

## P-PERM-005 Fail-Closed Evaluation

`user_permission` requires an admitted id, manifest eligibility, current owner
decision, owner-issued selector, exact permission-to-operation mapping and the
domain owner's current resource policy. Any missing, denied, expired, revoked,
mismatched or unavailable fact denies the operation. Publisher tier, review,
first-party identity, provenance and session existence do not widen it.

`base_entitlement` never fails merely because no user permission exists, but
still enforces its principal/session/account/path/quota boundary.
`one_shot_consent` requires an owner-issued non-forgeable handle; a caller-
supplied resource id is not proof.

## P-PERM-006 Cross-App Resources

There is no generic durable cross-app grant. A source app or canonical resource
owner must explicitly export through an admitted broker. The user selects one
resource in an owner-controlled picker, producing a bounded one-shot handle
audited against source app, target app and resource owner. Shared files,
sockets, host bridge details and path conventions cannot substitute for this
flow. `shared_resources.open` remains reserved until the full broker exists.

## P-PERM-007 Public Request Shape

Manifest declaration is exactly `{ id, reason }`. Runtime request is exactly
`{ permissionId, reason }`. `reason` is bounded explanatory text and carries no
authority. App id, account, OS-user anchor and principal come from the protected
carrier. Any selector comes from the catalog's canonical owner picker.

Public manifests, SDKs, Kit bridges and ordinary UI must not expose scope
family/name, qualifier, operation id, resource ref, selector digest, decision
id, account/principal/session identity, token or credential.

## P-PERM-008 AI Metering Is Policy

Every cloud or local AI execution emits typed usage and obeys Runtime budget,
rate, route and credential policy. Metering is mandatory owner policy, not a
permission the app requests or the user disables. Background continuation is a
different product intent represented by reserved `ai.background`; it remains
unavailable until activity visibility, budget ceiling and cancellation exist.

## P-PERM-009 First-Party Product Authority

Built-in Nimi products use exact service entitlements admitted by their own
Platform/Runtime/Realm/Cognition contracts. Such entitlements are not synthetic
third-party permissions and are never seeded into a local or Realm permission
ledger. First-party status does not widen a third-party permission or bypass OS
privacy, user preferences, account policy or owner checks.

## P-PERM-010 Backend Ownership

Realm retains cloud account, OAuth, Realm-owned decisions, domain data and
endpoint enforcement. Runtime retains local identity/session, Runtime-owned
decisions and local endpoint enforcement. Cognition retains memory/knowledge
policy. Platform standardizes the product catalog and projection only; it does
not copy backend truth. One user intent must not trigger duplicate approvals by
multiple owners.

## P-PERM-011 App-Private Storage

An app does not ask Nimi for permission to use its own SQLite, JSON store,
media, settings, cache or product routes. Runtime-mediated private JSON is a
`base_entitlement` constrained to the live calling principal/account partition,
canonical relative paths, quota and escape/symlink policy. Native app storage
is `app_owned_authority` under actual OS rights and disclosed sandbox posture.

External files are different: reserved `files.open` and `files.save` use one-
shot native picker handles. Another app's resources use
`shared_resources.open`. None creates a generic filesystem permission.

## P-PERM-012 Product Preferences

First-party preferences such as Zhiyu proactive interruptibility configure an
already-admitted product surface. They are not third-party permissions. Signed-
out, disabled, suppressed or unavailable owner state must produce typed
suppression. Reserved notification permissions cannot be inferred from a
first-party preference.

## P-PERM-013 Local Identity And Permission Separation

Project/package approval creates only a random, non-reused local principal and
provenance record. Launch creates only a process-bound session. Neither creates
or widens a permission. A valid zero-permission session may read its own public
permission posture and use base entitlements; it may not enumerate protected
Agent/account/resource inventory to manufacture a selector.

If a Runtime-owned permission is later admitted, its owner lifecycle binds the
OS-user anchor, current account, opaque app principal, public permission id and
owner selector digest. Every protected endpoint re-reads that current decision
and owner policy. Display app id and trust tier are never positive keys.

## P-PERM-014 Realm Source Materialization Is A First-Party Product Operation

`realm.source_materialize` is an authenticated
first-party product operation, not a third-party permission or synthetic
grant. Runtime uses its current Realm account, one typed
`CharacterSourceRefV3` and a fresh audience-bound challenge. Realm reloads
canonical source/world/dependency truth and current visibility/readiness, then
returns a short-lived signed Packet v3. Runtime verifies current JWKS, purpose,
audience, challenge, source, closure, limits, replay and account generation
before an atomic commit.

The flow accepts no app id, permission id, scope, qualifier, `accessGrantId`,
decision id or caller-selected Realm endpoint.
Runtime must never request and approve a Realm grant with the same account bearer. The retired
`realm_source.snapshot.consume` and `realm_source.snapshot.bind` are
non-authorizing and forbidden from positive implementation or evidence.
The public `agents.interact` permission applies only after a LocalAgent exists and
only after that separate permission is admitted; it is not an input to source
materialization.

## P-PERM-015 Five Authority Classes

Every app action resolves to exactly one class:

| Class | Meaning | Manifest | User prompt | Durable permission row |
|---|---|---:|---:|---:|
| `base_entitlement` | Calling principal's bounded Nimi-private surface | forbidden | forbidden | forbidden |
| `user_permission` | Durable access to protected owner resources | admitted id only | just in time | owner lifecycle |
| `one_shot_consent` | One explicit owner-picker selection | admitted id only | per selection | forbidden |
| `app_owned_authority` | App host's own product/storage/commands | forbidden | forbidden by Nimi | forbidden |
| `os_right` | Authority actually granted by the OS/sandbox | forbidden | OS-owned if applicable | forbidden |

The classes are mutually exclusive. Review, launch, route availability and
feature flags are not a sixth permission class. App-owned commands must not
proxy protected Nimi operations; protected operations must not be mislabeled as
app-owned or base entitlements.

## P-PERM-016 Public Intent Versus Internal Enforcement

One public permission may expand internally into many exact operations,
resource provenance checks, quotas, budgets, rate limits and owner policies.
For example `agents.interact` represents one selected-Agent intent while the
owner still enforces projection, conversation, text/voice and derived-artifact
boundaries on every call.

Users must not approve RPC methods, conversation anchors, turns, streams or
internal file operations one by one. Apps and renderers cannot construct or
display internal operation/resource identities. Least privilege remains exact
inside the owner while the product surface stays human-comprehensible.

## P-PERM-017 Admission Completeness And UX Budget

A public permission is admitted only when all of these land atomically:
catalog row, one decision owner, manifest validation, owner selector, durable
decision or one-shot proof, closed internal mapping, enforcement at every
endpoint, SDK/Kit surface, just-in-time approval UI, audit, negative tests and
real positive evidence. Durable permissions additionally require settings and
revoke UI. One-shot consent instead requires exact preview/selection display,
expiry, single consumption, cancellation and replay rejection; it must not
create a durable settings row.

The product UX budget is one decision per recognizable intent and selected
resource set. Install-time permission walls, method-level prompts, hidden
scope/qualifier editors, raw resource ids and duplicate Runtime/Realm approvals
are forbidden. A normal app using only its own data must launch with zero Nimi
permission prompts.

## Fact Sources

- `.nimi/spec/platform/kernel/tables/nimi-app-permission-catalog.yaml`
- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md`
- `.nimi/spec/runtime/kernel/grant-service.md`
- `.nimi/spec/runtime/kernel/account-session-contract.md`
- `.nimi/spec/sdks/kernel/nimi-permission-client-contract.md`
- `.nimi/spec/realm/external-realm.md`
- `.nimi/spec/cognition/kernel/app-memory-access-contract.md`

---

<!-- source: .nimi/spec/platform/kernel/nimi-app-local-admission-contract.md -->

# Nimi App Local Admission Contract

> Owner Domain: `P-NAPP-*`

## Scope

Defines the Apps listing/inventory, PC-local record, provenance, and Developer
Mode portion of `P-NAPP-*`. Verified catalog/release and protected-launch
authority and shared owner allocation remain in `nimi-app-admission-contract.md`;
both documents belong to the same Platform owner domain.

## P-NAPP-030 — Listing Closure Field Set

`MUST`：the Apps listing predicate admitted by `P-NAPP-009` is
composed, at projection time, from the following typed conjunction:

- `admission_status` equals `admitted`; AND
- `ordinary_visibility` equals `ordinary-visible`; AND
- the registry row resolves the following six fields against their
  admitted refs:
  - `trust_tier_ref` (`P-NAPP-004` floor),
  - `package_kind` (`P-NAPP-001`),
  - `release_descriptor_ref` (`P-NAPP-014`),
  - `permission_requirements` (`P-PERM-007`; an empty list is resolved),
  - `runtime_registration_mode` (`P-NAPP-006`),
  - `storage_policy_ref` (`P-NAPP-015` / `P-NAPP-027`); AND
- no host, runtime, or Realm projection emits a fail-close on the row
  marking it `unsupported` or `blocked`.

The conjunction is the explicit listing-closure field set; this rule
records its composition but does not redefine `P-NAPP-009`. Removing
any conjunct fails the row out of `ordinary-visible` projection per
the existing `P-NAPP-009` `MUST` body.

`MUST NOT`：this rule MUST NOT introduce a new listing predicate
parallel to `P-NAPP-009`. The Apps `ordinary-visible` projection has
a single admitted predicate (owned by `P-NAPP-009`); this rule is
the explicit field-set composition that predicate evaluates over.

`MUST NOT`：the listing predicate MUST NOT be reduced to a subset of
the six resolved-field conjuncts. Each conjunct is independently
required; collapsing two (e.g. treating `permission_requirements`
resolution as implied by `release_descriptor_ref` resolution) fails
the row out of `ordinary-visible` projection by violating the
admitted conjunction.

## P-NAPP-031 — Unified Apps Inventory Source Model

`MUST`：Desktop/SDK inventory preserves distinct owner projections:

- `catalog` — Platform verified discovery/release metadata;
- `account` — Runtime-authenticated account eligibility projection;
- `local_record` — Runtime K-APP local principal/lifecycle projection.

Source identity remains inspectable. Joining rows by display `app_id` cannot
merge principals, permission posture, storage, audience, or sessions. Catalog,
account, local record, and current permission posture are separate facts and no
inventory composer may turn one into another.

## P-NAPP-032 — Local Record Creation Boundary

A mutable project enters only through `local_development`; an immutable package
remains typed unavailable until 0P admits the package-to-opaque-lineage mapping.
Workspace adoption, workspace scanning, file presence, npm/npx installation,
cloned source, process liveness, or app-local specs cannot create a principal,
record, provenance, permission decision, launch lease, or session. No alias or
inventory-only record may provide another positive path.

## P-NAPP-035 — Production Developer Mode And Local Development

`local_development` is the sole mutable third-party provenance class and uses
the same principal, launch/session, permission, and owner-operation coordinator
as immutable classes. The global Developer Mode toggle grants nothing. A
project's first authorization requires fresh presence and an explicit
`run_once` or `allow_project` decision.

Authorization binds canonical project-root file identity, declared app id,
permission-requirement fingerprint, current account, fixed shell/entry policy,
and development authorization. The top-level `permissions` list contains only
closed public `{ id, reason }` requirements admitted by `P-PERM-002`; it is
request eligibility only and never substitutes for an owner-issued selector or
permission decision. The current admitted list is empty, so a non-empty local
manifest fails before project approval. Every build/host replacement receives a
new lease, process binding, and local-app session. Controlled HMR/rebuild/restart,
supervisor replacement, Desktop restart, and Runtime restart/upgrade/reinstall
may reuse `allow_project` without repeated consent while the canonical project,
account, permission-requirement fingerprint, shell/entry policy, and risk
disclosure revision remain exact. Runtime boot epoch and supervisor-run identity
are technical-session inputs and never durable consent inputs. Account switch,
mode-off, supervisor end, and Runtime replacement revoke live carriers but do
not revoke exact `allow_project` consent. Revoke, root/app/account/permission-
requirement/shell/entry mismatch, risk expansion, copied project, or integrity
failure invalidates or requires fresh approval for the applicable authority.

The Runtime-owned `allow_project` consent row lives under the stable protected
service authority root, outside candidate-, acceptance-round-, and selected
product-data roots. Candidate installation may rebuild candidate-local
principal/record projections from that row, but must not replace, copy, or
reinterpret the consent store.

The public permission-requirement list may be empty. An application that uses only
its own native host, app-owned OS storage, or the bounded app-private storage
base entitlement is still a valid local-development project. App-private base
entitlements and exact app-owned host commands are not inserted into the
permission-requirement fingerprint; changes to the native host remain
covered by the existing host/payload digest, shell/entry, process, and project
generation bindings. After a public permission is atomically admitted, any
change to the manifest permission-requirement list changes the fingerprint and
requires the existing reapproval flow.

`allow_project` remains Runtime-owned when mode is off, the account is absent,
or no supervisor is running; it never auto-runs. A later explicit dev launch
reuses it without presence only after exact binding verification. `run_once`
ends with the supervisor run or any invalidation trigger. Development may use a controlled production
account through Runtime-mediated APIs but receives no token, bearer, stronger
permission, or persistent Nimi-managed logon/boot autostart. UI must disclose
that Nimi permissions constrain Nimi APIs, not all ordinary OS rights of native
development code under the selected launch profile. For the admitted Windows
row this preserves the current disclosure about ordinary Windows rights.
The renderer receives no raw filesystem, account, credential, partition, or
generic host proxy. Electron and Tauri may register exact app-owned commands in
the native host; those commands are app authority, not Nimi permissions, and may not
tunnel protected Runtime/Realm operations.

## P-NAPP-036 — Closed Local Provenance And Principal Relationship

`tables/nimi-app-local-trust-classes.yaml` is the executable authority for the
closed `verified | user_imported | local_development` third-party provenance
set, transition seams, bundled-component exclusions, and principal
relationship. Trust class is Runtime-derived record state and has no Nimi API
permission effect. A caller/request cannot select or upgrade it.

The security subject is Runtime's random/non-reused
`local_app_principal_id`, partitioned by Runtime-derived
`local_os_user_anchor`. Opaque immutable lineage, attestation refs,
provenance revision, execution-profile ref, and host/payload digest slots are
frozen by 0K. 0P may map package and attestation inputs into those slots but
cannot rename or reshape them. Promotion invalidates leases/sessions and never
creates a permission decision. Shipped Zhiyu remains bundled; its integration build is an isolated
development principal.

---

<!-- source: .nimi/spec/platform/kernel/macos-protected-local-admission-contract.md -->

# macOS Protected-local Admission Contract

> Owner Domain: `P-NAPP-*`

## Scope

定义 `P-NAPP-037` 的单一 macOS protected-local independent-admission authority。
通用 Nimi App catalog、permission 与 local-record 语义继续由
`nimi-app-admission-contract.md` 和 `nimi-app-local-admission-contract.md` 拥有；
本 companion 只拥有 macOS 正向链的 conjunctive native admission，不得成为
Mac-only product truth 或 portable fallback。

## P-NAPP-037 — macOS Protected-local Independent Admission

macOS is one conjunctive platform admission, not a compile target and not a
portable fallback. Its aggregate posture remains
`requirements_only_fail_closed_pending_native_admission` until every owner row
below has positive release and live-machine evidence from the same signed
candidate. A passing unit test, an ad-hoc signature, a same-user daemon, an
ordinary localhost listener, or a manually started foreground Runtime cannot
advance this posture.

The selected production component graph is fixed:

```text
signed/notarized Nimi.app
  -> SMAppService registration and explicit administrator approval
  -> launchd system-domain ai.nimi.runtime LaunchDaemon
     -> dedicated non-login _nimiruntime principal
     -> Runtime-only System Keychain custody
     -> launchd socket-activated filesystem UDS listeners
        -> verified Desktop main native carrier
           -> Kit host-only protected carrier -> typed SDK consumers
           -> Desktop local-development supervisor
              -> independently signed Nimi Local App Host.app
                 -> Zhiyu/local-app main + sandboxed renderer
  -> Runtime authenticated Realm broker -> Realm API
```

### Non-product local-development admission

The only tracked macOS local-development profile is the non-product fresh
carrier-4 candidate. Its posture is
`local_development_candidate_fail_closed_pending_real_acceptance` until the
complete real Runtime -> Desktop -> supervised Electron host acceptance closes.
It cannot satisfy or weaken production, Tauri, Developer ID, SMAppService,
notarization, or Gatekeeper admission. Apple Developer ID is not required for
this profile; Team ID is exactly absent; notarization and Gatekeeper acceptance
are absent and must not be claimed.

The fresh graph is fixed:

```text
developer-authorized user-domain signing Keychain
  -> one machine-local non-product CA and stable P-256 role leaves
  -> unprivileged build, hardened-runtime signing, and release-record generation
  -> explicit administrator install transaction
     -> small root-owned verify/install helper without signing private keys
     -> root-owned versioned candidate and atomic activation
     -> dedicated _nimiruntimedev launchd system principal
     -> Runtime-only System Keychain operational custody
     -> launchd socket-activated protected UDS
        -> signed Nimi Dev.app -> verified Desktop supervisor
           -> signed Nimi Local App Host Dev.app -> Zhiyu/local app
```

Signing authority, per-build executable identity, and Runtime custody are three
separate authorities. Signing private keys exist only in the dedicated
user-domain development signing Keychain and are used only before elevation.
The installer, Runtime, Desktop, renderer, and local app cannot read them. Stable
role leaves and designated requirements may sign later builds without rotating
the CA. Every build is separately pinned by SHA-256, CDHash, release record,
architecture, entitlements, generation, and expiry. Runtime operational secrets
remain in System Keychain and bind the stable Runtime designated requirement,
identifier, admitted leaf, and dedicated principal; installed release records
and Runtime self-verification separately bind exact bytes.

The privileged helper is a small verify/install boundary. It never creates a CA,
issues certificates, signs code, owns signing keys, or rotates itself. It copies
a preverified workspace candidate into root-owned staging and repeats exact
release-record, signature, designated-requirement, leaf-SPKI, Team-ID-absence,
hardened-runtime, architecture, entitlement, SHA-256, CDHash, same-vnode, and
fixed-path validation before atomic activation. Its source list is closed and
must not discover or compile the entire dev-security directory.

Fresh install is admitted as a candidate path only when the service, principal,
plist, payload, sockets, Runtime custody, and install journal are all absent. A
single top-level fresh-install journal may represent the irreversible install
transaction. Unknown or partial state keeps listeners closed and requires an
explicit confirmed exact reset; fail-close does not imply automatic recovery.
Update remains `dev-runtime-update-not-admitted`.

Carrier 2, carrier 3, and unknown profiles are
`legacy-local-dev-profile-not-supported` in all normal carrier-4 commands and
must fail before candidate signing, elevation, Keychain, OpenDirectory, launchd,
or filesystem mutation. There is no tracked source-to-target migration, helper
self-rotation, coordinator, root-overlap protocol, terminal migration proof, or
multi-WAL recovery. Exact workstation legacy deletion, if required, belongs only
to one untracked, delete-only, identity-bound runner under `.nimi/local/**`; it
is not product authority or a reusable command.

The profile preserves the production-strength UDS, audit-token, real/effective
UID, audit-session, pidversion/start identity, static and dynamic SecCode, exact
identifier/DR/leaf/hash, hardened runtime, vnode/liveness, mutual Runtime/Desktop
verification, boot epoch, session generation, restart/account-change/revoke, and
verified Desktop supervisor chain. There is no public TCP endpoint, app-held
Runtime token, renderer secret, app-level REST/gRPC bypass, or Mac-only SDK or
permission truth.

### Development principal, service, transport, and host admission

Carrier-4 normal commands never repair or migrate legacy carriers. Any legacy or unknown profile or residue fails as `legacy-local-dev-profile-not-supported` before mutation. The tracked helper has no legacy parser or delete path. Explicit reset owns only the current Nimi Dev namespace.

The development service principal is created only through the public
OpenDirectory framework. The installer selects one collision-free equal UID/GID
in the macOS role-account range `450..499`, generates distinct canonical user
and group UUIDs, and includes that exact principal witness in the single
root-owned mode-`0600` fresh-install journal before the first Directory Services
mutation. `ODNode.createRecord` creates the group and then the user from complete
initial attribute dictionaries. GeneratedUID is a birth attribute and is never
modified after record creation; the user is born with password `*`, hidden
state, `/var/empty` home and `/usr/bin/false` shell. It is born without
`AuthenticationAuthority`, ShadowHashData, PasswordPlus,
AltSecurityIdentities, AuthCredential, AuthMethod, AuthenticationHint,
KDCAuthKey, KerberosServices, KerberosRealm, KerberosKeys, HeimdalSRPKey,
SecureTokenVerifierHistory, AutoGrantSecureToken or LinkedIdentity. Any native
`_writers*` delegation is also forbidden. Negative attributes are inspected as
raw OpenDirectory values; a binary or malformed value is present and rejected,
never coerced into an empty string list. The dedicated group has no explicit
GroupMembership, GroupMembers or NestedGroups values, and a complete local
group projection must prove that neither the service name, user GeneratedUID
nor dedicated-group GeneratedUID is explicitly attached to any other group.
Computed OS baseline group projection is evidence only and is not hard-coded as
machine-independent authority. The installer synchronizes the records and then
proves the exact raw OpenDirectory and POSIX projections, including absence of
every forbidden authentication, writer and explicit-membership attribute.
Non-root status cannot promote unreadable protected
attributes to `runtimeAccountTrusted`; it reports privileged verification
required instead. Apple
documents that a failed initial attribute write deletes that record; the Nimi
transaction nevertheless retains its own cross-record journal because group and
user creation are two separate records.

Recovery and rollback delete user before group and only when name, UID/GID and
both GeneratedUID values exactly match the fsynced transaction witness. They
must then prove both records absent. Query failure, ambiguity, a mismatching
record or deletion without absence proof preserves the journal and reports
`runtime-service-repair-required`; it is never collapsed into record absence.
Rollback derives effect-ahead state from actual postconditions rather than
in-memory completion flags, stops at the first failed observed-effect cleanup,
and retains the ledger or journal witness plus the fixed recovery helper. The
ledger, journal, RuntimeDev boundary and recovery helper are removed, fsynced
and proved absent only after launchd, sockets, custody, payloads, staging and the
full raw OpenDirectory/POSIX principal witness are all absent; the recovery
helper is removed last.
An already present exact admitted principal is durable installation
infrastructure and is never owned or removed by a failed candidate update.
`dscl`, `sysadminctl`, `dsimport` and direct dslocal database writes are forbidden
mutation fallbacks; `dscl` may appear only in non-authorizing human diagnostics.
Every privileged install, restart, reset and uninstall transaction holds one
non-blocking exclusive `flock` on the same exact open root-owned RuntimeDev
boundary directory for the full transaction. The directory is the shared
installation boundary already required by the real external effects; no
pathname-only lock file or removable inode creates a second serialization
truth. User-domain signing and unprovisioning never acquire this privileged lock
or gain installer authority; their fail-closed Keychain operations are a
separate authority boundary.

The development profile retains every native process and transport invariant
of production: `LOCAL_PEERTOKEN`, `LOCAL_PEERPID`, audit session, euid/ruid,
pidversion/start identity, dynamic `SecCode`, exact designated requirement,
identifier, leaf SPKI, CDHash, hardened runtime, canonical vnode/digest,
process/vnode liveness, active-console binding, boot epoch and Desktop session
generation. It omits only the production-exclusive Developer ID Team ID,
notarization/Gatekeeper and SMAppService assertions. Direct `launchctl`
bootstrap is admitted solely for this explicitly non-product, root-owned
LaunchDaemon profile; it is not a production lifecycle fallback.

Electron is positive only when the same signed development candidate passes
real DOM/CDP/console/network/accessibility, Runtime restart, revoke and
Desktop-quit/no-orphan evidence. CDP exists only in an explicitly signed
acceptance variant, is loopback-only and uses an isolated non-authorizing user
data root. Tauri remains independently fail-closed. App-owned SQLite and exact
app-native commands remain `app_owned_authority`, require no Nimi permission,
and must still remain inside the opaque supervisor partition.

`SMAppService.daemon(plistName:)` is the registration/control surface and
launchd is the lifecycle owner. The containing notarized application lives at
the installer-fixed `/Applications/Nimi.app` path; the daemon plist lives at
`Contents/Library/LaunchDaemons/ai.nimi.runtime.plist` and uses a fixed
`BundleProgram`. A signed installer provisions the dedicated non-login
principal, the root-owned non-writable
`/Library/Application Support/Nimi/Runtime` installation/custody boundary, and
its `_nimiruntime`-owned mode-`0700` `state` child. Before service registration,
the installer invokes only the installer-fixed Runtime executable at its sealed
bundle path in a no-input custody-provision mode. That process must run as real
root and pass the same Platform role record, outer-bundle seal, dynamic
`SecCode`, CDHash, designated-requirement and same-open-vnode digest checks as
the service executable. This is an installer transaction, not a Desktop,
renderer, app-tools or public Runtime operation.

The custody transaction and production daemon acquire the same
`_nimiruntime`-owned mode-`0600` regular `state/runtime.lock` vnode with a
non-blocking exclusive advisory lock and retain it for their full state-access
lifetime. Fresh initialization is permitted only when that lock, the ledger,
its auxiliary files and both System Keychain items are all absent and the state
directory has no unrelated entry. Existing validation is permitted only when
the lock, ledger, record-MAC key and anchor are all present with exact owner,
mode, link-count, ACL and cryptographic integrity. Every mixed/partial state,
busy lock or replacement vnode fails closed and requires an explicit repair;
neither installer nor Runtime silently resets it. Fresh initialization creates
one 32-byte CSPRNG record-MAC key, the matching genesis ledger/Keychain anchor,
fsyncs the ledger and directory, and emits only a non-secret disposition. A
failed fresh transaction removes only artifacts proven to have been created by
that transaction; incomplete rollback remains a repair-required partial state.
Before returning success, the provision transaction admits the exact installed
Runtime role record into the Keychain-anchored release-generation high-water
ledger. A downgrade or generation rebind therefore fails before service
registration rather than after activation.
The signed installer either validates an existing exact `_nimiruntime`
Directory Services user/group or creates a collision-free equal UID/GID in the
local system-id range `200..499`. The account is hidden, has `/var/empty` as
home, `/usr/bin/false` as shell, disabled password authentication and no
supplementary groups (`InitGroups=false`). Any name/id/group, login capability,
home or shell mismatch is a repair-required partial installation; neither the
installer nor Runtime repurposes an existing identity.
LaunchAgent, Login Item, user-session daemon, Desktop child process, and
`go run ... serve` are not equivalent service profiles. Desktop quit leaves
the production Runtime running.

The physical transport is a filesystem Unix domain socket. Runtime accepts a
connection only after reading `LOCAL_PEERTOKEN` and `LOCAL_PEERPID` from the
connected socket, correlating euid/ruid/audit user/audit session/PID, and
resolving that audit token to the same running dynamic `SecCode`. Runtime then
validates the exact designated requirement, Team ID, bundle/signing
identifier, cdhash, hardened-runtime flag, canonical executable vnode and
release role against the Platform-release-root-signed role trust record. It
retains `EVFILT_PROC NOTE_EXIT|NOTE_EXEC` plus
`EVFILT_VNODE NOTE_DELETE|NOTE_RENAME|NOTE_WRITE|NOTE_REVOKE` witnesses.
Runtime verifies the active interactive login at admission and revokes the
connection on active-user/session change. The peer performs the reverse check:
socket server audit token/PID, stable launchd system job PID, Runtime dynamic
`SecCode`, exact Runtime designated requirement/Team ID/cdhash from the signed
Runtime role record, installed vnode identity, process liveness, and
boot-epoch/session rotation. Neither direction sends protocol or credential
bytes before these checks complete.

macOS role CDHashes are not compiled into mutually verifying executables and a
Desktop record containing the final Desktop CDHash is not stored inside the
same `Nimi.app` resource seal. Either construction is self-referential: the
final outer signing operation changes the Desktop CodeDirectory/CDHash and an
embedded record changes the outer resource seal. The guarded release pipeline
instead signs, notarizes and staples the exact final `Nimi.app`, then computes
the same-open-vnode SHA-256, final CDHash and designated requirement for every
role. It emits one canonical Platform-release-root-signed record per role under
the installer-owned, root-owned, group/world-non-writable fixed directory
`/Library/Application Support/Nimi/Runtime/trust/protected-local/v1` and builds
the exact app plus records into one Developer-ID-Installer-signed, notarized and
stapled package. Record files are root-owned mode `0644` regular single-link
files beneath mode `0755` root-owned ancestors; the `_nimiruntime` state
directory is a sibling and cannot replace them. macOS Installer serializes the
package payload transaction while `preinstall` keeps the Runtime launchd job
booted out. `postinstall` then acquires the custody lock before it reads or
changes Keychain, ledger, release-lineage or protected-state truth, validates
the exact installed app/record set, and never activates the service. No lock is
claimed to span two installer scripts. After an update, an explicit Desktop
start observes the still-enabled SMAppService registration with an absent
launchd-owned endpoint, waits for asynchronous unregister completion, and only
then re-registers the exact new embedded daemon as required by ServiceManagement.
An approval-required status remains user-owned and is never bypassed. A crash-
mixed app/record set cannot activate and fails digest/CDHash verification as
installer-repair-required on the next transaction.

Runtime and Desktop embed only the stable Platform release-root public key and
key id. The record signature is its content authority; the signed/notarized
installer and fixed root-owned path are installation authority; strict outer-
bundle validation independently proves the running application seal. A record
selected by a peer, environment, argv, renderer, app manifest, application
resources or user-writable path is forbidden. Missing, non-canonical, expired,
incompatible, rollback, wrong-role, digest-mismatched, CDHash-mismatched,
root-path-ownership-mismatched or outer-bundle-unsealed state fails closed
before protocol bytes.
The guarded builder never accepts the Platform release-root private key in
argv, environment, a repository file or an artifact. It sends only canonical
record payload bytes and the public key id over stdin to the fixed root-owned,
non-writable, same-Team-signed
`/usr/local/libexec/nimi-release-record-signer`; that release-service boundary
owns HSM/Keychain custody and returns only an Ed25519 signature. The builder
verifies every returned signature against the embedded public key before
packaging. Missing or replaced signer service fails the release.
Runtime's Keychain-anchored protected ledger stores an append-only per-role
release-generation high-water mark. It advances only after that exact running
Runtime, Desktop or supervised host has passed dynamic-code and same-open-vnode
verification. Reusing a generation for different release bytes or presenting a
lower generation is a rollback failure across Runtime restarts and reinstall;
an app-owned file, Desktop cache or installer receipt cannot reset it.

The two fixed sockets are Desktop control and local-app bootstrap/host at
`/private/var/run/nimi/runtime-desktop.sock` and
`/private/var/run/nimi/runtime-local-app.sock`. The canonical `/private` path is
mandatory; the `/var` system symlink spelling is not an authority-bearing path.
launchd creates and retains both listening descriptors from the signed
LaunchDaemon `Sockets` dictionary before Runtime starts, and Runtime adopts
exactly one descriptor per declared activation name with
`launch_activate_socket`. Their root-owned non-writable parent directory and
socket `root:staff` mode-`0660` vnode attributes come only from launchd's signed
daemon profile. The owner is fixed root rather than the installer-assigned
numeric UID of `_nimiruntime`, because `SockPathOwner` is a numeric signed-plist
field and the dedicated service UID is not a stable cross-machine release
constant. The daemon receives launchd's already-open descriptors after dropping
to `_nimiruntime`; it never owns or replaces the path. Symlinked ancestors,
pre-existing non-socket nodes, app-created listeners, a different owner, an
unexpected descriptor count/type/address, or a replacement vnode fail closed. Filesystem eligibility
is defense in depth. Exact active-user, login-session, role and code identity
remain mandatory even when another local process can reach the socket pathname.

Local-development process admission is two-stage. The verified Desktop carrier
uses `posix_spawn` with `POSIX_SPAWN_START_SUSPENDED` for the exact Runtime-
approved host executable and retains the child witness. Runtime binds the
suspended PID, start identity, canonical executable vnode, dynamic code
identity, project/capability/shell policy and process liveness. After resume,
the child must connect through the local-app socket; Runtime obtains its full
audit token and pidversion from that connection, repeats dynamic-code and vnode
validation, and atomically correlates it with the pre-bind witness before
promoting the same connection. PID reuse, `exec`, host/path replacement,
copied projects, changed manifests or a host outside the live Desktop
supervisor cannot promote.

Electron and Tauri close independently. Electron requires a separately signed
and notarized `Nimi Local App Host.app` with its own bundle identifier and
designated requirement; the generic npm Electron binary, ad-hoc Electron,
Desktop's own executable, renderer helpers and ordinary Node processes are
forbidden hosts. Chromium `sandbox: true`, `contextIsolation: true` and
`nodeIntegration: false` remain mandatory. CDP is absent by default and may be
enabled only by an explicit acceptance build profile with loopback binding and
isolated user data. Every production local-development Electron host also uses
a Desktop-created mode-`0700` Chromium user-data directory beneath the active
user's fixed Nimi local-app profile root. Its opaque leaf is a one-way digest
domain-separated from the Runtime authorization id: the raw authorization,
account id, project root, app id, Runtime epoch and session material never enter
the path or argv. The same live authorization reuses the partition across
controlled host replacement; another authorization (including reapproval after
revoke, account change or copied/changed project) resolves to another partition.
The partition is browser/app-owned data and is neither a Nimi grant nor a trust
root. Desktop rejects symlinked, wrong-owner, non-directory or group/world-
accessible partition ancestors before launch. An explicit acceptance profile
may select its own isolated temporary user-data root, but cannot make that root
production authority. Tauri requires its own signed Rust carrier, WKWebView origin
proof, command-registration audit, updater/install proof and live acceptance.
An Electron close cannot make Tauri positive.

The macOS protected Node-API carrier is sealed inside each exact signed host at
`Contents/Resources/nimi-native/protected-local`. Electron main code resolves
that one canonical resource directly; project/workspace `node_modules`,
`NODE_PATH`, environment, argv and app manifests cannot supply or replace it.
Its `.node` image must have the same Developer ID Team and satisfy hardened
runtime library validation. This fixed carrier remains the only authority path
when the signed local host imports the Runtime-approved external project main.
The Electron release normalizes its inherited `Info.plist` before signing:
arbitrary ATS loads are disabled, only local-network transport needed by the
supervised development origin is declared, and Camera/Microphone/Bluetooth/
audio-capture usage strings are absent while those `os_right` surfaces remain
unadmitted. A usage string or entitlement never substitutes for Nimi permission
or Runtime operation admission.

Runtime System Keychain custody is Runtime-only. Desktop, local apps,
renderers, login Keychain items and shared application storage cannot read the
secret. The daemon validates the System Keychain item ACL against its exact
designated requirement on every open; missing, locked, restored with a
different ACL, or inaccessible custody fails before listeners. Secure Enclave
is not required for the symmetric ledger MAC/anchor material because it is
non-exportable only at the Keychain policy boundary and no asymmetric user
presence operation is admitted. Runtime reinstall preserves custody only when
the same admitted designated requirement and installer release lineage remain;
reset/rotation is an explicit repair transaction. Logout/account switch
revokes account/session state but does not redefine durable machine custody.

The aggregate macOS gate is the conjunction of:

1. Runtime principal, protected state, Keychain custody and real launchd
   restart/crash/sleep-wake/multi-user evidence;
2. UDS owner/mode/vnode and mutual audit-token/dynamic-code verification,
   including ordinary/other-user/unsigned/copied/modified/wrong-Team/wrong-
   requirement/process-replacement denial;
3. production Developer ID signatures, hardened runtime, exact entitlements,
   notarization ticket, Gatekeeper assessment and native arm64 or admitted
   universal architecture for Runtime, Desktop and each claimed host;
4. account binding, boot epoch, process liveness, restart/reconnect/revoke and
   Desktop-quit no-orphan evidence;
5. real Electron DOM/CDP/console/network/accessibility and desktop/390px
   acceptance for Desktop plus Zhiyu;
6. a separate Tauri gate before any Tauri-positive claim; and
7. all Runtime/SDK/Kit/Desktop/app-tools/Zhiyu/spec/generation/boundary gates.

Until the conjunction is green, the product projection is one of the exact
negative states `runtime-service-unavailable`, `runtime-service-untrusted`,
`runtime-service-repair-required`, `runtime-restarted`, `process-replaced`,
`account-changed`, or `session-revoked`; it must not collapse trust or repair
failures into generic availability.

This platform admission does not change `P-PERM-*`. App-owned SQLite, schema,
migrations, private JSON/media/cache/index/settings/routes and exact app-native
commands remain `app_owned_authority` and require no Nimi permission or
operation admission. Runtime-mediated app-private JSON/opaque partition access
remains a `base_entitlement`; the sixteen public permission ids remain reserved
until their own owner-complete admissions; Camera, Microphone, Files,
Accessibility, Screen Recording and Notifications remain independent macOS
`os_right` decisions.

---

<!-- source: .nimi/spec/platform/kernel/nimi-app-admission-contract.md -->

# Nimi App Admission Contract

> Owner Domain: `P-NAPP-*`

## Scope

定义 Platform 对 verified catalog/release discovery 和第三方 local-app
provenance taxonomy 的产品 authority。PC-local runnable truth、opaque security
principal、lifecycle record 与 tombstone 由 Runtime K-APP 拥有；grant、launch/
process/session 与 owner operation policy 分属 K-GRANT、K-PLOCAL 和既有 domain
owners。本契约不得把 catalog row、app id、trust tier 或 provenance 变成
本地安全主体或权限。

## P-NAPP-001 — Admission Authority And Package Kind

`MUST`：Platform 拥有 verified Nimi App catalog/release admission、
`tables/nimi-app-registry.yaml` 与 admitted package kind set。Runtime owns the
local runnable ledger for `verified | user_imported | local_development`.
Catalog absence does not prohibit a future 0P-valid local import, while catalog
presence never creates a local principal, record, grant, lease, or session.
当前仅 admit `nimi-app` package kind。

`MUST NOT`：不得 admit shared Nimi Content Pack 作为可安装 product unit。

## P-NAPP-002 — Registry Row Schema

`MUST`：每个 verified catalog registry row 必须包含以下字段：

- `app_id` — 全局稳定 ID（dot-separated namespace，例如 `nimi.avatar`）。
- `display_label`
- `publisher`
- `trust_tier_ref` — 引用
  `tables/nimi-app-trust-tiers.yaml` 中已 admit 的 trust tier。
- `package_kind` — `nimi-app` 为唯一 admitted 值。
- `package_signature_policy_ref` — 引用 release-gate registry 中已 admit 的
  signature policy。
- `update_channel_ref` — 引用 `release-gate-registry.yaml` 已 admit 的
  release channel identity。
- `ai_profile_selection_ref` — 引用
  `tables/ai-profile-factory-catalog.yaml` 中已 admit 的 factory AIProfile
  alias / profileId（`P-AIPS-009`）。
- `capability_set_refs` — 引用
  `tables/canonical-capability-catalog.yaml` 中已 admit 的
  `CanonicalCapabilityId` 列表。
- `ai_capability_requirement_refs` — 引用 SDK-owned app/module/feature
  requirement declaration (`S-AICONF-010`) for each AI surface the app wants to
  use. This is the required/optional/apply/setup declaration; it is distinct
  from Runtime activation consumers.
- `local_compute_pack_refs` — 引用
  `config/runtime-local-compute-packs.yaml` 中已 admit 的
  pack；可为空。
- `runtime_registration_mode` — 当前 admitted 值集合：`app-managed`。
- `permission_requirements` — public permission request 列表；每项固定为
  `{ id, reason }`，只能引用 `P-PERM-002` 已准入 id。空列表是完整、有效的
  zero-permission app posture，不影响安装、启动或 app-owned product UI。
- `health_repair_projection` — fail-closed 状态集合（见 `P-NAPP-008`）。
- `ordinary_visibility` — `ordinary-visible`、`hidden-internal`、
  `developer-only`、`not-admitted-visible` 之一。Apps 只能显示
  `ordinary-visible` 且 `admission_status=admitted` 的 row。
- `release_descriptor_ref` — 引用
  `tables/nimi-app-release-descriptors.yaml` 中的 verified discovery release
  descriptor；bundled first-party app 可引用 atomic Nimi bundle descriptor。
- `install_storage_policy_ref` — 引用 `P-NAPP-015` 的 storage policy。
- `admission_status` — admitted 值集合：`admitted`,
  `gated_by_avatar_master_gate`, `deferred`, `retired`。Permission readiness
  不得成为 app admission/launch status。
- `source_rule` — `P-NAPP-NNN` 引用。

## P-NAPP-003 — AIProfile Selection Hint Resolution

`MUST`：`ai_profile_selection_ref` 必须指向
`tables/ai-profile-factory-catalog.yaml` 中已 admit 的 factory AIProfile
alias / profileId（`P-AIPS-009`）。

`MUST NOT`：不得在 registry row 中内嵌 provider id / connector id /
engine id / model id 字符串常量。任何 vendor 倾向必须 alias-driven。

## P-NAPP-004 — Trust Tier Reference

`MUST`：`trust_tier_ref` 必须是 publisher/review posture 的 canonical enum：
`nimi-first-party`, `nimi-verified-partner`, 或 `nimi-community`
（`trust-tier-enum-floor.md`）。

`MUST NOT`：不得把 publisher/review trust tier 与
`verified | user_imported | local_development` local provenance 混用。Trust
tier does not grant, deny, widen, or narrow a Nimi API permission. 不得静默
新增第四类 public trust tier；新增必须由显式 authority admission 扩展。

## P-NAPP-005 — Capability Requirement And Compute Pack Resolution

`MUST`：`capability_set_refs`、`ai_capability_requirement_refs` 与
`local_compute_pack_refs` 必须解析到既有 admitted Platform / SDK / Runtime row。
Admission commit 时任何 unresolved ref 都视为 admission failure。

`MUST`：`capability_set_refs` declares the app's admitted capability vocabulary;
`ai_capability_requirement_refs` declares app/module/feature required/optional
AI slices and setup projection shape; `local_compute_pack_refs` declares local
environment pack needs. These three fields must not be collapsed into one
ambiguous "consumer" concept.

`MUST NOT`：Nimi App registry rows, app manifests, or app-local spec slices must
not carry Runtime activation `consumer_id` as the app requirement owner, nor may
they declare local paths, selected source records, materialization evidence,
route bindings, provider health, scheduler state, or connector secrets.

## P-NAPP-006 — Runtime Registration Ownership

`MUST`：app runtime registration、local principal/record、enforcement、
process/session supervision 由 Runtime 拥有。Registry row 仅记录 verified
release input，不拥有 local runnable truth。

`MUST NOT`：Registry / Platform 不得通过 admission row 强行替换 Runtime app
registration semantics。

## P-NAPP-007 — Package Trust / Signature / Update Channel

`MUST`：Platform owns verified catalog signature, attestation, and update
metadata. The 0K kernel freezes only opaque `immutable_lineage_id`, provenance
attestation refs/revision, execution-profile ref, and host/payload digest slots.
How a signed package or Platform attestation maps into those fields is 0P
authority and remains typed unavailable before 0P.

`MUST NOT`：Nimi App update 不得 mutate Runtime-owned selected source
record（`P-SUPD-005` / `P-PKGREL-007`）。不得借 update path 引入
parallel package trust source。

## P-NAPP-008 — App Health / Repair Projection

`MUST`：`health_repair_projection` 必须显式区分以下 fail-closed 状态：

- `unavailable`
- `setup-required`
- `needs-confirmation`
- `in-progress`
- `failed`
- `unsupported`
- `repair-required`
- `stale-projection`

`MUST NOT`：不得通过单一 `unavailable` 文案隐藏多种 fail-closed reason；不得
从 file existence、endpoint reachability、process liveness、transfer
completion 推断 `ready`。

## P-NAPP-009 — Apps Non-Owner Rule

**Owner-only authority allocation.** Platform owns verified catalog/release,
publisher/review posture, the permission vocabulary, and the closed local
provenance taxonomy. Runtime K-APP owns PC-local principals and records;
canonical domain owners own admitted permission decisions and K-GRANT defines
the Runtime-owned lifecycle boundary; K-PLOCAL owns launch/process/session;
RuntimeAccountService owns credential custody and enforcement coordination;
RuntimeAgentService/Cognition and other domains retain operation semantics.
An app id, catalog row, trust class/tier, manifest, renderer metadata, or
app-owned host description MUST NOT grant privilege or establish runnable
identity. app-tools owns authoring/build orchestration only. Desktop is the
current protected `local_app_control` UX/launcher implementation and is not a
principal, permission-decision, or session owner.

`MUST`：Desktop `Apps` surface（`D-HOME-004` / `D-HOME-005`）仅消费 registry/package/SDK projection。Ordinary Apps visibility 的闭合条件为：

- `admission_status=admitted`
- `ordinary_visibility=ordinary-visible`
- registry row resolves trust tier、package kind、release descriptor、
  permission/runtime requirements、and storage policy
- host/runtime projection does not fail-close the row as unsupported or blocked

`MUST NOT`：Apps 不得拥有 admission truth、marketplace truth、economy truth、package trust truth；不得读取 source workspace、app-local spec、or unadmitted registry rows to decide visibility.

## P-NAPP-010 — App-Slice Admission Orthogonality

`MUST`：现有 `app-slice-admission-contract.md`（`P-APP-*`）的 audit /
subordinate authority semantics 与本契约 admission 并行存在；两者互不替代。
一个 first-party app 可同时持有 app-slice admission row（audit authority）
与 Nimi App registry row（公开产品 admission）。

`MUST NOT`：Nimi App registry 不得替代 `P-APP-*` 的 audit authority；
`P-APP-*` 也不得替代本契约的 public product admission。

## P-NAPP-011 — First-Party Seed

`MUST`：the verified catalog may retain the currently admitted bundled
first-party rows (`nimi.avatar`, Realm Persona Studio, Realm World Studio and
`nimi.zhiyu`) with their existing owner-defined hidden/developer-only posture.
This third-party 0K redesign neither deletes nor redesigns those U/R/B surfaces
and never maps them into the three third-party provenance classes.

Shipped Avatar and Zhiyu are bundled Platform components and retain their
existing owner-admitted caller semantics. Zhiyu's mutable integration build uses
an isolated `local_development` principal without inheriting bundled identity,
permission decisions, storage, audience, session, Agent, or memory state. No bundled registry
row grants an external local-app principal or supplies package readiness.

## P-NAPP-012 — App Identity Surface Mapping

`MUST`：Platform owns canonical `app_id` syntax and display/routing mapping.
`app_id` is not the local security principal and MUST NOT by itself key a
permission decision, private storage, app-scoped audience, session, or audit subject. Runtime
resolves those surfaces through a random/non-reused `local_app_principal_id`
inside a Runtime-derived `local_os_user_anchor`. Current surface mappings are
recorded in `tables/nimi-app-identity-surfaces.yaml`.

`MUST`：`app_id` is lowercase and dot-separated. A segment must start and end
with an ASCII lowercase letter or digit and may contain internal lowercase
letters, digits, or hyphens. Underscore is not admitted because OS bundle
identifier derivation would otherwise be lossy.

`MUST`：Runtime/SDK projections may carry the same canonical `app_id` for
display/routing, but protected local calls use opaque principal/session context
derived by Runtime. Neither `app_instance_id`, `device_id`, nor app id is a
substitute for `local_app_principal_id`.

`MUST`：Tauri `identifier` is an OS bundle/signing/update identifier only. It
must be derived from canonical `app_id` as:

```text
ai.nimi.apps.<app_id>
```

The `ai.nimi.apps` prefix is the reverse-DNS namespace for the `nimi.ai`
product-owned application bundle namespace; it is not an AI capability,
provider, or model identifier.

`MUST NOT`：active app source, scaffold state, Runtime caller tests, or Tauri
configuration may use `app.nimi.*`, `dev.nimi.*`, or any other side namespace
as an active app identity surface. Developer/testing posture belongs in the
Runtime-owned Developer Mode, local record, build profile, or typed non-product
evidence boundary; it must not be encoded into canonical `app_id`.

## P-NAPP-013 — Third-Party Admission Path

`MUST`：Platform-verified catalog/release admission may begin as a GitHub PR
into Platform-owned registry/release tables. This path owns verified discovery
and attestation input only; it is not the sole local install door and cannot
create a PC-local principal, grant, or session. The PR must admit, in the same
reviewable change set:

- registry row metadata;
- permission requirements;
- Runtime registration requirements;
- AIConfig/profile requirement hints;
- exact version;
- immutable source reference;
- release descriptor reference;
- artifact digest, size, signature or provenance evidence where applicable;
- storage policy.

`MUST NOT`：GitHub repository ownership、npm package name、source directory、
or app-local spec presence is not local runnable authority. Direct `npm install`,
direct `npx`, mutable git branch/tag, direct clone/build/run, or installer
script execution cannot create immutable local truth. Mutable source uses the
separate `local_development` path; 0P later owns immutable package import.

## P-NAPP-014 — Release Descriptor And Digest Verification

`MUST`：every Platform-verified catalog version must resolve to an immutable
release descriptor in `tables/nimi-app-release-descriptors.yaml`. The descriptor
must include exact `app_id`, `version`, source kind/ref, artifact locator,
`sha256`, size, signature/provenance reference, runtime package kind/entry,
permissions, and storage policy.

Any future 0P mapping from this descriptor into the frozen opaque Runtime
package seam must:

- download only from the descriptor source;
- compute `sha256` over downloaded bytes before unpack/register/execute;
- compare computed digest with descriptor `sha256`;
- fail closed before unpacking when the digest does not match;
- continue manifest, permission, Runtime, and storage validation only after
  digest match.

`MUST NOT`：this verified catalog descriptor is not the 0P `.nimiapp` package
format, hostile-byte inspector, or fixed-AppHost authority. It cannot enable
`user_imported` positive install before 0P. Hash match is not a safety proof by
itself.

## P-NAPP-015 — App Install Storage Policy

`MUST`：app package/data storage is rooted under selected `nimi_data`:

```text
<nimi_data>/apps/<local_app_principal_id>/releases/<version>
<nimi_data>/apps/<local_app_principal_id>/data
<nimi_data>/apps/<local_app_principal_id>/cache
<nimi_data>/apps/<local_app_principal_id>/tmp
```

The local principal is resolved by Runtime; callers cannot supply or derive the
root. Uninstall/project revoke tombstones the principal. Retained durable data
remains orphaned and delete-only unless the user explicitly confirms deletion
with fresh presence; reinstall/re-authorization never rebinds it.

`MUST NOT`：ordinary app install may not write outside these roots except
through an admitted Runtime-managed dependency/materialization path. App
uninstall must not delete shared models, Runtime dependencies, account data, or
other app data by implication.

## P-NAPP-018 — Third-Party Release Descriptor Shape

`MUST`：every third-party admitted release descriptor in
`tables/nimi-app-release-descriptors.yaml` MUST resolve the complete field
shape enumerated below. Missing or unresolvable required field fails admission
closed with the typed reason listed against that field; the descriptor floor
is the mechanical projection of this rule (see
`tables/nimi-app-release-descriptors.yaml` `third_party_descriptor_floor.required_fields`).

Required descriptor fields:

- `descriptor_id` — stable descriptor identity.
- `app_id` — admitted app identifier (`P-NAPP-002`).
- `version` — exact semantic version.
- `admission_track` — closed enum containing only `ordinary-release-proof`
  (`P-NAPP-033`); CI fixtures are not catalog admission tracks.
- `publisher.github_namespace` — `github.com/<owner>` namespace anchor.
- `publisher.namespace_kind` — closed enum `user | org`.
- `publisher.identity_assurance` — closed enum
  `pseudonymous | domain-verified | identity-verified` (`P-NAPP-021`).
- `publisher.verified_domain` — DNS domain or null
  (constraints in `P-NAPP-020`).
- `publisher.kyc_verification_ref` — vendor-result-ref or null
  (constraints in `P-NAPP-021`).
- `source.kind` — closed enum `github-release | github-commit | npm-package`
  for third-party (see `tables/nimi-app-release-descriptors.yaml`
  `third_party_descriptor_floor.allowed_source_kinds`).
- `source.ref` — immutable source reference (commit SHA, protected tag,
  or pinned npm version).
- `artifact.locator` — opaque locator for the artifact in `source`.
- `artifact.sha256` — digest computed before unpack per `P-NAPP-014`.
- `artifact.size` — opaque catalog-review metadata in 0K; no local install,
  storage, update or rollback size projection is admitted (`P-NAPP-019`).
- `artifact.signature_or_provenance_ref` — signature / attestation ref.
- `artifact_mirror_ref` — Nimi-controlled mirror locator (`P-NAPP-022`).
- `build_assurance` — closed enum
  (`P-NAPP-023`; `checksum-pinned` forbidden for third-party).
- `dependency_assurance` — lockfile posture plus scanner-evidence refs
  (separate from `build_assurance`).
- `platform_signing_assurance` — typed sub-object (`P-NAPP-024`).
- `runtime.package_kind` — `nimi-app` per `P-NAPP-001`.
- `runtime.entry_ref` — Runtime registration identifier (`P-NAPP-006`).
- `runtime.sandbox_ref` — Runtime process-profile identifier; NOT an OS
  sandbox claim.
- `permissions_ref` — exact registry `permission_requirements` list; an empty
  list is valid and does not block package admission or launch.
- `storage_policy_ref` — storage policy identifier (`P-NAPP-015`).
- `update_channel_ref` — admitted release channel identity.
- `rollback_eligibility` — catalog-review marker only; it does not create a
  local rollback candidate in 0K.
- `review` — sub-object with decision schema (`P-NAPP-025`).
- `support` — sub-object with required manifest fields (`P-NAPP-026`).

`MUST NOT`：a third-party admission MUST NOT collapse the descriptor shape
into a developer manifest or any other parallel-truth artifact. The
admitted descriptor is the platform-owned canonical truth produced by
review (`P-NAPP-013`, `P-NAPP-014`); the developer-authored manifest is
not admission truth.

## P-NAPP-019 — Opaque Immutable Package Seam Only In 0K

`MUST`：0K freezes only these immutable-package integration slots:

- principal `immutable_lineage_id`;
- record `provenance_attestation_refs` and `provenance_revision`;
- record `execution_profile_ref`;
- record `host_executable_digest` and `payload_root_digest`.

Every field is opaque in 0K. No size partition, install/update date, installed
version, rollback candidate, active release pointer, install evidence, package
job, storage root, signer envelope, import result, update result, promotion
result or repair result is admitted. All positive immutable package operations
and readiness states are typed unavailable.

`MUST`：0P may verify package/signing/attestation inputs and map them into the
frozen opaque slots, but it cannot rename, split, merge or add identity-bearing
fields to the principal/record/grant/lease/process/session schema. Detailed
package evidence shapes belong to 0P/P and require their own authority batch.

`MUST NOT`：catalog review metadata such as descriptor `version`, `artifact.size`,
dates or rollback eligibility may not be interpreted as local package,
principal, install, launch, grant or promotion truth in 0K.

## P-NAPP-020 — Publisher Identity Required Fields

`MUST`：every third-party admitted release descriptor MUST carry
`publisher.github_namespace` and `publisher.namespace_kind`. Missing
either fails admission closed with typed reason
`publisher_identity_missing`.

`MUST`：`publisher.namespace_kind` is constrained to the closed enum
`user | org`. Any other value fails admission closed with typed reason
`publisher_identity_missing`.

`MUST`：when `publisher.identity_assurance` is `domain-verified` or
`identity-verified` (`P-NAPP-021`), `publisher.verified_domain` MUST be
non-null and MUST resolve to a DNS-verifiable domain bound to the
publisher's GitHub organization namespace. An unresolvable
`publisher.verified_domain` fails admission closed with typed reason
`verified_domain_unresolved`.

`MUST NOT`：a third-party admission MUST NOT substitute developer-authored
manifest fields, source repository ownership, or npm package name for the
admitted `publisher.*` block. Publisher identity is reviewer-confirmed
admission truth, not a developer-self-attested claim (`P-NAPP-013`).

## P-NAPP-021 — Identity Assurance Enum And KYC Deferral

`MUST`：`publisher.identity_assurance` is constrained to the closed enum:

- `pseudonymous` — GitHub namespace anchor only;
- `domain-verified` — DNS-verified organization namespace;
- `identity-verified` — KYC-vendor-verified legal entity.

`MUST`：`domain-verified` and `identity-verified` MUST resolve
`publisher.namespace_kind: org`. GitHub-style domain verification is
organization-level; a `user`-kind namespace declaring `domain-verified` or
`identity-verified`
fails admission closed with typed reason `publisher_identity_missing`.

`MUST`：an admission declaring `publisher.identity_assurance:
identity-verified` MUST resolve a non-null `publisher.kyc_verification_ref`
through the admitted KYC-vendor-integration pipeline. Until a separate
authority-bearing admission defines that vendor-integration contract, an
`identity-verified` declaration without a resolvable
`kyc_verification_ref` fails admission closed with typed reason
`kyc_pipeline_not_yet_admitted`. The enum value is admitted now to prevent
schema drift; the realization path is deferred and is itself fail-closed.

`MUST NOT`：`identity_assurance` MUST NOT be silently downgraded or
upgraded post-admission. A change in identity assurance is a new
descriptor admission (`P-NAPP-014`), not an in-place mutation.

## P-NAPP-022 — Artifact Mirror Ref And Mirror License Clearance

`MUST`：every third-party admitted release descriptor MUST include
`artifact_mirror_ref` resolving to a Nimi-controlled mirror locator. The
day-1 mirror substrate is an immutable GitHub Release asset under the
Nimi registry org; later migrations are descriptor-transparent (the ref
remains the resolution surface). Missing or unresolvable
`artifact_mirror_ref` fails admission closed with typed reason
`artifact_mirror_ref_unresolved`.

`MUST`：`mirror_license_cleared: true` MUST hold at admission before Nimi
mirrors the artifact. Mirror-license clearance is the publisher-granted
right for Nimi to redistribute the artifact through the Nimi-controlled
mirror substrate. `mirror_license_cleared: false` at admission time fails
admission closed with typed reason `mirror_license_unclear` BEFORE any
artifact mirroring is attempted.

`MUST`：the two failure surfaces are distinct. `artifact_mirror_ref_unresolved`
is a reference-resolution failure (the locator does not resolve to a
Nimi-controlled mirror); `mirror_license_unclear` is a license-rights
failure (the publisher has not granted Nimi the right to mirror). A
single typed reason MUST NOT collapse both surfaces.

`MUST NOT`：admission MUST NOT mirror the artifact before
`mirror_license_cleared: true` and `artifact_mirror_ref` resolution both
pass. The fail-closed semantics are pre-mirror, not post-mirror cleanup.

## P-NAPP-023 — Third-Party Build Assurance Exclusion

`MUST`：`build_assurance` on a third-party admitted release descriptor
MUST resolve to one of `nimi-built | reproducible-verified |
developer-attested`. The fourth enum value `checksum-pinned` is reserved
for `nimi-first-party`, internal, and developer-testing classes only
under the descriptor floor.

`MUST NOT`：a third-party admission MUST NOT carry `build_assurance:
checksum-pinned`. Attempting to admit `checksum-pinned` on any tier other
than `nimi-first-party` fails admission closed with typed reason
`build_assurance_third_party_violation`. The forbidden value is
mechanically enforced through
`tables/nimi-app-release-descriptors.yaml`
`third_party_descriptor_floor.forbidden_third_party_build_assurance:
[checksum-pinned]`.

`MUST NOT`：`build_assurance` MUST NOT be used as an automated install
gate. It is review input and a display field; the admission gate is the
composite review (`P-NAPP-013` PR-admission path plus the admitted
`P-AUDIT-*` pipeline).

## P-NAPP-024 — Platform Signing Assurance Subfields

`MUST`：every third-party admitted release descriptor MUST carry
`platform_signing_assurance` as a typed sub-object with the following
six typed sub-fields:

- `macos_notarization` — closed enum `notarized | not-applicable |
  not-required-internal`;
- `macos_developer_id_subject` — Apple Developer ID subject string or
  null (null is valid only when `macos_notarization` is
  `not-applicable`);
- `windows_code_signing` — closed enum `signed | not-applicable |
  not-required-internal`;
- `installer_signature` — closed enum `signed | unsigned-internal-only`;
- `entitlements_ref` — string reference to admitted entitlements profile
  or null;
- `signing_subject` — closed enum `nimi | publisher`.

`MUST`：for third-party admissions targeting ordinary-user-installable
macOS surfaces, `macos_notarization` MUST resolve to `notarized`. For
third-party admissions targeting ordinary-user-installable Windows
surfaces, `windows_code_signing` MUST resolve to `signed`. Failure to
resolve to the required value fails admission closed with typed reason
`platform_signing_required`.

`MUST NOT`：a third-party ordinary release proof MUST NOT carry `macos_notarization: not-applicable`, `macos_notarization: not-required-internal`, `windows_code_signing: not-applicable`, or `windows_code_signing: not-required-internal`; declaring any of those values on `admission_track: ordinary-release-proof` fails admission closed with typed reason `platform_signing_required`.

These fields are verified catalog review/discovery evidence only in 0K. They do
not define the immutable package signing identity, do not create a local
principal or record, and do not admit install, import, update, promotion, or
launch. Future 0P mapping must consume them through the frozen opaque lineage,
attestation, execution-profile, and digest seam rather than treating this
descriptor as the package envelope.

`MUST NOT`: no CI, sandbox, fixture, local-development, or internal-only
descriptor track may use this catalog field set to claim ordinary visibility or
local package readiness.

`MUST NOT`：this rule MUST NOT introduce a new `admission_status` enum
value. The existing admitted `admission_status` enum in
`tables/nimi-app-registry.yaml` (`P-NAPP-002` field set) is invariant
under this rule.

## P-NAPP-025 — Review Decision Schema

`MUST`：the `review.decision` field on every third-party admitted release
descriptor MUST resolve to a closed enum that is a strict subset of the
terminal/final P-ECO-004 admitted review states. The admitted
`review.decision` values are:

- `approved`
- `revision-requested`
- `rejected`
- `kill-switched`

`MUST`：the descriptor MUST carry the accompanying review-evidence
sub-fields:

- `review.adjudicator_kind` — closed enum `human | nimi-automated-gate`
  (extensible only per a future `P-AUDIT-*` rule, not this rule);
- `review.adjudicator_ref` — string reference to reviewer policy or human
  reviewer identifier;
- `review.decided_at` — terminal-decision timestamp owned by the review record.

`MUST NOT`：the pre-decision P-ECO-004 state-machine positions
`submitted` and `under-review` MUST NOT appear as `review.decision`
values. They are transient state-machine positions in `P-ECO-004`'s
domain, not terminal decisions; the admitted descriptor records the
terminal decision only.

`MUST NOT`：this rule MUST NOT redefine the P-ECO-004 review-state set or
the P-ECO-004 tier-to-adjudicator mapping. `review.decision` is an
evidence-recording schema (audit outcome captured on the admitted
descriptor); policy ownership remains with `P-ECO-004` and the admitted
`P-AUDIT-*` pipeline.

## P-NAPP-026 — Support Manifest Required Fields

`MUST`：every third-party admitted release descriptor MUST carry a
`support` sub-object with the following six typed required sub-fields
required by the admitted descriptor support block:

- `support.diagnostics_bundle_fields` — typed list of admitted diagnostic
  field names exported into the support diagnostics bundle;
- `support.redaction_rules` — typed list of redaction rules applied to
  the diagnostics bundle before any export;
- `support.user_visible_issue_categories` — typed list of issue
  categories the support UX exposes to users;
- `support.escalation_path` — typed escalation route reference (publisher
  contact or Nimi-routed escalation);
- `support.kill_switch_visibility` — typed disclosure of how a
  kill-switched state surfaces to users;
- `support.recovery_instructions` — typed recovery-action references
  consumed by the Apps support surface.

`MUST`：missing OR empty `support` sub-object, OR missing any of the six
required sub-fields, fails admission closed with typed reason
`support_manifest_incomplete`.

`MUST NOT`：support manifest fields MUST NOT be inferred from the
developer-authored manifest at runtime. The admitted descriptor's
`support.*` block is the canonical truth consumed by the support UX;
inferring root cause from file existence, process liveness, or
endpoint reachability is forbidden (consistent with `P-NAPP-008`
`MUST NOT`).

## P-NAPP-027 — Storage Posture Admission

`MUST`：every third-party admitted release descriptor MUST carry a
typed `storage_policy_ref.kind` resolving to the closed enum:

- `nimi-mediated-default` — app uses the bounded Nimi-mediated private-storage
  surface and the Nimi-owned data root tree as an app-private base
  entitlement;
- `app-owned-os-storage` — app writes through OS-level file IO to
  paths it chooses; disclosure carried per `P-NAPP-028`.

Missing or unrecognized `storage_policy_ref.kind` fails admission
closed with typed reason `storage_policy_kind_unresolved`.

`MUST`：when `storage_policy_ref.kind` is `nimi-mediated-default`, the
descriptor's resolved storage template MUST be exactly:

```text
<nimi_data>/apps/<local_app_principal_id>/releases/<version>
<nimi_data>/apps/<local_app_principal_id>/data
<nimi_data>/apps/<local_app_principal_id>/cache
<nimi_data>/apps/<local_app_principal_id>/tmp
```

Runtime may materialize this tree for immutable packages only after 0P/P maps
verified inputs into the frozen principal/record seam; 0K returns typed
unavailable for that positive path. The
storage roots are admitted by `P-NAPP-015`; this rule binds the
descriptor's `storage_policy_ref.kind` to those existing admitted
behaviors without duplicating them. Template-resolution failure
(unresolved `<nimi_data>` selection, unresolved Runtime-derived
`<local_app_principal_id>`, or any
sub-path missing from the resolved template) fails admission closed
with typed reason `nimi_mediated_storage_unresolved`.

The calling app's own `nimi-mediated-default` partition is a P-PERM-015 base
entitlement. It is not represented by `file.read.scoped` /
`file.write.scoped`, the retired `app-local-drafts` qualifier, or a K-GRANT
record. Runtime still requires the live principal/session/account partition
and enforces the bounded storage owner's path, type, quota, and symlink policy.
Cross-app, external-file, generic-file, or destructive retained-data access is
not admitted by this base entitlement.

`MUST NOT`：the `storage_policy_ref.kind` enum MUST NOT be extended
with a third value under this contract. Adding a new posture is a
separate authority-bearing admission event, not an in-place
extension of this rule.

**Non-rule (deliberate)**：declaring `storage_policy_ref.kind:
app-owned-os-storage` is NOT itself a fail-closed admission condition.
Nimi is a launcher, not an OS; the platform does not force apps to
use Nimi-mediated storage. The honest residual — that Nimi cannot
guarantee clean-uninstall coverage of OS-level paths the app writes
through OS-level IO — is what the `os_storage_disclosure` surface
in `P-NAPP-028` exists to make visible. Acceptance at every trust
tier is intentional; admission imposes disclosure, not posture choice.

An `app-owned-os-storage` application may implement its own SQLite, media,
settings, cache, and product-domain persistence in its native host. Nimi does
not admit those schemas or commands into the protected-operation catalog and
does not issue per-table, per-command, or per-file grants. If account
partitioning is required, the native host consumes only the opaque
session-derived partition handle admitted by P-PERM-015/P-KIT-044; raw account
identity and credentials remain unavailable to the app.

## P-NAPP-028 — App-Owned OS Storage Disclosure

`MUST`：when `storage_policy_ref.kind` is `app-owned-os-storage`, the
admitted release descriptor MUST carry a typed `os_storage_disclosure`
sub-field. The sub-field is a typed list whose entries each carry:

- `path_pattern` — typed path pattern (OS-level path or path glob the
  app writes through);
- `purpose` — typed purpose string the reviewer and user surface
  consume to understand why the path is written;
- `expected_size_band` — typed size-band reference indicating expected
  footprint.

The disclosure is reviewer-visible at admission and user-visible
through the Apps Health / Uninstall surfaces. Missing or empty
`os_storage_disclosure` while `storage_policy_ref.kind:
app-owned-os-storage` fails admission closed with typed reason
`os_storage_disclosure_missing`.

`MUST NOT`：`os_storage_disclosure` MUST NOT be populated when
`storage_policy_ref.kind: nimi-mediated-default`. The two postures are
disjoint: nimi-mediated-default's footprint is the typed template
admitted by `P-NAPP-027`; app-owned-os-storage's footprint is the
disclosed OS-level list admitted by this rule. Cross-population
collapses the two disjoint surfaces and fails admission closed with
typed reason `os_storage_disclosure_missing` (when present where it
must be absent, the same typed reason is emitted on the symmetric
posture; admission MUST treat the disjoint shapes as a single
disclosure invariant).

`MUST NOT`：any future Runtime immutable uninstall, update, or repair MUST NOT
unilaterally touch paths listed
under `os_storage_disclosure`. For `app-owned-os-storage` admissions,
clean-uninstall coverage of OS-level paths is outside Nimi's mediation
surface; the disclosure exists so the user is informed, not so the
platform silently mutates publisher-owned paths.

## P-NAPP-029 — Source Repository Visibility

`MUST`：every third-party admitted release descriptor whose
`trust_tier_ref` resolves to `nimi-verified-partner` or
`nimi-community` MUST resolve a `source_repo_url` whose GitHub
repository is publicly visible. The required visibility per tier is
projected from `tables/nimi-app-trust-tiers.yaml` field
`source_repo_visibility_required`:

- `nimi-verified-partner: public` — admitted repo MUST be public;
- `nimi-community: public` — admitted repo MUST be public;
- `nimi-first-party: unconstrained` — exempt from this rule.

A `source_repo_url` resolving to a non-public GitHub repository
against a tier whose `source_repo_visibility_required` is `public`
fails admission closed with typed reason
`source_repo_visibility_violation`.

`MUST`：`source_repo_url` is the registry-row field admitted in
`tables/nimi-app-registry.yaml`. Visibility is evaluated at admission time
against the GitHub repository the URL resolves to; an unresolvable
URL is a separate failure surface and is not collapsed into
`source_repo_visibility_violation`.

`MUST NOT`：this rule MUST NOT redefine the `trust_tier_ref` floor
enum (`P-NAPP-004` / `P-ECO-003`). Visibility enforcement is a
per-tier projection over the already-admitted floor; the floor is
invariant under this rule.

`MUST NOT`：`source_repo_url` MUST NOT be mutated in place
post-admission to satisfy a visibility check. A change to the source
repository (or its visibility posture) requires a new descriptor
admission (`P-NAPP-014`), not an in-place mutation of the registry
row.

## Local Admission Companion

Rules `P-NAPP-030..P-NAPP-032` and `P-NAPP-035..P-NAPP-036` are defined in
`nimi-app-local-admission-contract.md` under the same `P-NAPP-*` owner domain.

## P-NAPP-033 — Third-Party Admission Track Boundary
Platform admission tracks classify verified catalog review only. Non-product
CI descriptors cannot become local runnable truth. `local_development` is not
a catalog track, and `user_imported` cannot be simulated by a catalog fixture.
Immutable positive package behavior remains unavailable until 0P.

## P-NAPP-034 — Protected Local-app Launch Boundary

Positive third-party sessions on an admitted platform profile require the
same-OS fixed Runtime service, Runtime-derived `local_app_control`,
`PrepareLocalAppLaunch`, native peer/process/executable proof, exact
principal/record/provenance/generation, account context, and the current boot
epoch. The launch lease is necessary but not durable identity and never enters
renderer/app state. A shortcut invokes the verified Nimi launcher selected by
the admitted launch profile; it never points at raw app code. Windows is the
current admitted positive row. macOS and Linux remain requirements-only and
fail closed until their complete native chains are independently admitted.
Physical launcher/session selection and that per-platform admission are owned
by `.nimi/spec/runtime/kernel/tables/protected-local-launch-session-profiles.yaml`.

Desktop is the current protected launcher implementation, not the principal or
semantic owner. Public names are host-neutral. Ordinary gRPC, endpoint/env
selection, app id, caller metadata, copied lease, raw executable self-launch,
and direct Runtime process launch are forbidden. `OpenDesktopSession` account
control remains unchanged and Desktop-specific.

## macOS Protected-local Admission Companion

`P-NAPP-037` 的单一权威正文位于
`macos-protected-local-admission-contract.md`。该拆分仅隔离独立平台 admission
的高复杂度信任链；本契约仍拥有 `P-NAPP-*` domain，且 companion 不得创建
第二套 catalog、permission、Runtime session 或 local-app authority。
## Fact Sources

- `.nimi/spec/platform/kernel/architecture-contract.md` — `P-ARCH-001..P-ARCH-021`
- `.nimi/spec/platform/kernel/nimi-home-contract.md` — `P-HOME-001..P-HOME-010`
- `.nimi/spec/platform/kernel/nimi-self-update-contract.md` — `P-SUPD-001..P-SUPD-008`
- `.nimi/spec/platform/kernel/nimi-package-release-contract.md` — `P-PKGREL-001..P-PKGREL-008`
- `.nimi/spec/platform/kernel/cold-start-authority-contract.md` — `P-COLD-001..P-COLD-008`
- `.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md` — `P-AIPS-001..P-AIPS-013`
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — `P-AISC-001..P-AISC-005`
- `.nimi/spec/platform/kernel/capability-catalog-contract.md` — `P-CAPCAT-*`
- `.nimi/spec/platform/kernel/app-slice-admission-contract.md` — `P-APP-*`
- `.nimi/spec/platform/kernel/package-authority-admission-contract.md` — `P-PKG-*`
- `.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-app-release-descriptors.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-app-trust-tiers.yaml`
  - `.nimi/spec/platform/kernel/tables/nimi-app-local-development-admission.yaml`
  - `.nimi/spec/platform/kernel/tables/protected-local-executable-trust-sets.yaml`
- `.nimi/spec/platform/kernel/kit-contract.md` — `P-KIT-041C`, `P-KIT-041E`, `P-KIT-044`
- `.nimi/spec/desktop/shell-ui.authority.yaml` — `rule.nimi.desktop.shell-ui.r038`
- `.nimi/spec/desktop/kernel/tables/local-app-launch-hosts.yaml`
- `.nimi/spec/sdks/kernel/nimi-app-client-contract.md` — `S-APP-001..S-APP-022`
- `.nimi/spec/runtime/kernel/account-session-contract.md` — `K-ACCSVC-*`
- `.nimi/spec/runtime/kernel/app-messaging-contract.md` — `K-APP-*`
- `.nimi/spec/runtime/kernel/local-engine-runtime-environment-contract.md` — `K-LENG-024..K-LENG-027`
- `.nimi/spec/runtime/kernel/tables/protected-local-launch-session-profiles.yaml`
- `.nimi/spec/runtime/kernel/tables/protected-local-os-profiles.yaml`
- `.nimi/spec/runtime/kernel/tables/protected-local-runtime-principal-profiles.yaml`
- `.nimi/spec/runtime/kernel/tables/protected-local-custody-profiles.yaml`
- `.nimi/spec/runtime/kernel/local-environment-materializers-contract.md` — `K-LENG-028`
- `.nimi/spec/desktop/shell-ui.authority.yaml` — `rule.nimi.desktop.shell-ui.r049..r061`

---

<!-- source: .nimi/spec/platform/kernel/nimi-app-audit-pipeline-contract.md -->

# Nimi App Audit Pipeline Contract

> Owner Domain: `P-AUDIT-*`

## Scope

This contract is the Platform-level authority for the third-party Nimi App
audit pipeline: the publish-to-admission gate sequence, the typed
evidence-class composition of the audit pipeline, the AI-audit triage-and-
evidence-only posture, the solo-reviewer classification rule within the
already-admitted `P-ECO-004` review-state set and tier-to-adjudicator
mapping, the non-gate posture of the developer-side `nimi audit` dry-run
command, and the review-evidence shape carried on the admitted release
descriptor's review block.

This contract does not own and MUST NOT redefine:

- the `P-ECO-004` typed review-state set (`submitted`, `under-review`,
  `revision-requested`, `approved`, `rejected`, `kill-switched`) — that
  set remains `P-ECO-004` authority;
- the `P-ECO-004` tier-to-adjudicator mapping (`nimi-first-party` →
  `review-internal`; `nimi-verified-partner` → `review-manual-full`;
  `nimi-community` → `review-automated-with-manual-kill-switch`) — that
  mapping remains `P-ECO-004` authority;
- the `P-ECO-003` trust-tier floor enum (`nimi-first-party`,
  `nimi-verified-partner`, `nimi-community`) — that enum remains
  `P-ECO-003` authority;
- the `P-NAPP-025` review-decision schema (closed enum subset of the
  `P-ECO-004` terminal states plus `adjudicator_kind`, `adjudicator_ref`,
  `decided_at`) — that schema remains `P-NAPP-025` authority and is
  cross-referenced from `P-AUDIT-006`, never redefined.

## P-AUDIT Family Seam (OWNS / DOES NOT OWN)

`P-AUDIT-*` OWNS:

- the publish-to-admission gate sequence (`P-AUDIT-001`);
- the typed audit-pipeline composition by evidence classes
  (`P-AUDIT-002`);
- the AI-audit triage-and-evidence-only posture, including the explicit
  forbidden shortcuts `ai_only_review` and `self_attested_scan` as
  admission gate (`P-AUDIT-003`);
- the adjudicator classification rule (manual class / automated class)
  WITHIN `P-ECO-004` already-admitted bounds (`P-AUDIT-004`);
- the non-gate posture of the developer-side `nimi audit` dry-run
  command (`P-AUDIT-005`);
- the review-evidence shape on the admitted release descriptor's
  review block (`P-AUDIT-006`);
- the review-state transition audit-event admission surface
  (`P-AUDIT-007`), which records transitions that consume `P-ECO-004`
  states but does not redefine those states.

`P-AUDIT-*` DOES NOT OWN:

- the `P-ECO-004` review-state set — owned by `nimi-ecosystem-contract.md`;
- the `P-ECO-004` tier-to-adjudicator mapping — owned by
  `nimi-ecosystem-contract.md`;
- the `P-ECO-003` trust-tier floor enum — owned by
  `nimi-ecosystem-contract.md`;
- the `P-NAPP-025` review-decision schema — owned by
  `nimi-app-admission-contract.md` and cross-referenced from
  `P-AUDIT-006` and `P-AUDIT-007`.

`P-AUDIT-*` is additive on TOP of the already-admitted `P-ECO-003`,
`P-ECO-004`, `P-NAPP-013`, `P-NAPP-014`, and `P-NAPP-018..030`. It
imposes pipeline-composition, evidence-class, and classification rigor
rather than replacing any admitted rule.

## P-AUDIT-001 — Publish-To-Admission Gate Sequence

`MUST`：every third-party Nimi App admission MUST progress through the
ordered gate sequence `submit → preflight → audit → review → admit`.
Each stage has a required-truth statement and a forbidden-shortcut
statement; admission MUST fail closed when a stage's required truth is
absent or when its forbidden shortcut is taken.

The ordered stages, with required truth and forbidden shortcut, are:

| Stage | Required truth | Forbidden shortcut |
|---|---|---|
| `submit` | immutable candidate artifact plus manifest inputs (immutable source reference per `P-NAPP-014`; manifest inputs per `P-NAPP-018`) | mutable branch or mutable tag without protection as product version (forbidden install inputs per `tables/nimi-app-release-descriptors.yaml` `third_party_descriptor_floor.forbidden_install_inputs`) |
| `preflight` | schema validation of manifest and descriptor, artifact-digest verification (`P-NAPP-014`), mirror-license clearance (`P-NAPP-022`), and dependency-inventory presence | accepting a manifest as admission-ready because required fields are present (a present field set is not a passed audit) |
| `audit` | Nimi-run scanners plus AI-audit triage executed on the exact reviewed commit and the exact admitted artifact, per the typed evidence classes admitted in `P-AUDIT-002` | `self_attested_scan` substituting developer-supplied scan output for Nimi-run scanners; `ai_only_review` substituting an AI-only verdict for the composite pipeline |
| `review` | identity, provenance, scope, runtime, license, policy, support, and storage gates resolved against the admitted descriptor's review-evidence shape (`P-AUDIT-006`) and the `P-NAPP-013` PR-admission path | AI-only approval substituting for the composite review-evidence shape |
| `admit` | registry row in `tables/nimi-app-registry.yaml` and release descriptor in `tables/nimi-app-release-descriptors.yaml` committed together as a single admission event | app-local spec presence, GitHub repository ownership, npm package name, or any parallel-truth artifact treated as admission |

`MUST`：the sequence is strictly ordered. `admit` MUST NOT precede
`review`. `review` MUST NOT precede `audit`. `audit` MUST NOT precede
`preflight`. `preflight` MUST NOT precede `submit`. A later stage
proceeding before its predecessor has produced its required-truth output
fails admission closed with typed reason `gate_sequence_violation`.

`MUST`：each gate transition emits an admitted audit event recording the
stage entered, the stage exited, and the required-truth evidence
references the stage consumed (`P-AUDIT-001` is the admission location
for the gate-transition audit-event obligation; the obligation does not
derive from any other rule. `P-ECO-004` at
`.nimi/spec/platform/kernel/nimi-ecosystem-contract.md` lines 48-67
admits only the review-state set, the tier-to-adjudicator mapping, the
no-silent-jump invariant, and the kill-switched-terminal invariant — it
does NOT admit a state-transition audit-event obligation. This MUST
clause records that gate-sequence transitions are themselves audited as
a `P-AUDIT-001` admission, with no upstream authority dependency).

`MUST NOT`：a gate MUST NOT silently degrade into a rubber stamp. A
stage whose forbidden-shortcut row is taken at execution time MUST NOT
project a passed result. The forbidden-shortcut clauses are
typed-failure invariants, not advisory text.

`MUST NOT`：this rule MUST NOT redefine the `P-ECO-004` review-state
set or its tier-to-adjudicator mapping. `P-AUDIT-001` admits the
publish-to-admission gate ordering ABOVE the review state machine; the
review state machine remains `P-ECO-004` authority.

## P-AUDIT-002 — Audit Pipeline Composition By Typed Evidence Classes

`MUST`：the `audit` stage of `P-AUDIT-001` is a composite pipeline whose
layers are typed by evidence class. The admitted evidence classes,
each filled by a swappable adapter slot, are:

- `malicious-package-scanner` — dependency / supply-chain scanner
  detecting malicious packages in the audited dependency closure;
- `known-vuln-scanner` — dependency / supply-chain scanner detecting
  known-vulnerability dependencies in the audited dependency closure;
- `sast` — static-analysis scanner over the audited source tree;
- `repository-posture-scorer` — repository security-posture signal
  scorer over the audited repository;
- `malware-reputation-scanner` — known-signature scan over the
  admitted artifact;
- `ai-audit` — Nimi AI audit producing semantic / malice triage over
  the audited source tree and the audited diff.

`MUST`：every evidence class is admitted as a swappable adapter slot.
The contract surface admits the class identity; concrete adapter
selection is operational and is replaceable without re-admitting this
rule. Each class is extensible — additional adapter selections within a
class do not change the class set.

`MUST`：every audit pipeline run resolves all six evidence-class slots
against an admitted adapter for the class. Missing adapter coverage on
any class fails the `audit` stage closed with typed reason
`audit_class_coverage_missing`.

`MUST`：all evidence classes run on the exact audited commit and the
exact admitted artifact. A pipeline output computed against any other
input is not admission evidence (consistent with `P-AUDIT-001`
`audit`-stage required truth).

`MUST NOT`：this rule MUST NOT name a specific vendor, product, or
provider in the evidence-class enumeration. The contract surface names
evidence classes only; naming vendors here would violate the repo-wide
no-hardcoded-provider-list rule and would create vendor lock at the
spec authority surface.

`MUST NOT`：the evidence-class enumeration MUST NOT be reduced to a
proper subset. Each class is independently required; collapsing any
two into one fails admission's audit stage closed with typed reason
`audit_class_coverage_missing`.

## P-AUDIT-003 — AI Audit Is Triage And Evidence Only

`MUST`：the `ai-audit` evidence class admitted in `P-AUDIT-002` is
triage-and-evidence-only. Its output is a typed evidence record that
the review stage and any classification rule consume; it is not, by
itself, an admission verdict.

`MUST NOT`：`ai_only_review` — an AI-only verdict accepted as the
admission gate without the composite evidence classes admitted in
`P-AUDIT-002` and without the adjudicator admitted by `P-AUDIT-004`
within `P-ECO-004` bounds — MUST NOT be admitted as the admission
gate. Attempting to admit an `ai_only_review` outcome fails admission
closed with typed reason `ai_only_review_forbidden`.

`MUST NOT`：`self_attested_scan` — a developer-side scan result
submitted as the authoritative evidence for one of the deterministic
evidence classes (`malicious-package-scanner`, `known-vuln-scanner`,
`sast`, `repository-posture-scorer`, `malware-reputation-scanner`) —
MUST NOT be admitted as that class's authoritative evidence.
Developer-side scan results MAY appear in the review-evidence record
as developer-supplied context (for reviewer awareness, cross-checking,
or transparency), but they MUST NOT replace the Nimi-run scanner
output for the corresponding evidence class. Attempting to substitute
a `self_attested_scan` for the Nimi-run scanner output fails admission
closed with typed reason `self_attested_scan_forbidden`.

`MUST NOT`：this rule MUST NOT weaken the composite-pipeline
requirement admitted in `P-AUDIT-002`. The pipeline composition is the
floor; this rule restricts how the `ai-audit` class is consumed and
forbids the two named substitution shortcuts.

## P-AUDIT-004 — Solo-Reviewer Classification Rule

`MUST`：every third-party admission whose `trust_tier_ref` resolves to
`nimi-community` MUST be classified into exactly one of two adjudicator
classes BEFORE the `review` stage of `P-AUDIT-001` selects an
adjudicator. The two classes are:

- **MANUAL CLASS** — a new app OR a risk-surface-changing version. A
  risk-surface-changing version is defined as any admission that
  changes any of the following descriptor fields relative to the prior
  admitted version of the same `app_id`:
  - Nimi API scopes (`permissions_ref` resolution changes — any added,
    removed, or qualifier-changed `P-PERM-*` scope reference);
  - publisher namespace (`publisher.github_namespace` or
    `publisher.namespace_kind` change);
  - build profile (`build_assurance` value change — e.g.
    `developer-attested` → `reproducible-verified`, or any other
    transition admitted by `P-NAPP-023`).
- **AUTOMATED CLASS** — a risk-stable patch. A risk-stable patch is
  defined as an admission that changes none of the three risk-surface
  fields above and whose descriptor diff against the prior admitted
  version of the same `app_id` is clean (no new descriptor fields
  carry risk-surface-changing values; the diff is bounded to artifact
  content updates within the same `build_assurance`, `permissions_ref`,
  and publisher posture).

`MUST`：classification is produced by the AI-audit diff-report output
admitted in `P-AUDIT-002` `ai-audit` evidence class. The classification
output is itself an evidence record and is consumed by the review stage
before an adjudicator is selected. An unclassifiable diff fails closed
with typed reason `solo_reviewer_classification_unresolved`.

`MUST`：classification interacts with the `P-ECO-004` already-admitted
tier-to-adjudicator mapping as follows. This interaction adds rigor on
TOP of `P-ECO-004` admitted set and MUST NOT replace it.

- `nimi-verified-partner` (`P-ECO-004` posture
  `review-manual-full`): always manual adjudication regardless of the
  classification produced by this rule. Full manual review is the
  tier floor admitted by `P-ECO-004`; this rule's classification lever
  MUST NOT weaken the floor. A classification of AUTOMATED CLASS on a
  `nimi-verified-partner` admission has NO effect on the adjudicator
  selection; the adjudicator remains human per the `P-ECO-004` floor.
- `nimi-community` (`P-ECO-004` posture
  `review-automated-with-manual-kill-switch`): the classification
  produced by this rule drives the adjudicator selection within the
  posture's already-admitted bounds. MANUAL CLASS triggers human
  adjudication. AUTOMATED CLASS uses the Nimi-run automated final
  gate; the gate escalates to human adjudication when any scanner
  evidence class (`malicious-package-scanner`, `known-vuln-scanner`,
  `sast`, `repository-posture-scorer`, `malware-reputation-scanner`)
  produces a flag, or when `ai-audit` triage flags a risk-elevating
  signal.
- `nimi-first-party` (`P-ECO-004` posture `review-internal`): out of
  scope for this rule's classification lever. `nimi-first-party`
  admissions follow the internal review posture admitted by
  `P-ECO-004`; this rule's MANUAL/AUTOMATED classification is not
  applied.

### Superset Clarification

This sub-section records the active Solo-Reviewer Lever and clarifies that
`P-AUDIT-004`'s classification rule adds rigor ON TOP of `P-ECO-004`'s
already-admitted set and does NOT replace any admitted rule:

> ## 5. Solo-Reviewer Lever
>
> The audit pipeline runs for every submission. What is the final adjudicator
> varies by risk surface:
>
> - **New app, and every risk-surface-changing version** (a version that changes
>   Nimi API scopes, publisher namespace, or build profile): the human reviewer
>   is the final gate. The audit pipeline produces evidence; the human reads it
>   and decides.
> - **Risk-stable patch** (no Nimi API scope change, no publisher change, no
>   build-profile change; clean descriptor diff): the Nimi-run automated gate is
>   the final gate; no human adjudication is required unless a scanner or AI
>   triage flag escalates. The AI-audit diff report drives the
>   risk-stable-or-not classification.
>
> This conforms to `P-ECO-004` (`nimi-verified-partner` = `review-manual-full`;
> `nimi-community` = `review-automated-with-manual-kill-switch`) and does not
> redefine either posture.

`P-AUDIT-004` admits the classification rule that the verbatim parent
language describes. The lever is a superset operation: it adds the
MANUAL CLASS / AUTOMATED CLASS classification on top of `P-ECO-004`'s
admitted tier-to-adjudicator mapping. The `nimi-verified-partner` floor
remains `review-manual-full` regardless of the classification lever
because the floor is admitted by `P-ECO-004` and this rule MUST NOT
weaken it. The `nimi-community` posture remains
`review-automated-with-manual-kill-switch` admitted by `P-ECO-004`;
this rule selects between the automated and human adjudicators WITHIN
that posture's admitted bounds. The `nimi-first-party` posture remains
`review-internal` admitted by `P-ECO-004`; this rule's lever is out of
scope for that tier.

`MUST NOT`：this rule MUST NOT redefine the `P-ECO-004` review-state
set. The states `submitted`, `under-review`, `revision-requested`,
`approved`, `rejected`, `kill-switched` remain `P-ECO-004` authority.

`MUST NOT`：this rule MUST NOT redefine the `P-ECO-004`
tier-to-adjudicator mapping. The per-tier postures `review-internal`,
`review-manual-full`, and `review-automated-with-manual-kill-switch`
remain `P-ECO-004` authority. This rule classifies submissions WITHIN
those postures' admitted bounds for the single tier
(`nimi-community`) where the posture admits both adjudicator kinds.

`MUST NOT`：this rule MUST NOT weaken the `nimi-verified-partner`
`review-manual-full` floor. The MANUAL/AUTOMATED classification has no
effect on that tier's adjudicator selection. Any execution path that
allows the classification lever to override the
`nimi-verified-partner` floor fails admission closed with typed reason
`tier_floor_violation`.

## P-AUDIT-005 — Developer-Side `nimi audit` Dry-Run Is Not An Admission Gate

`MUST`：the developer-side `nimi audit` command is a dry-run. Its
output is a pre-submission self-check, never an admission outcome.
The authoritative audit is the Nimi-run pipeline admitted in
`P-AUDIT-002`, executed on the exact reviewed commit and the exact
admitted artifact at the `audit` stage of `P-AUDIT-001`.

`MUST`：results emitted by the developer-side `nimi audit` command
MAY be surfaced in the review-evidence record as developer-supplied
context only. They are not Nimi-run scanner output for any evidence
class admitted in `P-AUDIT-002`, and they MUST NOT substitute for
that output (consistent with `P-AUDIT-003` `self_attested_scan`
forbidden-shortcut clause).

`MUST NOT`：`nimi audit` developer-side output MUST NOT be treated as
an authoritative admission gate. Attempting to admit on the strength
of a developer-side `nimi audit` outcome fails admission closed with
typed reason `developer_side_audit_not_gate`.

**Cross-reference**：this rule cross-references
`P-DEV-003` (`nimi-app-developer-workflow-contract.md`),
which admits the developer-side `nimi audit` command itself.
`P-AUDIT-005` admits the non-gate status of the developer-side
command; `P-DEV-003` admits the command and its developer-workflow
positioning. The two rules are coupled by reference and admit
disjoint surfaces (non-gate posture vs developer-workflow surface).

## P-AUDIT-006 — Review-Evidence Shape

`MUST`：the admitted release descriptor's review block carries a
typed audit-evidence shape composed of the following typed fields:

- `audit_evidence_ref` — string reference to the audit-pipeline
  evidence record produced by the `audit` stage of `P-AUDIT-001` over
  the six evidence classes admitted in `P-AUDIT-002`. The reference
  resolves to the typed evidence record consumed by the review stage
  and stored as admission evidence;
- `ai_audit_model_ref` — string reference to the AI-audit model
  identifier and version that produced the `ai-audit` evidence class
  output. This field is MANDATORY whenever the `ai-audit` evidence
  class is in scope for the admission (i.e. for every third-party
  admission, per `P-AUDIT-002` evidence-class enumeration). A missing
  `ai_audit_model_ref` while `ai-audit` evidence is in scope fails
  admission closed with typed reason `ai_audit_model_ref_missing`;
- `scanner_results_ref` — string reference to the consolidated
  Nimi-run scanner-results record covering the deterministic evidence
  classes (`malicious-package-scanner`, `known-vuln-scanner`, `sast`,
  `repository-posture-scorer`, `malware-reputation-scanner`).

`MUST`：the admitted release descriptor's review block additionally
carries the review-decision schema admitted in `P-NAPP-025`
(`review.decision`, `review.adjudicator_kind`, `review.adjudicator_ref`,
`review.decided_at`). `P-AUDIT-006` cross-references `P-NAPP-025` and
DOES NOT redefine it. The decision schema is the descriptor's
terminal-decision record; the audit-evidence fields admitted here are
the upstream evidence references the decision record consumes.

`MUST`：the three audit-evidence references (`audit_evidence_ref`,
`ai_audit_model_ref`, `scanner_results_ref`) and the four review-
decision fields admitted by `P-NAPP-025` are distinct typed fields.
Collapsing any two into a single field fails admission closed with
typed reason `review_evidence_shape_collapsed`.

`MUST NOT`：this rule MUST NOT redefine `P-NAPP-025`. The
review-decision schema (the closed enum `approved`,
`revision-requested`, `rejected`, `kill-switched`; the
`adjudicator_kind` enum `human | nimi-automated-gate`;
`adjudicator_ref`; `decided_at`) is owned by `P-NAPP-025` and is
not redefined here; this rule cross-references that schema as the
descriptor's decision-record surface that consumes the evidence
references admitted here.

`MUST NOT`：the three audit-evidence references MUST NOT be inferred
from the developer-authored manifest. They are Nimi-owned audit
evidence produced by the `audit` stage of `P-AUDIT-001` over the six
typed evidence classes admitted in `P-AUDIT-002`; the
developer-authored manifest is not admission evidence (consistent
with `P-NAPP-018` `MUST NOT` and `P-NAPP-013` `MUST NOT` against
parallel-truth substrates).

## P-AUDIT-007 — Review-State Transition Audit Events

`MUST`：every transition between admitted `P-ECO-004` review states
(`submitted`, `under-review`, `revision-requested`, `approved`,
`rejected`, `kill-switched`) emits an admitted audit event recording
the following typed fields:

- `from_state` — the `P-ECO-004` review state the transition exited;
- `to_state` — the `P-ECO-004` review state the transition entered;
- `transition_cause` — the typed cause of the transition (admitted
  causes are the `P-NAPP-025` `review.decision` enum values
  `approved`, `revision-requested`, `rejected`, `kill-switched`, plus
  the typed intake-cause `submitted` for the entry transition into
  `submitted` and the typed assignment-cause `under-review-assigned`
  for the entry transition into `under-review`);
- `decided_at` — the `P-NAPP-025` `review.decided_at` timestamp at
  which the transition was decided, in the typed timestamp shape
  admitted by `P-NAPP-025`;
- `adjudicator_ref` — the `P-NAPP-025` `review.adjudicator_ref`
  evidence pointer for the transition, resolving to the
  `P-AUDIT-006` `audit_evidence_ref` chain for the admitted decision.

Failure to emit the audit event on a `P-ECO-004` review-state
transition fails admission closed with typed reason
`review_state_transition_audit_missing`.

`MUST`：`P-AUDIT-007` is the admission location for the
review-state transition audit-event obligation. The obligation does
NOT derive from `P-ECO-004`. `P-ECO-004` at
`.nimi/spec/platform/kernel/nimi-ecosystem-contract.md` lines 48-67
admits only the review-state set, the tier-to-adjudicator mapping,
the no-silent-jump invariant, and the kill-switched-terminal
invariant — it does NOT admit a state-transition audit-event
obligation. `P-AUDIT-007` layers the state-transition audit-event
obligation on top of the `P-ECO-004`-admitted state set; the two
rules are coupled by reference and admit disjoint surfaces (state
set and lifecycle invariants vs audit-event-on-transition
obligation).

`MUST`：`P-AUDIT-007` and `P-AUDIT-001` admit audit-event
obligations for two SEPARATE state machines. `P-AUDIT-001` admits
the gate-sequence transition audit-event obligation
(`submit → preflight → audit → review → admit`); `P-AUDIT-007`
admits the review-state transition audit-event obligation
(`P-ECO-004` review-state set). Each rule emits its own typed audit
event; neither substitutes for the other. A
`P-AUDIT-001` gate-transition audit event MUST NOT be projected as
a `P-AUDIT-007` review-state-transition audit event, and vice
versa.

`MUST NOT`：this rule MUST NOT redefine the `P-ECO-004` review-state
set or the `P-ECO-004` tier-to-adjudicator mapping. The state set
(`submitted`, `under-review`, `revision-requested`, `approved`,
`rejected`, `kill-switched`) and the tier-to-adjudicator mapping
remain `P-ECO-004` authority; `P-AUDIT-007` consumes them by
reference.

`MUST NOT`：this rule MUST NOT redefine the `P-NAPP-025`
review-decision schema (`review.decision`, `review.adjudicator_kind`,
`review.adjudicator_ref`, `review.decided_at`) or the `P-AUDIT-006`
audit-evidence shape (`audit_evidence_ref`, `ai_audit_model_ref`,
`scanner_results_ref`). The `transition_cause`, `decided_at`, and
`adjudicator_ref` fields admitted here cross-reference the
`P-NAPP-025` and `P-AUDIT-006` schemas as their canonical sources
and do not redefine them.

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-ecosystem-contract.md` — `P-ECO-001..P-ECO-010`
  (review-state set, tier-to-adjudicator mapping, trust-tier floor enum;
  consumed by `P-AUDIT-001` and `P-AUDIT-004`, never redefined)
- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-013`,
  `P-NAPP-014`, `P-NAPP-018`, `P-NAPP-025` (PR-admission path, immutable
  descriptor verification, descriptor shape, review-decision schema;
  cross-referenced from `P-AUDIT-001`, `P-AUDIT-002`, `P-AUDIT-006`)
- `.nimi/spec/platform/kernel/tables/nimi-app-release-descriptors.yaml`
  (`third_party_descriptor_floor.forbidden_install_inputs` consumed at
  `P-AUDIT-001` `submit`-stage forbidden-shortcut clause; descriptor
  shape consumed at `P-AUDIT-006` review-evidence shape)
- `.nimi/spec/platform/kernel/nimi-app-developer-workflow-contract.md` —
  `P-DEV-003` (developer-side `nimi audit` command; cross-referenced from
  `P-AUDIT-005`)
- This contract is the active authority for publish-to-admission gate sequence,
  audit pipeline, tier-review posture, review-state transition audit events,
  and solo-reviewer lever. `P-ECO-004` remains the active authority for the
  review-state set and tier-to-adjudicator mapping.

---

<!-- source: .nimi/spec/platform/kernel/nimi-app-developer-workflow-contract.md -->

# Nimi App Developer Workflow Contract

> Owner Domain: `P-DEV-*`

## Scope

This contract is the Platform-level authority for the third-party Nimi
App developer-side workflow: the developer repository layout that
precedes a submission, the ordered developer workflow step sequence,
the developer-side `nimi audit` dry-run command (non-gate posture
cross-referenced from `P-AUDIT-005`), the immutable-submission rule
on the candidate artifact's source reference, and the PR-based
admission obligations placed on the developer side that consume the
already-admitted `P-NAPP-013` admission-path mechanism.

It also owns the single production-shipped Developer Mode product workflow for
mutable `local_development` projects. That workflow is independent of package
format/import implementation: it consumes the final 0K principal, protected
launch/session, grant, and owner-operation seams and cannot create a dev-only
authorization model.

This contract does not own and MUST NOT redefine:

- the `P-NAPP-013` PR-admission path mechanism (the registry-row,
  permission-requirement, Runtime-registration-requirement,
  AIConfig/profile-hint, exact-version, immutable-source-reference,
  release-descriptor-reference, artifact-digest/size/signature/
  provenance-evidence, and storage-policy reviewable change-set
  enumeration). That mechanism remains `P-NAPP-013` authority and is
  cross-referenced from `P-DEV-005`, never redefined;
- the `P-NAPP-014` release-descriptor immutability and digest
  verification rule. That rule remains `P-NAPP-014` authority and is
  cross-referenced from `P-DEV-004`, never redefined;
- the `P-NAPP-018` third-party release-descriptor shape (publisher,
  source, artifact, build/dependency/platform-signing assurance,
  permissions, storage, review). That shape remains `P-NAPP-018`
  authority and is referenced as the schema target consumed by the
  developer-authored `nimi.app.yaml` input under `P-DEV-001`;
- the `P-AUDIT-001` publish-to-admission gate sequence
  (`submit → preflight → audit → review → admit`). That sequence
  remains `P-AUDIT-001` authority; the developer workflow under
  `P-DEV-002` is the developer-side surface that produces the
  `submit`-stage input and the dry-run pre-submission self-check that
  precedes it;
- the `P-AUDIT-002` typed audit-pipeline composition by evidence
  classes. That composition remains `P-AUDIT-002` authority; the
  developer-side `nimi audit` command admitted under `P-DEV-003` is
  not a substitute for any evidence class admitted there;
- the `P-AUDIT-005` non-gate posture of the developer-side `nimi
  audit` command. That posture remains `P-AUDIT-005` authority and is
  cross-referenced from `P-DEV-003`. `P-DEV-003` admits the
  developer-side command and its developer-workflow positioning;
  `P-AUDIT-005` admits the non-gate posture. The two rules are
  coupled by mutual cross-reference and admit disjoint surfaces;
- the descriptor floor `forbidden_install_inputs` in
  `tables/nimi-app-release-descriptors.yaml` (mutable git branches,
  mutable git tags without protection, npm dist-tags, npm version
  ranges, direct `npx`, direct clone-build-run, arbitrary install
  scripts). That floor remains `P-NAPP-018` table authority; the
  developer-side immutable-submission rule under `P-DEV-004`
  references this floor as the consumer-of-source-reference
  constraint, never re-authors it.

## P-DEV Family Seam (OWNS / DOES NOT OWN)

`P-DEV-*` OWNS:

- the developer repository layout required-item set
  (`P-DEV-001`);
- the developer workflow step sequence with per-step
  required-truth and forbidden-shortcut (`P-DEV-002`);
- the developer-side `nimi audit` dry-run command surface
  (`P-DEV-003`), coupled to `P-AUDIT-005` by mutual
  cross-reference;
- the immutable-submission rule on the candidate artifact's
  source reference (`P-DEV-004`), with typed fail reason
  `mutable_submission_artifact`;
- the developer-side PR-based admission workflow obligations
  (`P-DEV-005`) layered on top of the already-admitted
  `P-NAPP-013` admission-path mechanism.

`P-DEV-*` DOES NOT OWN:

- the `P-NAPP-013` PR-admission path mechanism — owned by
  `nimi-app-admission-contract.md`;
- the `P-NAPP-014` release-descriptor immutability and digest
  verification rule — owned by `nimi-app-admission-contract.md`;
- the `P-NAPP-018` third-party release-descriptor shape — owned by
  `nimi-app-admission-contract.md`;
- the `P-AUDIT-001` publish-to-admission gate sequence — owned by
  `nimi-app-audit-pipeline-contract.md`;
- the `P-AUDIT-002` audit-pipeline composition by evidence classes
  — owned by `nimi-app-audit-pipeline-contract.md`;
- the `P-AUDIT-005` non-gate posture of the developer-side `nimi
  audit` command — owned by `nimi-app-audit-pipeline-contract.md`;
- the `tables/nimi-app-release-descriptors.yaml` descriptor floor
  `forbidden_install_inputs` enumeration — owned by
  `nimi-app-admission-contract.md` via its admitted table.

`P-DEV-*` is additive on TOP of the already-admitted `P-NAPP-013`,
`P-NAPP-014`, `P-NAPP-018`, `P-AUDIT-001..007`, and the
`tables/nimi-app-release-descriptors.yaml`
`third_party_descriptor_floor.forbidden_install_inputs` projection.
It admits the developer-side workflow obligations that produce the
inputs the admitted gate sequence consumes; it does not replace any
admitted rule.

## P-DEV-001 — Developer Repository Layout

`MUST`：every third-party Nimi App candidate submission MUST be backed
by a developer repository whose root (or admitted equivalent
location) carries the following items. Each item is independently
required; a missing item fails the developer workflow before the
`submit` step of `P-DEV-002` produces a PR.

| Item | Required-truth | Notes |
|---|---|---|
| `nimi.app.yaml` | developer-authored manifest input resolving the `P-NAPP-018` descriptor-shape field set as a submitted-manifest input | submitted-manifest input only; never admitted truth (per `P-NAPP-018` `MUST NOT` against developer-manifest-as-admission-truth and `P-NAPP-013` `MUST NOT` against parallel-truth substrates) |
| `LICENSE` | SPDX-detectable or explicit-custom license file | mirror-license clearance under `P-NAPP-022` consumes this; absence forecloses mirror admission |
| `SECURITY.md` | vulnerability-report channel disclosure | post-release detectability requirement on the developer side |
| `README.md` | product purpose, support, data handling, minimum Runtime / SDK statement | reviewable product description input |
| `AGENTS.md` | per `nimi-coding` governance — repository-local AI-coding agent guidance authoritative for AI-mediated changes to the developer repository | required at the developer-repository root per `nimi-coding` governance posture; this contract admits the requirement on the developer side |
| release artifact + attestation | the candidate release artifact and its signature / attestation bundle (`P-NAPP-018` `artifact.locator` / `artifact.signature_or_provenance_ref` inputs; `P-NAPP-014` digest-verifiable artifact input) | produced by the developer's build (or the Nimi CI build for `build_assurance: nimi-built`); the artifact is the candidate `submit`-stage input |

`MUST`：the required items are MUST-required at the developer
repository root OR at an admitted equivalent location (the equivalent
location is itself admitted by the submitted-manifest reviewable
change set per `P-NAPP-013`; a developer cannot unilaterally relocate
required items without an admitted equivalent-location declaration).
A required item resident only at an un-admitted location does not
satisfy this rule and fails the developer workflow with typed reason
`developer_repo_layout_incomplete`.

`MUST NOT`：`nimi.app.yaml` MUST NOT be treated as admission truth.
The admitted truth is the Platform-owned admitted release descriptor
in `tables/nimi-app-release-descriptors.yaml`, produced by review per
`P-NAPP-013`, `P-NAPP-014`, and `P-NAPP-018`. The developer manifest
is reviewable input only; this rule admits its presence at the
developer repository as a required input, not as admission truth.

`MUST NOT`：this rule MUST NOT redefine the `P-NAPP-018` descriptor
shape. The `nimi.app.yaml` developer manifest is an input that the
review stage resolves against the `P-NAPP-018` admitted shape; the
shape itself remains `P-NAPP-018` authority.

`MUST NOT`：this rule MUST NOT admit `optional SBOM` or `optional
scanner outputs` as required items. Such artifacts MAY be present in
the developer repository as developer-supplied context (consistent
with `P-AUDIT-003` `self_attested_scan` posture: developer-side scan
results MAY appear as developer-supplied context but MUST NOT
substitute for Nimi-run scanner output); they are not admitted as
required by this contract surface.

## P-DEV-002 — Developer Workflow Step Sequence

`MUST`：every third-party Nimi App candidate submission MUST progress
through the ordered developer-side step sequence
`pack → validate → local-audit-dry-run → submit → review-evidence →
CI-build → release-promotion`. The sequence is strictly ordered: a
later step MUST NOT proceed before its predecessor has produced its
required-truth output. Each step has a required-truth statement and a
forbidden-shortcut statement; the developer workflow fails closed
when a step's required truth is absent or when its forbidden shortcut
is taken.

The ordered steps, with required truth and forbidden shortcut, are:

| Step | Required truth | Forbidden shortcut |
|---|---|---|
| `pack` | `nimi-coding` packs the developer source tree against the `P-NAPP-018` admitted descriptor shape, producing a candidate `nimi.app.yaml` and a candidate build descriptor | hand-authored or hand-edited `nimi.app.yaml` that bypasses the `nimi-coding` pack step (manual authoring without the pack-step's schema-targeting output is not the admitted `pack` step output) |
| `validate` | `nimi-coding` validates the candidate manifest and build descriptor against the `P-NAPP-018` schema locally, producing a typed pass / typed-fail schema check before submission | a validate pass that ignores or masks one or more `P-NAPP-018` required descriptor fields (a present-field subset is not a validated descriptor) |
| `local-audit-dry-run` | the developer runs the developer-side `nimi audit` command (admitted under `P-DEV-003`) locally, producing a typed pre-submission self-check output | substituting the developer-side `nimi audit` output for the Nimi-run authoritative audit (forbidden under `P-DEV-003` and `P-AUDIT-005`; consistent with `P-AUDIT-003` `self_attested_scan` posture) |
| `submit` | the developer opens a PR into the Nimi App registry / package tables admitting, in one reviewable change set, the inputs enumerated by the already-admitted `P-NAPP-013` PR-admission path | submitting an artifact built from a mutable branch or a mutable tag without protection (forbidden under `P-DEV-004` and the descriptor-floor `forbidden_install_inputs` projection of `tables/nimi-app-release-descriptors.yaml`); GitHub repository ownership, npm package name, source directory, or app-local spec presence as admission claim (forbidden under `P-NAPP-013` `MUST NOT`) |
| `review-evidence` | Nimi runs the authoritative audit pipeline admitted under `P-AUDIT-001..007` on the exact reviewed commit and the exact admitted artifact; the output is Nimi-owned review evidence | developer-supplied scan output as the review evidence (forbidden under `P-AUDIT-003` `self_attested_scan` clause); AI-only verdict as review evidence (forbidden under `P-AUDIT-003` `ai_only_review` clause) |
| `CI-build` | for `build_assurance: nimi-built`, a Nimi-org reusable GitHub Actions workflow builds from the reviewed commit SHA, producing the admitted Nimi-signed artifact and its attestation; for `build_assurance: reproducible-verified` or `developer-attested`, the artifact and attestation produced by the admitted build posture are consumed as the admitted artifact | a `nimi-built` artifact built from a SHA other than the reviewed one, or built outside the Nimi-org reusable workflow (not the admitted CI build output); a `checksum-pinned` third-party build (third-party `checksum-pinned` not admitted per `P-NAPP-023` enum constraint) |
| `release-promotion` | upon review approval, Platform admits the registry row in `tables/nimi-app-registry.yaml` and the release descriptor in `tables/nimi-app-release-descriptors.yaml` together as a single admission event (per `P-AUDIT-001` `admit`-stage required truth) | promoting a release on app-local spec presence, GitHub repository ownership, npm package name, or any parallel-truth artifact (forbidden under `P-AUDIT-001` `admit`-stage forbidden-shortcut clause and `P-NAPP-013` `MUST NOT`) |

`MUST`：the sequence is strictly ordered. `release-promotion` MUST
NOT precede `CI-build`. `CI-build` MUST NOT precede `review-evidence`.
`review-evidence` MUST NOT precede `submit`. `submit` MUST NOT
precede `local-audit-dry-run`. `local-audit-dry-run` MUST NOT precede
`validate`. `validate` MUST NOT precede `pack`. A later step
proceeding before its predecessor has produced its required-truth
output fails the developer workflow with typed reason
`developer_workflow_sequence_violation`.

`MUST`：steps `pack`, `validate`, and `local-audit-dry-run` are
developer-side surfaces; they produce pre-submission inputs and
self-checks and MUST NOT be construed as admission gates. The
authoritative gate sequence is `P-AUDIT-001` `submit → preflight →
audit → review → admit`; `P-DEV-002`'s `submit` step is the input
boundary at which the developer side hands the candidate to the
Nimi-owned gate sequence.

`MUST`：steps `review-evidence`, `CI-build`, and `release-promotion`
project the Nimi-owned operations admitted under `P-AUDIT-001..007`
and `P-NAPP-013` onto the developer-side workflow surface. The
projection records the developer-visible step boundary; it does NOT
admit a developer-side authority over those operations. The
Nimi-owned authority over each of these steps remains with the
referenced rules.

`MUST NOT`：the step sequence MUST NOT be reduced to a proper subset
or re-ordered. Each step is independently required; collapsing any
two or skipping any step fails the developer workflow with typed
reason `developer_workflow_sequence_violation`.

`MUST NOT`：this rule MUST NOT admit a hosted developer portal, a
developer dashboard, or any non-PR submission substrate as the
`submit`-step substrate. The `submit`-step substrate is the PR
admitted under `P-NAPP-013`; any alternative substrate is out of
scope for this rule.

## P-DEV-003 — Developer-Side `nimi audit` Is Dry-Run Only

`MUST`：the developer-side `nimi audit` command admitted by this rule
is a pre-submission self-check that runs on the developer's local
machine against the developer-authored candidate `nimi.app.yaml` and
the developer's local source tree. Its output is a typed
self-check projection that the developer consumes locally before
opening a submission PR per `P-DEV-002` `submit` step.

`MUST`：the developer-side `nimi audit` command produces output that
MAY appear in the review-evidence record only as developer-supplied
context (per `P-AUDIT-005` `MUST` clause). It is not Nimi-run scanner
output for any evidence class admitted under `P-AUDIT-002`.

`MUST NOT`：the developer-side `nimi audit` command MUST NOT be
admitted as the authoritative admission gate. The authoritative audit
is the Nimi-run composite pipeline admitted under `P-AUDIT-002`,
executed on the exact reviewed commit and the exact admitted artifact
at the `audit` stage of `P-AUDIT-001` per `P-AUDIT-005`. Attempting
to admit on the strength of a developer-side `nimi audit` outcome
fails admission closed with typed reason
`developer_side_audit_not_gate` (the same typed reason admitted by
`P-AUDIT-005`).

`MUST NOT`：a developer-side `nimi audit` output MUST NOT substitute
for the Nimi-run scanner output for any deterministic evidence class
admitted under `P-AUDIT-002` (`malicious-package-scanner`,
`known-vuln-scanner`, `sast`, `repository-posture-scorer`,
`malware-reputation-scanner`). Such substitution is forbidden under
`P-AUDIT-003` `self_attested_scan` clause; this rule admits the
developer-side command surface within that bound.

**Cross-reference**：`P-AUDIT-005`
in `nimi-app-audit-pipeline-contract.md` admits the non-gate posture
of the developer-side `nimi audit` command and forward-references
`P-DEV-003` (this rule) as the developer-workflow surface admitting
the command itself. The two rules are coupled by mutual
cross-reference and admit disjoint surfaces: `P-AUDIT-005` admits
the non-gate posture (i.e. the developer-side command is NOT an
admission gate); `P-DEV-003` admits the developer-side command
itself and its developer-workflow positioning (i.e. WHERE the
developer-side command sits in the workflow). The freeze-protected
coupling is the mechanism by which the cross-reference remains a
single active authority relation rather than a parallel-truth admission.

## P-DEV-004 — Immutable Submission

`MUST`：the candidate artifact submitted at `P-DEV-002` `submit`-step
MUST be built from one of the following immutable source references
on the developer repository:

- a protected immutable Git tag (tag protection MUST be enforced by
  the developer repository host such that the tag's commit SHA cannot
  be re-pointed once protected; the protected tag's resolved commit
  SHA is the immutable source reference);
- a reviewed commit SHA (the commit SHA itself is immutable; the
  review-evidence record refers to this SHA as the audited commit
  per `P-AUDIT-001` `audit`-stage required-truth clause).

`MUST`：the submitted artifact's immutable source reference MUST be
recorded in the candidate `nimi.app.yaml` developer manifest input
under the `source.ref` field admitted by the `P-NAPP-018`
third-party descriptor shape, and MUST be carried through to the
admitted release descriptor in
`tables/nimi-app-release-descriptors.yaml` as the descriptor's
`source.ref`. The admitted descriptor is itself immutable per
`P-NAPP-014`.

`MUST NOT`：a mutable Git branch MUST NOT be admitted as the
candidate artifact's source reference. Admission on the strength of a
mutable branch reference fails closed with typed reason
`mutable_submission_artifact` (this rule's named typed fail reason).

`MUST NOT`：a mutable Git tag without protection (a tag whose commit
SHA can be re-pointed after creation by the developer or by repository
hosts other than via the protected-tag mechanism) MUST NOT be
admitted as the candidate artifact's source reference. Admission on
the strength of an unprotected mutable tag reference fails closed
with typed reason `mutable_submission_artifact`.

`MUST NOT`：an npm dist-tag, an npm version range, a `latest`
substring projection, or any other mutable resolver MUST NOT be
admitted as the candidate artifact's source reference. These are
already enumerated in the descriptor-floor
`forbidden_install_inputs` projection of
`tables/nimi-app-release-descriptors.yaml` (owned by
`P-NAPP-018`); this rule references that floor and admits the
developer-side workflow constraint that produces a source reference
consistent with the floor. Attempting to submit with such a resolver
fails closed with typed reason `mutable_submission_artifact`.

`MUST NOT`：this rule MUST NOT redefine `P-NAPP-014` or the
`forbidden_install_inputs` descriptor-floor enumeration. The
immutability of the admitted release descriptor itself is
`P-NAPP-014` authority; the floor enumeration is the
`P-NAPP-018`-owned table authority. This rule admits the
developer-side immutable-source-reference rule on the candidate
submission, layered on top of those already-admitted rules.

## P-DEV-005 — PR-Based Admission Workflow Obligations

`MUST`：the developer-side PR submission opened at `P-DEV-002`
`submit` step MUST consume the already-admitted `P-NAPP-013`
admission-path mechanism. The reviewable change set in the PR MUST
admit, in one PR, the inputs enumerated by `P-NAPP-013`:

- registry row metadata;
- permission requirements;
- Runtime registration requirements;
- AIConfig / profile requirement hints;
- exact version;
- immutable source reference (consistent with `P-DEV-004`);
- release descriptor reference;
- artifact digest, size, signature or provenance evidence where
  applicable;
- storage policy.

The above enumeration is the verbatim `P-NAPP-013` admission-path
input set; this rule cross-references that set and admits the
developer-side obligation to populate it. This rule does NOT
re-author the enumeration; `P-NAPP-013` remains the authority.

`MUST`：the developer-side workflow obligations admitted by this
rule are layered on top of `P-NAPP-013` and consist of:

- the PR opener (developer-side identity attached to the PR) is the
  developer who controls the developer repository (i.e. the
  publisher's GitHub namespace under `P-NAPP-018`
  `publisher.github_namespace`);
- the PR's submitted-artifact source reference satisfies `P-DEV-004`
  (protected immutable tag or reviewed commit SHA; no mutable
  branch, no unprotected mutable tag);
- the PR's accompanying developer-side `nimi audit` dry-run output
  (if surfaced) is presented as developer-supplied context only, per
  `P-DEV-003` and `P-AUDIT-005`;
- the PR's developer-authored `nimi.app.yaml` is the submitted
  manifest input under `P-DEV-001`, not the admitted truth (the
  admitted truth is the Platform-owned admitted release descriptor
  per `P-NAPP-018` and `P-NAPP-013`).

`MUST NOT`：this rule MUST NOT redefine the `P-NAPP-013`
admission-path mechanism. The mechanism — namely, that early
third-party app admission may begin as a GitHub PR into the
Platform-owned Nimi App registry / package tables admitting registry
row metadata, permission requirements, Runtime registration
requirements, AIConfig / profile requirement hints, exact version,
immutable source reference, release descriptor reference, artifact
digest / size / signature / provenance evidence where applicable, and
storage policy in the same reviewable change set — is owned by
`nimi-app-admission-contract.md` `P-NAPP-013`. This rule
cross-references that mechanism as the admission path the developer
side consumes; the path itself remains `P-NAPP-013` authority.

`MUST NOT`：a developer-side workflow obligation admitted by this
rule MUST NOT introduce a parallel admission substrate. GitHub
repository ownership, npm package name, source directory, app-local
spec presence, direct `npm install`, direct `npx`, mutable git
branch / tag, direct clone / build / run, or installer script
execution MUST NOT be admitted as the developer-side admission
substrate (the `MUST NOT` clauses of `P-NAPP-013` apply here by
cross-reference; this rule does NOT re-author them).

`MUST NOT`：this rule MUST NOT admit a non-PR substrate as the
developer-side admission entry. The PR is the admitted entry per
`P-NAPP-013` and the `P-AUDIT-001` `submit`-stage required-truth
clause; any alternative substrate (hosted developer portal,
developer dashboard, email submission, RPC submission) is out of
scope for this rule.

## P-DEV-006 — One Production Developer Mode

Nimi exposes one Developer Mode and one Dev Trust Set for platform integration
and third-party app development. The global toggle is discoverable in
production Desktop, defaults off, and grants nothing. A project's first
authorization uses Runtime-owned fresh presence and chooses exactly `run_once`
or `allow_project`.

The authorization binds Runtime-derived OS-user anchor, isolated local
principal, canonical project-root file identity, declared app id, exact
capability fingerprint, current account, and fixed shell/entry policy. Native
host/process/build identity, supervisor-run identity, and Runtime boot epoch are
short-lived launch/session proof and rotate on controlled replacement. HMR,
rebuild, host restart, supervisor replacement, Desktop restart, and Runtime
restart/upgrade/reinstall do not repeat consent while the durable project,
account, permission-requirement, shell/entry, and risk bindings remain exact.

Mode off, account switch/logout, supervisor termination, and Runtime replacement
revoke live technical sessions and run-once authority. They preserve exact
`allow_project` consent, which remains bound to its original account and never
auto-runs. Revoke, copied/changed project, account mismatch, permission-
requirement expansion, risk revision, or shell/entry/origin mismatch invalidates
or reapproves as specified by `tables/nimi-app-local-development-admission.yaml`.

An approved project may use a controlled production account solely through
Runtime-mediated operations and the same admitted permission-decision/owner
policy as every local app. It never receives account/provider credentials,
portable session proof, a generic protected proxy, or persistent Nimi-managed
logon/boot autostart. Product UX continuously identifies project/account/risk
and states that Nimi grants constrain Nimi APIs, not all ordinary Windows
rights of native development code.

## P-DEV-007 — External AI Host Workflow Boundary

The external AI host exclusively owns planning, decomposition, task lifecycle,
subagent coordination, continuation, waiting, resumption and completion. Nimi,
Nimicoding, Runtime, SDK, Kit, Desktop, app-tools and local apps may validate,
generate, build, run or project bounded product operations, but must not create,
mirror, advance, resume, close or execute host workflow state.

Repository topics, selected-target state, dispatch ledgers, manager/worker/
auditor state, daemon heartbeats and repository-owned task packets are not
product authority. Deterministic guarded generation/validation evidence may be
written only to its admitted owner surface and cannot become workflow truth.

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-013`
  (PR-admission path mechanism), `P-NAPP-014` (release-descriptor
  immutability and digest verification), `P-NAPP-018` (third-party
  release-descriptor shape; consumed by `P-DEV-001` as the
  developer-manifest schema target, and by `P-DEV-004` and
  `P-DEV-005` as the source-reference and reviewable-change-set
  authority surfaces; never redefined)
- `.nimi/spec/platform/kernel/nimi-app-audit-pipeline-contract.md` —
  `P-AUDIT-001` (publish-to-admission gate sequence; consumed at
  `P-DEV-002` `submit` / `review-evidence` / `release-promotion`
  steps), `P-AUDIT-002` (typed audit-pipeline composition; consumed
  at `P-DEV-003` `MUST NOT` against substitution), `P-AUDIT-003`
  (`ai_only_review` and `self_attested_scan` forbidden shortcuts;
  consumed at `P-DEV-002` `review-evidence` step forbidden-shortcut
  clause and at `P-DEV-003` `MUST NOT`), `P-AUDIT-005` (developer-side
  `nimi audit` non-gate posture; coupled by mutual cross-reference to
  `P-DEV-003` under the parent plan's rule-ID freeze posture)
- `.nimi/spec/platform/kernel/tables/nimi-app-release-descriptors.yaml`
  (`third_party_descriptor_floor.forbidden_install_inputs` referenced
  at `P-DEV-004` `MUST NOT` clause against mutable resolvers; the
  floor enumeration itself is owned by `P-NAPP-018`)
- This contract is the active authority for developer repository layout,
  workflow steps, local audit dry-run, CI build, immutable submission,
  production Developer Mode, and workflow non-targets.

---

<!-- source: .nimi/spec/platform/kernel/nimi-app-scaffolding-contract.md -->

# Nimi App Scaffolding Contract

> Owner Domain: `P-SCAF-*`

## Scope

This contract is the Platform-level authority for Nimi app scaffolding and
app-authoring repository maintenance. It defines the scaffolded developer
repository shape, supported profiles, managed-file semantics, app-authoring
command family, and downstream consumption of upstream Nimi App admission /
developer workflow authority.

This contract consumes, and does not redefine, public Nimi App admission,
review, descriptor, install/update/launch, permission grant, Runtime account
custody, Runtime scoped binding, SDK transport, or app-local spec admission
truth. Those surfaces remain owned by `P-NAPP-*`, `P-DEV-*`, `P-AUDIT-*`,
`P-APP-*`, `P-PERM-*`, `K-ACCSVC-*`, `K-BIND-*`, `K-APP-*`, and `S-APP-*` as
cited below.

## P-SCAF Family Seam (OWNS / DOES NOT OWN)

`P-SCAF-*` OWNS:

- Nimi app scaffolding product authority;
- the `standalone`, `workspace-app`, and explicit `tester-reference` profile split;
- generated developer-repository scaffold requirements;
- managed-file taxonomy for package-owned projections, scaffold-managed glue,
  and app-owned product code;
- `nimi-app create`, `nimi-app init`, `nimi-app doctor`, and
  `nimi-app update` authoring command semantics;
- the local-evidence acceptance harness role for this scaffolding contract;
- the A5 dependency that default scaffold content must not import
  `kit/features/model-test` until the Kit feature authority is admitted and
  its implementation/evidence obligations are closed.

`P-SCAF-*` DOES NOT OWN:

- public Nimi App admission, registry rows, release descriptors, artifact
  mirrors, review decisions, kill-switch truth, or ordinary-user install truth
  (`P-NAPP-013`, `P-NAPP-014`, `P-NAPP-018`, `P-NAPP-023`,
  `P-AUDIT-001..005`);
- developer workflow admission truth beyond generating inputs consumed by
  `P-DEV-001..005`;
- app-slice admission authority except for the explicit `workspace-app`
  consumer exception under `P-APP-001..006`;
- permission grant lifecycle or enforcement (`P-PERM-*`);
- Runtime account/session custody, scoped bindings, app launch, health,
  install, update, uninstall, or file-scope authority (`K-ACCSVC-*`,
  `K-BIND-*`, `K-APP-*`);
- SDK transport or generated-app auth helper implementation (`S-APP-*`);
- kit renderer shell or Rust shell implementation (`P-KIT-041`, `P-KIT-042`).

## P-SCAF-001 — App-Authoring Ownership

`MUST`: Platform owns the Nimi app scaffolding contract. Generated apps own
their app-specific product logic, product routes, product state, and product
feature behavior only after the scaffold has placed the admitted boundaries.

`MUST`: scaffolding produces developer repositories that can enter the upstream
developer workflow admitted by `P-DEV-001..005`. Scaffolding may generate
inputs for that workflow, but any admission outcome remains upstream Platform
truth.

`MUST NOT`: generated app product code must not become a local shadow owner for
public Nimi App admission, Runtime account custody, Runtime registration,
SDK client semantics, Realm login, permission grants, or kit shell behavior.

## P-SCAF-002 — Accepted A0-A5 Bootstrap Inputs

`MUST`: the following decisions are accepted 2026-05-24 bootstrap inputs and
are authoritative for this scaffolding contract:

| Decision | Accepted input |
|---|---|
| A0 | App authoring CLI authority stays `nimi-app create|init|doctor|update`; it does not move under the runtime-occupied `nimi app send|watch` namespace. |
| A1 | Public Rust crate delivery name is `nimi-shell-tauri`; standalone targets the published crate channel after API/publication mechanics are admitted, and workspace apps use Cargo path dependency. |
| A2 | SDK exposes one host-neutral local-app client after protected launch. Generated third-party apps use an injected `local_app_host` carrier and never select caller mode, trust class, endpoint, principal, grant, lease, or session. Bundled first-party composition remains separately owner-admitted. |
| A3 | Explicit `workspace-app` scaffolding may auto-write monorepo app-slice admission under `P-APP-*`; standalone scaffolding never writes admitted truth. |
| A4 | Local development uses the production Developer Mode authorization, isolated `local_development` principal, fixed Windows service, shared grant/evaluator, and host-private common local-app session. Direct daemon, mock auth, disabled gates, pseudo-success, and first-party self-declaration are forbidden. |
| A5 | Default scaffold content cannot import `kit/features/model-test` until Kit admits that feature surface. |

`MUST NOT`: later implementation must not reopen A0-A5 as compatibility
choices unless a new authority-bearing spec cut explicitly supersedes this rule.

## P-SCAF-003 — Scaffold Profile Split

`MUST`: Nimi app scaffolding admits exactly two default app-starter profile
families and one explicit proof/reference profile:

- `standalone`: an external developer app repository with its own `.nimi/**`
  host truth surface, published SDK/kit/Rust-shell dependencies, generated
  submitted-manifest input, and no admitted Platform truth by default.
- `workspace-app`: a monorepo app slice under `apps/<app>/...` that uses
  workspace dependencies and Cargo path dependency for the Rust shell crate
  surface; app-local `apps/<app>/spec/**` authority is admitted only through
  `P-APP-001..006`.
- `tester-reference`: an explicit internal ecosystem proof/reference scaffold
  profile. It may carry `apps/tester` proof composition, scenario presets,
  evidence UI, tester storage, and Electron/Tauri shell wiring so other
  implementation sessions can inspect a complete Nimi Runtime AI consume,
  SDK, Kit, and shell integration path.

`MUST`: `standalone` and `workspace-app` are generic app starter profiles.
They must not receive tester-only product surfaces such as `src/tester/**`,
tester settings fixtures, tester world-tour surfaces, tester-specific storage,
or tester proof UI by default.

`MUST`: `tester-reference` is opt-in only. It is not the default generic app
starter, does not create public Nimi App admission truth, and remains subject
to Runtime account/session custody, SDK transport, Kit shell, permission, and
descriptor boundaries.

`MUST NOT`: scaffolding must not invent any additional profile that bypasses
`P-APP-*`, `P-NAPP-*`, `P-DEV-*`, or Runtime account/session authority.
Implementing only one default starter profile does not satisfy this contract's
product line.

## P-SCAF-004 — Submitted Manifest Input Is Not Admitted Descriptor Truth

`MUST`: scaffolding may generate `nimi.app.yaml` only as a
developer-submitted manifest input consumed by `P-DEV-001`, `P-DEV-002`, and
the upstream review flow resolving to `P-NAPP-018` descriptor shape.

`MUST`: generated repository wording, scripts, tests, and local audit output
must label `nimi.app.yaml` as submitted input. The admitted descriptor remains
the Platform-owned release descriptor produced by review under `P-NAPP-013`,
`P-NAPP-014`, and `P-NAPP-018`.

`MUST NOT`: scaffolding must not create or imply admitted release descriptor
truth, registry row truth, review decision truth, mirror truth, ordinary-user
install truth, or public admission by generating `nimi.app.yaml`.

## P-SCAF-005 — Build Profile Requirements

`MUST`: generated repositories must include a build profile input for the
supported Tauri + pnpm scaffold profile. The input must carry at minimum:

- `build_profile_ref`;
- toolchain version;
- build command;
- output path;
- lockfile path.

`MUST`: the build profile is a developer workflow input consumed by
`P-DEV-002`, `P-NAPP-018`, and `P-NAPP-023`; it is not an admitted
descriptor, install source, or proof that a third-party artifact is safe.

`MUST NOT`: scaffolding must not emit `checksum-pinned` as an admitted
third-party publish path, must not turn local build success into admission, and
must not represent direct `npm install`, direct `npx`, mutable git refs, or
direct clone/build/run as ordinary-user install truth.

## P-SCAF-006 — Permission Declarations Are Transparency Only

`MUST`: generated manifests may declare closed `P-PERM-002` scope names,
qualifiers, and purpose strings as transparency and review input consumed by
`P-DEV-001`, `P-NAPP-018`, and SDK projection rules such as `S-APP-012`.

`MUST`: scaffolded app readiness and launch flows must consume real grant or
promptable-grant projection from the admitted Runtime / Realm / Platform
permission surfaces.

`MUST NOT`: submitted permission declarations must not be treated as granted
permissions, entitlement claims, launch authorization, AI spend authorization,
or a way to bypass the fail-closed denial state machine owned by `P-PERM-*`
and backend grant authorities.

## P-SCAF-007 — Managed File Taxonomy

`MUST`: generated repositories must classify generated files and regions into
exactly these mutation classes:

| Class | Mutation rule |
|---|---|
| package-owned projection | Regenerated by the owning package or `nimicoding`; user edits are drift. |
| scaffold-managed glue | Managed by `nimi-app update`; user changes require an explicit ownership escape hatch. |
| app-owned product code | Owned by the app developer and never overwritten by scaffold update. |

`MUST`: managed regions must be explicit. Whole-file management is allowed only
when the file exists solely as projection or glue.

`MUST NOT`: app-owned product files must not hide platform-owned auth/session,
Runtime, SDK, kit, descriptor, or permission behavior in local copies that the
scaffold cannot update or diagnose.

## P-SCAF-008 — App-Authoring Command Family

`MUST`: the admitted app-authoring command family is:

- `nimi-app create`;
- `nimi-app init`;
- `nimi-app doctor`;
- `nimi-app update`.

`MUST`: these commands are developer-repository authoring commands. They may be
implemented by developer tooling packages, but their authority remains this
Platform scaffolding contract plus the upstream contracts they consume.

`MUST NOT`: Runtime `nimi` public onboarding CLI must not own app scaffold
templates, build profiles, pack/publish flow, public admission, or scaffold
doctor/update semantics. Runtime CLI owns only the negative boundary recorded
by `K-CLI-009` and `K-CLI-009a`.

## P-SCAF-009 — Init, Doctor, And Update Semantics

`MUST`: `nimi-app create` writes the app source skeleton and an explicit
app-scaffold initialization intent only. It must not copy package-owned
`.nimi/{config,contracts,methodology}/**` projections from app-tools templates.

`MUST`: `nimi-app init` is the explicit post-install scaffold activation step.
It runs the pinned local `pnpm exec nimicoding sync --apply --json` projection
for package-owned `.nimi/{config,contracts,methodology}/**` files, then writes
app-scaffold admission/build-profile/lock state under app-scaffold-owned or
developer-submitted input paths.

`MUST`: `nimi-app init` consumes installed dependency state. It may be composed
by higher-level app-tools flows, but installation itself must not mutate
`.nimi/**` through hidden postinstall side effects.

`MUST NOT`: `nimi-app init` must not call interactive or project-reconstruction
oriented `nimicoding start` as the scaffold projection primitive. `nimicoding
start` may remain a user-facing generic onboarding entrypoint, but app scaffold
initialization requires deterministic sync/app-init semantics.

`MUST`: `nimi-app doctor` operates on developer scaffold state. It may inspect
scaffold lock/version state, managed-region drift, dependency version matrix,
SDK/kit/Rust shell/nimicoding alignment, forbidden auth/token/Realm bypass
patterns, `.nimi/**` projection drift, `AGENTS.md` freshness, submitted
manifest readiness, build profile readiness, support-file readiness, and
developer-side local audit dry-run readiness.

`MUST`: `nimi-app doctor --conformance simulator --json` is the App-side
qualification command for `P-SIM-*`. It validates the closed current
`nimi.simulator.yaml` schema, canonical renderer factory reachability,
production-entry and Nimi-host-invocation equality, canonical style closure,
per-instance isolation, Adapter and fixture shape, declared Kit/SDK needs,
forbidden source imports, and browser-effect policy. Its JSON report binds the
checked source digest and authority refs. It does not select the App, resolve
the final graph, or certify the integrated Simulator artifact.

`MUST`: `nimi-app update` operates on scaffold-managed glue only. It may update
dependency versions under an admitted version matrix, rewrite managed files or
regions, and apply admitted codemods. It must preserve app-owned product code.

`MUST`: init, doctor, and update must fail closed on drift, conflicts,
mixed-version state, stale auth/session claims, unsupported scaffold versions,
missing installed nimicoding projection, or stale package-owned projection
state.

`MUST NOT`: init output, doctor output, update output, local audit dry-run
output, endpoint reachability, file existence, or local build success must be
projected as public admission, ordinary-user installed-app update,
installed-app health, launch readiness, rollback truth, or kill-switch truth.
Runtime app lifecycle truth remains `K-APP-*`; public admission and review
truth remain `P-NAPP-*` and `P-AUDIT-*`.

## P-SCAF-010 — Nimicoding Projection Ownership

`MUST`: package-owned `.nimi/{config,contracts,methodology}/**` projections in
generated repositories remain owned by the external `@nimiplatform/nimi-coding`
package. Host repositories consume them through `pnpm exec nimicoding sync` and
admitted generated projections.

`MUST`: generated scaffolds must keep host-local truth under the generated
repository's `.nimi/**` boundaries and must preserve the package/host
projection distinction.

`MUST NOT`: scaffolding must not promote concrete installer evidence,
package-owned projections, local execution artifacts, or generated app lifecycle
reports into semantic truth unless an admitted `nimicoding` admission flow
produces that projection.

## P-SCAF-011 — External Harness Is Local Evidence Only

`MUST`: the black-box acceptance harness for this contract is local operational
evidence. It may run acceptance passes against fresh generated fixture targets
and record evidence that scaffold outputs obey this contract.

`MUST`: repo-wide spec language must use a portable acceptance-harness concept
only. Any workstation-local absolute path belongs in local evidence only.

`MUST NOT`: the harness must not become generated app output, a scaffold
template source, an admitted Nimi App, public distribution authority, or
repo-wide spec truth.

## P-SCAF-012 — Public Nimi App Admission And App-Slice Admission Are Separate

`MUST`: scaffolding must keep these surfaces separate:

- public Nimi App admission is owned by `P-NAPP-*`, `P-AUDIT-*`, and related
  upstream rules;
- app-slice admission is owned by `P-APP-001..006`;
- scaffolded developer repository shape is owned by `P-SCAF-*`.

`MUST`: standalone scaffolding never writes admitted truth. Explicit
`workspace-app` scaffolding may auto-write monorepo app-slice admission only
under existing `P-APP-001..006` authority, and only for the explicit
`workspace-app` profile.

`MUST NOT`: scaffolding must not create public Nimi App admission, registry
rows, release descriptors, mirrors, kill-switch posture, public review
decisions, ordinary-user install truth, ordinary-user visibility, or any
substitute for the `P-NAPP-013` PR admission path. App-slice admission does not
substitute for public Nimi App admission, and public Nimi App admission does
not substitute for app-slice audit authority (`P-NAPP-010`).

## P-SCAF-013 — A5 Model-Test Admission Dependency

`MUST`: ST-L1-1 default scaffold content must not import default
`kit/features/model-test` content until Kit admits that feature surface and
closes its implementation/evidence obligations.

`MUST`: before the Kit feature authority is admitted and its
implementation/evidence obligations are closed, scaffold examples may use only
already admitted SDK/kit/Runtime surfaces or app-owned placeholder product areas
that do not claim model-test feature availability.

`MUST NOT`: scaffolding must not fabricate a shipped `kit/features/model-test`
export, edit kit source/package files through scaffolding, or treat a planned
feature as available package surface.

## P-SCAF-014 - Generated App Skeleton Acceptance Track

`MUST`: app-tools generated app skeleton acceptance is a scaffolding acceptance
track. It proves that `standalone` and `workspace-app` outputs are coherent
developer repositories that can run create/init/doctor/test/build/pack with the
admitted SDK, Kit, Tauri shell, and local developer Runtime account paths.

`MUST`: this acceptance track is Horizon 1 skeleton readiness only. It may
claim that generated repository glue is usable, fail-closed, and bounded by
the admitted contracts it consumes.

`MUST NOT`: generated app skeleton acceptance must not claim public Nimi App
admission, registry truth, release descriptor truth, ordinary-visible product
readiness, Runtime live artifact install, live `OpenApp` launch-resolution, or
Desktop hosted launch proof. Those remain owned by `P-NAPP-*`, `K-APP-*`, and
Desktop/live E2E gates.

## P-SCAF-015 - Tester Reference And Second-Consumer Boundary

`MUST`: `apps/tester` is a real first-party second-consumer/reference proof for
SDK, Kit, Runtime account/session, Tauri shell, and Electron shell integration.
Scaffolding may inspect tester to learn which admitted surfaces a complete app
uses, and the explicit `tester-reference` profile may carry tester proof code.

Tester is also the reference consumer for the generic Simulator module
contract. Its canonical renderer factory, production bindings, App-owned
Simulator Adapter, Manifest, and conformance fixture must obey the same
`nimi-app doctor --conformance simulator --json` path as every selected App;
Tester cannot use a private checker or selection bypass.

`MUST`: generic `standalone` and `workspace-app` scaffold truth remains owned
by this `P-SCAF-*` contract plus the app-tools default starter and tests. The
default starter must contain generic product surfaces only.

`MUST NOT`: tester product code, tester-specific storage, tester workbench UI,
tester Electron acceptance host code, tester environment variables, or tester
app ids must not leak into default third-party templates. Tester passing does
not substitute for generated default starter acceptance.

## P-SCAF-016 - Local-app Launch And Session Custody For Scaffolds

`MUST`: scaffolded third-party paths consume the final Runtime/Desktop
`PrepareLocalAppLaunch` and request-empty `OpenLocalAppSession` chain. Opaque
principal, provenance, execution profile, launch lease, process proof, account/
permission-decision revisions, boot epoch, and session material remain inside Runtime and
the Kit native carrier; they are never SDK constructor or renderer inputs.

`MUST`: generated source may detect whether the final host bridge exists and
consume typed status, but app code must not read, construct, persist, or pass a
principal, trust class, bootstrap, lease, process, record, grant, or session as
app-supplied truth.

`MUST`: the generated starter composes the final SDK local-app client with the
Kit local-app host surface in one scaffold-managed module. Fixed production
AppHost and native development carriers share that client contract but retain
different execution profiles. Operations missing from the owner-admitted
applicability set return typed unavailable.

`MUST NOT`: generated code must not construct a developer/installed account
caller or expose the retired split auth modes. Runtime derives the single
`LOCAL_APP` caller from the protected native connection.

`MUST NOT`: scaffolding must not teach third-party apps to self-report launch
binding, descriptor truth, host identity, Runtime account caller posture, app
session metadata, protected-access tokens, or permission grants. Missing host
binding is a typed unavailable / fail-closed state, not local developer
success.

## P-SCAF-017 - Generated Artifact Evidence And Proof Horizon Separation

`MUST`: app-tools may generate deterministic developer-submitted artifact
evidence for a built app skeleton. Such evidence may include build input refs,
entry refs, typed sizes, hashes, and local audit output when all fields are
explicitly labeled as developer-submitted input.

Simulator conformance output is deterministic App-source qualification
evidence. It binds manifest protocol versions, source digest, resolved factory
and style entries, production/host inventories, dependency needs, effect scan,
fixture result, and app-tools version. It is invalid when copied to a different
source digest and cannot claim final resolver, cross-App interaction,
integrated CSS/DOM, performance, release, App publication, or trust truth.

`MUST`: generated scaffold proof, sandbox fixture proof, live Runtime sandbox
proof, and ordinary-visible product readiness are separate horizons:

- generated scaffold proof demonstrates app-tools skeleton readiness;
- sandbox fixture proof demonstrates existing Desktop fixture plumbing only;
- live Runtime sandbox proof demonstrates Runtime artifact download, digest
  verification, `OpenApp`, Desktop host launch, and host-owned auth for a
  sandbox app;
- ordinary-visible product readiness requires real admitted descriptor,
  signing/notarization, mirror/license, public source, support, and review
  evidence.

`MUST NOT`: `apps/nimi-app-platform-fixture` must not become canonical scaffold
template truth, and generated scaffold evidence must not be promoted into
ordinary-visible product readiness, signing truth, mirror truth, review truth,
or registry/release descriptor truth.

## P-SCAF-018 - One-Command Local Development

`MUST`: fresh standalone and workspace-app scaffolds expose `pnpm dev` and
`pnpm dev:shell -- --shell electron|tauri`; both delegate to the same official
`nimi-app dev` launcher. The launcher owns command parsing, scaffold/manifest
validation, build coordination, and developer-safe status output only. It
cannot issue an authorization, grant, ticket, session, protected endpoint,
credential, release trust, or production evidence.

`MUST`: the positive command requests Desktop's production Developer Mode,
fresh project presence, isolated local principal, and supervised launch through
the fixed Runtime service. Controlled rebuild/restart may rotate the host-
private lease/session without repeated consent while the durable authorization
tuple is exact. The CLI receives only stable status/failure projections.

`MUST`: generated project validation and `nimi-app doctor` reject direct
`tauri dev`, manually launched Electron host scripts, generic Runtime/localhost
proxies, token/session custody, and app-owned development authorization truth.
The scaffold does not ask developers to select a Runtime binary/service,
endpoint, path, argv/env, registry, ticket, or session. `dev:renderer` may exist
only as an explicit protected-operation-unavailable surface and is not an A.5
end-to-end path.

`MUST`: sync keeps the launcher reference in scaffold-managed glue, remains
byte-identical across repeated runs, and never overwrites app-owned product
files. Tester and external apps consume this same command and Kit/Runtime
surface; they cannot carry a private launcher or special registration bypass.
Ordinary `tauri dev`, manual Electron, and a direct app-tools-to-Runtime path
remain fail-closed.

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` --
  `P-NAPP-013`, `P-NAPP-014`, `P-NAPP-018`, `P-NAPP-023`
- `.nimi/spec/platform/kernel/nimi-app-developer-workflow-contract.md` --
  `P-DEV-001..P-DEV-005`
- `.nimi/spec/platform/kernel/nimi-app-audit-pipeline-contract.md` --
  `P-AUDIT-001..P-AUDIT-005`
- `.nimi/spec/platform/kernel/app-slice-admission-contract.md` --
  `P-APP-001..P-APP-006`
- `.nimi/spec/platform/kernel/app-permission-contract.md` -- `P-PERM-*`
- `.nimi/spec/platform/kernel/kit-contract.md` -- `P-KIT-041`, `P-KIT-042`
- `.nimi/spec/sdks/kernel/nimi-app-client-contract.md` -- `S-APP-*`
- `.nimi/spec/runtime/kernel/account-session-contract.md` -- `K-ACCSVC-*`
- `.nimi/spec/runtime/kernel/scoped-app-binding-contract.md` -- `K-BIND-*`
- `.nimi/spec/runtime/kernel/app-messaging-contract.md` -- `K-APP-*`

---

<!-- source: .nimi/spec/platform/kernel/nimi-ecosystem-contract.md -->

# Nimi Ecosystem Contract

> Owner Domain: `P-ECO-*`

## Scope

定义第三方生态、世界 / 游戏 app class、Engine SDK future seam、
revenue / economy posture 未准入边界以及 no-Steam-copy 负面闸门
列表的 Platform-level authority。本契约不实施第三方 admission、不实例化
具体 world / game app、不实现 engine SDK 代码；它仅锁定 admission /
review / 边界 / 负面闸门。

## P-ECO-001 — Ecosystem Authority Scope

`MUST`：本契约固定 Platform ecosystem authority covering third-party
developer onboarding, trust tier expansion, world / game app class,
engine SDK future seam, economy posture non-admission boundary, and
no-Steam-copy negative gates.

`MUST NOT`：本契约不替代 Nimi App admission、permission fabric、或已退役
extension-class authority；只在其之上添加 ecosystem expansion 规则。

## P-ECO-002 — Third-Party Developer Onboarding

`MUST`：第三方开发者通过 Nimi App registry 路径接入。每条 admission row
必须满足：

- `trust_tier_ref` ∈ {`nimi-verified-partner`, `nimi-community`}
- `review_posture_ref` 解析到 `P-ECO-004` typed review states
- `package_kind` 为 `nimi-app`
- 全部 `P-NAPP-*` 字段合法

`MUST NOT`：不得 admit 共享 Nimi Content Pack channel，或引入 alias 让第三方
绕过 Nimi App registry。

## P-ECO-003 — Trust Tier Expansion Boundary

`MUST`：ecosystem expansion 仅填充
`tables/nimi-app-trust-tiers.yaml` 中既有 trust-tier rows 的 policy
references；closed public tier enum（`nimi-first-party`、
`nimi-verified-partner`、`nimi-community`）保持不变。

`MUST NOT`：不得 admit 第四个公共 tier；若未来需要扩展，必须由显式
spec cut 处理。

## P-ECO-004 — Review Posture State Set

`MUST`：typed review state 集合：

- `submitted`
- `under-review`
- `revision-requested`
- `approved`
- `rejected`
- `kill-switched`

Tier 与 review posture 关系：

- `nimi-first-party`：内部 review（`review-internal`）。
- `nimi-verified-partner`：full manual review（`review-manual-full`）。
- `nimi-community`：automated review 加 manual kill-switch eligibility
  （`review-automated-with-manual-kill-switch`）。

`MUST NOT`：review 状态不得静默跳转；`kill-switched` 是终止态，不得
自动恢复。

## P-ECO-005 — World / Game App Class Posture

`MUST`：world / game apps 是 future Nimi App class，admission 路径仍为
Nimi App registry。Cross-world / cross-game 数据流必须：

- 通过 `P-PERM-*` / `R-PERM-*` grant lifecycle 获取授权
- 在 admitted projection contract 内执行
- 在 Realm audit 中保留 source app / target app / `AIScopeRef` 记录

`MUST NOT`：不得 admit raw cross-world data sharing channel；不得让 game /
world app 共享 first-party trust 而不经过 trust tier boundary。

## P-ECO-006 — Engine SDK Future Seam

`MUST`：engine SDK（例如 Unity / Unreal / 通用引擎）seam 是 Platform 层
placement 边界。Engine SDK 必须通过 SDK public surface 消费 Runtime /
Realm authority；语义实施由 Runtime kernel 保持（参见
`P-ARCH-022..P-ARCH-027`）。

`MUST NOT`：engine SDK 不得：

- import `runtime/internal/**`
- import Realm private client / private transport
- import Cognition private endpoint
- 替代 Runtime / Realm / Cognition canonical authority

## P-ECO-007 — Economy Posture Non-Admission Boundary

`MUST`：经济 / take-rate / billing 决策当前未准入为 Platform ecosystem
authority。任何经济策略准入必须通过独立 spec cut 明确 owner、范围、审计
与执行边界，且至少覆盖：

- cloud / runtime AI spend metering posture
- paid apps / subscriptions
- developer / creator economics
- platform take-rate posture

`MUST NOT`：不得在本契约内自行决定 take-rate；不得把经济决策视作
pricing tweak、文案字段、registry metadata，或 app-local product setting。

## P-ECO-008 — No-Steam-Copy Negative Gates

`MUST`：以下品类不得作为 Nimi 平台主要 product justification 或 strategic
posture：

- Workshop clone 作为第三方 package marketplace
- Trading cards / achievement grind / collectible badges / platform
  inventory 作为 retention 主线
- Family sharing clone
- Big Picture mode clone
- Screenshot / video social feed clone
- Friends / invite system 在 Realm social authority 之外的克隆

`MUST NOT`：产品文案、registry row、third-party admission review、
ecosystem marketing 都不得违反上述负面闸门。

## P-ECO-010 — Cross-Cutting Invariants

`MUST`：ecosystem expansion 必须遵守：

- `P-PERM-005` fail-closed denial state machine
- `P-AIPS-008` no-provider/no-model constant rule
- `P-NAPP-009` Apps non-owner rule
- `P-FPI-007` no standalone ordinary-user truth after hard cut
- `P-AGID-001..P-AGID-008` agent identity floor

`MUST NOT`：不得通过 ecosystem expansion 绕过任何已准入的 Platform /
Runtime / Realm / Cognition / SDK boundary invariants。

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-001..P-NAPP-011; P-NAPP-013..P-NAPP-015`
- `.nimi/spec/platform/kernel/app-permission-contract.md` — `P-PERM-001..P-PERM-010`
- `.nimi/spec/platform/kernel/agent-identity-floor-contract.md` — `P-AGID-001..P-AGID-008`
- `.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md` — `P-AIPS-001..P-AIPS-013`
- `.nimi/spec/platform/kernel/nimi-first-party-integration-contract.md` — `P-FPI-001..P-FPI-008`
- `.nimi/spec/platform/kernel/nimi-first-party-migration-contract.md` — `P-FPM-001..P-FPM-006`
- `.nimi/spec/platform/kernel/architecture-contract.md` — `P-ARCH-022..P-ARCH-027`
- `.nimi/spec/platform/kernel/tables/nimi-app-trust-tiers.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml`

---

<!-- source: .nimi/spec/platform/kernel/nimi-proposal-intake-contract.md -->

# Nimi Proposal Intake Contract

> Owner Domain: `P-PROP-*`

## Scope

This contract is the Platform-level authority for conversation-originated
proposal intake. It admits a non-executing proposal record that can be
created from a first-party product surface, reviewed by the correct owner,
and handed off to an existing admission or execution authority only after
that owner accepts the handoff.

This contract does not own and MUST NOT redefine:

- Nimi App admission, release descriptor, registry, trust tier, or PR
  admission authority. Those remain `P-NAPP-*`, `P-DEV-*`, and
  `P-AUDIT-*` authority;
- permission grant, scope taxonomy, spend, or consent authority. Those
  remain `P-PERM-*` authority;
- retired `P-MOEX-*` surfaces or any alias family that would revive them;
- Runtime delegated execution, tool execution, provider selection,
  workflow execution, package install, app install, or code loading;
- app-local storage, app-local proposal truth, prompt transcript truth, or
  source conversation ownership.

## P-PROP Family Seam (OWNS / DOES NOT OWN)

`P-PROP-*` OWNS:

- the conversation-originated proposal intake record identity and required
  field set (`P-PROP-001`, `P-PROP-002`);
- the closed proposal kind set and the meaning of each proposal kind
  (`P-PROP-003`);
- the proposal state machine for intake review (`P-PROP-004`);
- the handoff boundary from proposal intake to existing owner domains
  (`P-PROP-005`);
- the source conversation anchor reference boundary (`P-PROP-006`);
- the proposal transition audit obligation (`P-PROP-007`);
- the SDK and app consumer boundary for proposal intake (`P-PROP-008`).

`P-PROP-*` DOES NOT OWN:

- `P-NAPP-*` Nimi App admission, release descriptor, registry, trust tier,
  or ordinary-user visibility authority;
- `P-DEV-*` developer repository workflow or PR submit substrate authority;
- `P-AUDIT-*` publish-to-admission gate, evidence, review, or admit
  authority;
- `P-PERM-*` permission taxonomy, grants, spend, or consent authority;
- Runtime delegated execution or tool execution authority;
- Workflow execution authority before such authority is admitted elsewhere;
- any app-local proposal store, app-local app admission truth, or app-local
  request-review state machine.

`P-PROP-*` is an intake-only authority. It can record that a user asked for
new capability, route that request to an owner, and preserve the review
state of that intake record. It cannot make the requested capability real,
installed, executable, admitted, granted, or provider-bound.

## P-PROP-001 - Proposal Intake Authority And Non-Execution

`MUST`: A conversation-originated proposal MUST be represented as a
Platform-owned proposal intake record before any first-party app presents it
as a durable request, queued capability, review item, or future handoff.
The proposal record is the only admitted durable intake shape for this
surface.

`MUST`: Proposal intake is non-executing. Creating, updating, submitting, or
closing a proposal MUST NOT install an app, register a Runtime service,
grant a permission, load code, start a workflow, invoke a delegated tool,
select a provider, select a model, mutate user data outside the proposal
record, or make a release visible to ordinary users.

`MUST NOT`: A first-party app MUST NOT substitute an app-local draft table,
renderer state, prompt transcript, local file, or UI-only card for the
Platform-owned proposal intake record. Such state may render a pending
interaction only until the Platform/SDK proposal intake operation returns a
typed result; it is not durable proposal truth.

`MUST NOT`: A proposal record MUST NOT be used as proof that a capability,
workflow, Nimi App, delegated tool, permission scope, package, or release is
admitted. A proposal can only point to the next owner review step.

## P-PROP-002 - Proposal Record Shape

`MUST`: Every proposal intake record MUST carry the following required
fields:

| Field | Required meaning |
|---|---|
| `proposal_id` | Platform-minted stable proposal identity. Apps and SDKs must not mint durable IDs outside the Platform/SDK proposal operation. |
| `proposal_kind` | One of the closed values admitted by `P-PROP-003`. |
| `source_conversation_anchor_id` | Reference to the conversation anchor that produced the proposal request; reference-only per `P-PROP-006`. |
| `requester_subject_ref` | Account, agent, or participant subject reference for the requester. |
| `owner_domain` | The owner domain selected for review, such as Platform, Runtime, Workflow, SDK, Desktop, Avatar, Kit, Cognition, or a future admitted app owner. |
| `requested_capability_ref` | Stable reference to the requested capability, app request, workflow draft request, delegated tool request, or rejected request summary. |
| `risk_tier` | Closed review risk tier selected by Platform policy for intake triage. |
| `required_permission_refs` | Explicit list of permission scope references expected if the proposal later becomes executable or installable. Empty is meaningful and must be represented as an empty list. |
| `next_review_step` | Human- and machine-readable next owner action, not an execution command. |
| `state` | One of the closed states admitted by `P-PROP-004`. |
| `reason_code` | Typed reason for the current state, including blocked and rejected outcomes. |
| `audit_ref` | Audit-event or audit-pending reference admitted by `P-PROP-007`. |
| `created_at` | Platform timestamp for proposal creation. |

`MUST`: `proposal_id`, `proposal_kind`, `owner_domain`, `state`,
`reason_code`, `audit_ref`, and `created_at` are required on every record,
including `rejected_request`. A rejected request may use a bounded
`requested_capability_ref` that points to a redacted request summary rather
than a future capability identity.

`MUST NOT`: The record shape MUST NOT carry executable code, prompt bodies,
provider names, model names, install commands, hidden permission grants,
unreviewed package locators, local filesystem paths, or app-local admission
flags.

## P-PROP-003 - Closed Proposal Kind Set

`MUST`: `proposal_kind` MUST be one of:

| Proposal kind | Meaning |
|---|---|
| `capability_proposal` | Request for an owner to evaluate a new capability or capability-surface identity. |
| `workflow_draft_request` | Request to draft a future workflow under an admitted workflow authority. Until that authority exists, the proposal must remain non-executing and may only move to `blocked` or owner review states. |
| `nimi_app_request` | Request to evaluate a future Nimi App candidate or app request. It is not a PR, registry row, descriptor, install source, or admission decision. |
| `delegated_tool_request` | Request to evaluate whether a delegated tool action should be routed to the Runtime/delegation owner. It does not invoke or authorize the tool. |
| `rejected_request` | Request that is refused at intake because it is out of scope, unsafe, owned by no admitted authority, duplicates an existing rejected request, or attempts a forbidden shortcut. |

`MUST`: `proposal_kind` is closed. Adding a kind requires changing this
Platform contract and its downstream SDK/app projections.

`MUST NOT`: Proposal intake MUST NOT admit a kind that revives any retired
`P-MOEX-*` surface by direct name or alias, including content-pack,
plugin, worker, vm, hook-based capability, shared package channel, or
installable extension semantics. A request using those aliases MUST become
`rejected_request` or `blocked` with a typed `reason_code`.

## P-PROP-004 - Proposal State Machine

`MUST`: `state` MUST be one of:

| State | Meaning |
|---|---|
| `draft` | Platform has accepted an intake draft but it is not submitted for owner review. |
| `submitted` | The proposal is submitted to the selected owner domain for triage. |
| `under-review` | The selected owner domain is reviewing the proposal. |
| `revision-requested` | The selected owner requires more information or a revised request. |
| `rejected` | The proposal is terminally refused. |
| `accepted-for-admission` | The selected owner accepted the proposal for a separate admitted admission, implementation, or execution path. This is not itself admission or execution. |
| `blocked` | The proposal cannot advance because required owner authority, schema, permission, audit, or implementation authority is absent. |

`MUST`: Every state transition MUST set a typed `reason_code` and update
`audit_ref` according to `P-PROP-007`.

`MUST NOT`: `accepted-for-admission` MUST NOT be treated as `approved`,
`admitted`, `installed`, `enabled`, `granted`, `running`, or `visible to
ordinary users`. It only permits the next owner-owned process to begin
under that owner's admitted authority.

`MUST NOT`: Proposal intake MUST NOT reuse the `P-ECO-004` review-state set
or `P-NAPP-025` review-decision schema as Nimi App admission truth. Proposal
states are intake-review states only.

## P-PROP-005 - Owner Handoff Boundary

`MUST`: A proposal handoff MUST name an owner domain and a next review step.
The proposal record may carry references needed by the owner, but the owner
must perform its own admitted validation before any admission, execution,
install, permission grant, or workflow run occurs.

`MUST`: A `nimi_app_request` can only hand off to `P-DEV-*`, `P-NAPP-*`,
and `P-AUDIT-*` surfaces through their existing PR and admission path. The
proposal record does not satisfy `P-DEV-002` `submit`, does not create a
registry row, and does not create a release descriptor.

`MUST`: A `delegated_tool_request` can only hand off to Runtime/delegation
authority after the Runtime owner accepts the request. The proposal record
does not grant delegation, does not invoke the tool, and does not satisfy
permission or consent requirements.

`MUST`: A `workflow_draft_request` MUST remain non-executing while no
workflow execution authority exists. In that posture, owner review may
record `blocked` with a typed reason and a concrete missing-authority
reference; it may not create a hidden workflow runner.

`MUST NOT`: A handoff MUST NOT cross directly from proposal intake to
install, execution, provider/model selection, permission grant, or release
promotion. Every handoff is owner-review input only.

## P-PROP-006 - Source Conversation Anchor Boundary

`MUST`: `source_conversation_anchor_id` is a reference to the conversation
continuity surface that produced the request. It preserves provenance and
review traceability without transferring transcript ownership into the
proposal record.

`MUST`: Any natural-language request summary carried by
`requested_capability_ref` or an attached review artifact MUST be bounded,
redacted when needed, and treated as review input only. Transcript bodies,
private memory records, and app-local chat state remain under their
existing owners.

`MUST NOT`: A proposal intake record MUST NOT store raw prompt transcripts,
private memory blobs, provider traces, local account secrets, or app-owned
conversation state as Platform proposal truth.

## P-PROP-007 - Proposal Transition Audit Obligation

`MUST`: Every proposal creation and state transition MUST produce a typed
audit reference in `audit_ref`. The audit record or audit-pending record
MUST include `proposal_id`, `from_state` when applicable, `to_state`,
`transition_cause`, `decided_at`, and `adjudicator_ref` or
`system_adjudicator_ref`.

`MUST`: When audit infrastructure for a consumer is unavailable, the
proposal operation MUST fail closed or return a typed `blocked` result with
`reason_code=proposal_audit_unavailable`. It MUST NOT fabricate a pass
audit reference.

`MUST NOT`: First-party apps MUST NOT mint synthetic audit references for
proposal state transitions. Apps may display the Platform/SDK returned
`audit_ref` only.

## P-PROP-008 - SDK And App Consumer Boundary

`MUST`: SDK projections of proposal intake MUST expose typed proposal
creation/read/update results that preserve the closed `proposal_kind`,
`state`, required field set, and non-execution semantics admitted in this
contract.

`MUST`: Apps consuming proposal intake MUST render proposal state from the
SDK/Platform result and fail closed when that result is absent, rejected, or
blocked. App consumers may compose UX around the proposal, but they must not
create a parallel state machine or durable app-local proposal truth.

`MUST NOT`: Apps MUST NOT bypass SDK/Platform proposal intake with app-level
REST calls, local files, renderer-only persistence, or direct Runtime
private imports. Consumer implementation must preserve the existing
boundary rules for Desktop/Web, SDK, and Runtime.

`MUST NOT`: SDK or app projections MUST NOT hardcode provider names, model
names, owner-specific execution paths, or alias surfaces forbidden by
`P-PROP-003`.

---

<!-- source: .nimi/spec/platform/kernel/mod-extension-retirement-contract.md -->

# Mod / Extension Retirement Contract

> Owner Domain: `P-MOEX-*`

## Scope

固化 Public Mod / Public Extension 的 non-admission 决议，记录现有
`nimi-hook`、Desktop mod governance、mod workspace、SDK mod contract surface
的 developer / internal / retirement 边界，并锁定 `Shared Nimi Content
Pack` 的 non-admission 边界。

本契约固化 Public Mod / Public Extension non-admission 与 retired surface
边界。

## P-MOEX-001 — Public Mod / Public Extension Non-Admission

`MUST`：Public Mod 与 Public Extension 不是 Nimi 新一轮产品的 admitted
external installable / distributable / user-authorized product category。

`MUST NOT`：registry / SDK / Apps / install
gateway / release channel 不得通过任何 alias 重新引入 Public Mod 或
Public Extension。

## P-MOEX-002 — Retired (Existing Mod / Hook Surfaces)

`RETIRED`：既有 Mod / Hook / runtime-mod / SDK mod surface 已完成 physical
retirement execution。`.nimi/spec/desktop/kernel/mod-governance-contract.md`、
`.nimi/spec/desktop/kernel/hook-capability-contract.md`、
`.nimi/spec/desktop/kernel/tables/mod-*`、
`.nimi/spec/desktop/kernel/tables/hook-*`、
`.nimi/spec/desktop/kernel/tables/turn-hook-points.yaml`、
`.nimi/spec/sdks/kernel/mod-contract.md` 等存量 active authority 文件已撤回；
对应 SDK exports、runtime CLI、Desktop / Web consumer surfaces、scripts / CI
guards 与 docs active references 已移除。

`MUST NOT`：上述 retired surfaces 不得作为普通用户产品入口、Nimi App、
外部生态接入点、第三方 SDK / API 公开承诺、或 future reserved namespace
重新出现。任何复活 Mod / Hook / runtime-mod / SDK mod surface 的提案必须
重新通过显式 admission，并不得复用 retired 文件、路径或命名作为兼容层。

`MUST`：retirement audit 必须确认 parent workspace active
`nimi-mods` references 已清理或经 admitted allowlist 处置；历史归档与本地
审计证据只可作为追溯材料，不得成为 active authority。

## P-MOEX-002.a — Physical Retirement Anti-Targets

`MUST NOT`：以下命名模式禁止在本仓库重新引入为 registry / SDK export /
runtime CLI / desktop UI route / Tauri command / npm package name / URL path /
locale namespace / script name / docs link / descriptor identity：

- `mod-*` / `Mod*` / `nimi-mod*` / `@nimiplatform/mod-*`
- `mod-hub` / `mod-workspace` / `mod-codegen` / `mods-panel` / `runtime-mod`
- `inter-mod` / `mod-governance` / `mod-extension`
- `hook-capability` / `hook-allowlist` / `turn-hook-points`
- `modId` / `desktop-mod` / `CreatorMods*` / `/mods/` /
  `/desktop/mod-system`

The guard must cover identity shape, not only filenames. A field, type,
descriptor, route, generated SDK service, docs URL, locale namespace, script,
or test fixture that preserves Mod/Hook identity is an active anti-target even
when the surrounding feature has been renamed.

`MUST`：mechanical guard `check:p-moex-anti-targets` 必须在 physical
retirement true-close 前覆盖上述模式，并在 true-close 后持续阻断这些模式
作为 active product / API / command / package surface 回流。

## P-MOEX-003 — No Shared Nimi Content Pack Channel

`MUST`：Nimi 不创建共享的 `Nimi Content Pack` 产品 / channel。

`MUST NOT`：Registry / Apps / SDK 不得引入跨 app 的通用内容包
admission；任何"通用内容渠道"提案视为 reopen condition。

## P-MOEX-004 — App-Internal Content Package Boundary

`MUST`：App-internal content packages（Avatar Live2D / VRM / voice / persona
assets，或其他 app 的 prompt / knowledge / workflow bundle 等）由各自 app
或显式 admit 的 domain-specific upstream authority 拥有。

`MUST NOT`：上述 content package 不得被错误归类为 Nimi App、Mod、Extension、
或共享 content channel。

## P-MOEX-005 — Retired (Asset Market Disposition)

`RETIRED`：Asset Market 已完全退出 Nimi 一方应用 admission（连同 backend
实现、avatar-package projection 链路与 spec 树一起撤回）。本条规则保留
为退役占位，不再承载 active normative 行为。任何复活 Asset Market 的提案
必须重新通过显式 admission row 并重新写入新规则。

## P-MOEX-006 — Mechanical Guard Registration

`MUST`：mechanical guard `check:no-public-mod-extension-admission` 在
`enforcement-gates-required.md` 中注册，并 block：registry / package rows
admitting public Mods or Extensions，
以及任何 alias 重新引入共享内容包 channel。

`MUST`：mechanical guard `check:p-moex-anti-targets` 是独立的 full-surface
retirement guard。它不得只是 `check:no-public-mod-extension-admission` 的别名；
它必须覆盖 `P-MOEX-002.a` 的 filename / symbol / field / URL / docs / i18n /
script / generated SDK anti-targets。

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` — `P-NAPP-001..P-NAPP-011; P-NAPP-013..P-NAPP-015; P-NAPP-018..P-NAPP-029`
- `.nimi/spec/platform/kernel/nimi-app-local-admission-contract.md` — `P-NAPP-030..P-NAPP-032`
- `.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml`

---
