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
  `.nimi/spec/runtime/kernel/tables/local-compute-packs.yaml` 中已 admit 的
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
- `.nimi/spec/desktop/kernel/ui-shell-contract.md` — `D-SHELL-038`
- `.nimi/spec/desktop/kernel/tables/local-app-launch-hosts.yaml`
- `.nimi/spec/sdks/kernel/nimi-app-client-contract.md` — `S-APP-001..S-APP-022`
- `.nimi/spec/runtime/kernel/account-session-contract.md` — `K-ACCSVC-*`
- `.nimi/spec/runtime/kernel/app-messaging-contract.md` — `K-APP-*`
- `.nimi/spec/runtime/kernel/local-engine-runtime-environment-contract.md` — `K-LENG-024..K-LENG-027`
- `.nimi/spec/runtime/kernel/tables/protected-local-launch-session-profiles.yaml`
- `.nimi/spec/runtime/kernel/local-environment-materializers-contract.md` — `K-LENG-028`
- `.nimi/spec/desktop/kernel/nimi-home-shell-contract.md` — `D-HOME-001..D-HOME-012`
