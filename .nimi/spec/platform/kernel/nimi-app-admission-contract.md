# Nimi App Admission Contract

> Owner Domain: `P-NAPP-*`

## Scope

定义 `Nimi App` 作为公开可安装 product unit 的 admission authority。本契约拥有
admission row schema、admitted package kind set、trust tier reference、factory
AIProfile selection reference、capability_set / local compute pack / runtime
registration mode / permission scope reference、与 app health/repair projection
的 fail-closed semantics。

## P-NAPP-001 — Admission Authority And Package Kind

`MUST`：Platform 拥有 Nimi App admission、`tables/nimi-app-registry.yaml` 与
admitted package kind set。当前仅 admit `nimi-app` package kind。

`MUST NOT`：不得 admit shared Nimi Content Pack 作为可安装 product unit。

## P-NAPP-002 — Registry Row Schema

`MUST`：每个 registry row 必须包含以下字段：

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
- `permission_scope_ref` — permission fabric 尚未 admit 具体 scope set 时的
  fail-closed 引用；admitted value 为 `permission_fabric_pending`。
- `health_repair_projection` — fail-closed 状态集合（见 `P-NAPP-008`）。
- `ordinary_visibility` — `ordinary-visible`、`hidden-internal`、
  `developer-only`、`not-admitted-visible` 之一。Apps 只能显示
  `ordinary-visible` 且 `admission_status=admitted` 的 row。
- `release_descriptor_ref` — 引用
  `tables/nimi-app-release-descriptors.yaml` 中的 installable release
  descriptor；bundled first-party app 可引用 atomic Nimi bundle descriptor。
- `install_storage_policy_ref` — 引用 `P-NAPP-015` 的 storage policy。
- `admission_status` — admitted 值集合：`admitted`,
  `gated_by_avatar_master_gate`, `permission_fabric_pending`, `deferred`,
  `retired`。
- `source_rule` — `P-NAPP-NNN` 引用。

## P-NAPP-003 — AIProfile Selection Hint Resolution

`MUST`：`ai_profile_selection_ref` 必须指向
`tables/ai-profile-factory-catalog.yaml` 中已 admit 的 factory AIProfile
alias / profileId（`P-AIPS-009`）。

`MUST NOT`：不得在 registry row 中内嵌 provider id / connector id /
engine id / model id 字符串常量。任何 vendor 倾向必须 alias-driven。

## P-NAPP-004 — Trust Tier Reference

`MUST`：`trust_tier_ref` 必须是 canonical trust-tier floor 的 enum value：
`nimi-first-party`, `nimi-verified-partner`, 或 `nimi-community`
（`trust-tier-enum-floor.md`）。

`MUST NOT`：不得静默新增第四类 public trust tier；新增必须由显式
authority admission 扩展。

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

`MUST`：app runtime registration / enforcement / sandbox / process supervision
由 Runtime 拥有。Registry row 仅记录 `runtime_registration_mode` 的引用，不
拥有 runtime registration truth。

`MUST NOT`：Registry / Platform 不得通过 admission row 强行替换 Runtime app
registration semantics。

## P-NAPP-007 — Package Trust / Signature / Update Channel

`MUST`：package trust posture、signature policy、与 update channel identity
由 Platform 拥有，并引用已 admit 的
`P-PKGREL-002..P-PKGREL-008` 与 `release-gate-registry.yaml`。

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

`MUST`：Desktop `Apps` surface（`D-HOME-004` / `D-HOME-005`）仅消费
registry/package/SDK projection。Ordinary Apps visibility 的闭合条件为：

- `admission_status=admitted`
- `ordinary_visibility=ordinary-visible`
- registry row resolves trust tier、package kind、release descriptor、
  permission/runtime requirements、and storage policy
- host/runtime projection does not fail-close the row as unsupported or blocked

`MUST NOT`：Apps 不得拥有 admission truth、marketplace truth、economy
truth、package trust truth；不得读取 source workspace、app-local spec、or
unadmitted registry rows to decide visibility.

## P-NAPP-010 — App-Slice Admission Orthogonality

`MUST`：现有 `app-slice-admission-contract.md`（`P-APP-*`）的 audit /
subordinate authority semantics 与本契约 admission 并行存在；两者互不替代。
一个 first-party app 可同时持有 app-slice admission row（audit authority）
与 Nimi App registry row（公开产品 admission）。

`MUST NOT`：Nimi App registry 不得替代 `P-APP-*` 的 audit authority；
`P-APP-*` 也不得替代本契约的 public product admission。

## P-NAPP-011 — First-Party Seed

`MUST`：first-party seed row 仅包含 Avatar hardcut target：

- `nimi.avatar` — `admission_status: admitted` after Avatar productization
  master-gate clearance. Even with admitted package/update coordination, ordinary
  Apps visibility remains `hidden-internal` unless a later product authority
  explicitly changes Avatar Apps posture.

其余 `first-party-hardcut-scope-ledger.md` 中的 deferred app scopes
暂不进入 active seed registry，除非后续 owner admission 显式恢复。

## P-NAPP-012 — App Identity Surface Mapping

`MUST`：Platform owns the canonical Nimi app identity surface. The canonical
identity is `app_id`; it is the only app identity used for Platform admission,
Runtime registration eligibility, permission scope ownership, app storage roots,
audit filtering, and SDK `appId` parameters. Current app identity facts are
recorded in `tables/nimi-app-identity-surfaces.yaml`.

`MUST`：`app_id` is lowercase and dot-separated. A segment must start and end
with an ASCII lowercase letter or digit and may contain internal lowercase
letters, digits, or hyphens. Underscore is not admitted because OS bundle
identifier derivation would otherwise be lossy.

`MUST`：Runtime-facing app caller identity must use the same canonical `app_id`
as SDK-facing `appId`. Runtime may derive `app_instance_id` and device identity
for a caller mode, but those derived fields do not create a second app id and
must not be used as Platform admission truth.

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
as an active app identity surface. Developer/testing posture belongs in
admission status, visibility, developer registration, build profile, or local
Runtime configuration; it must not be encoded into canonical `app_id`.

## P-NAPP-013 — Third-Party Admission Path

`MUST`：early third-party app admission may begin as a GitHub PR into the
Platform-owned Nimi App registry/package tables. The PR must admit, in the same
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
or app-local spec presence is not Nimi App admission. Direct `npm install`,
direct `npx`, mutable git branch/tag, direct clone/build/run, or installer
script execution is not ordinary-user product install truth.

## P-NAPP-014 — Release Descriptor And Digest Verification

`MUST`：every installable non-bundled app version must resolve to an immutable
release descriptor in `tables/nimi-app-release-descriptors.yaml`. The descriptor
must include exact `app_id`, `version`, source kind/ref, artifact locator,
`sha256`, size, signature/provenance reference, runtime package kind/entry,
permissions, and storage policy.

Install must:

- download only from the descriptor source;
- compute `sha256` over downloaded bytes before unpack/register/execute;
- compare computed digest with descriptor `sha256`;
- fail closed before unpacking when the digest does not match;
- continue manifest, permission, Runtime, and storage validation only after
  digest match.

`MUST NOT`：hash match is not a safety proof by itself. Review must still
evaluate permissions, entry point, lifecycle scripts, dependency behavior,
Runtime sandbox fit, and file/storage boundaries.

## P-NAPP-015 — App Install Storage Policy

`MUST`：app package/data storage is rooted under selected `nimi_data`:

```text
<nimi_data>/apps/<app-id>/releases/<version>
<nimi_data>/apps/<app-id>/data
<nimi_data>/apps/<app-id>/cache
<nimi_data>/apps/<app-id>/tmp
```

Uninstall removes release payloads by default and keeps durable app data unless
the user explicitly confirms destructive data deletion with impact preview.

`MUST NOT`：ordinary app install may not write outside these roots except
through an admitted Runtime-managed dependency/materialization path. App
uninstall must not delete shared models, Runtime dependencies, account data, or
other app data by implication.

## P-NAPP-017 — Retired Realm Agent Studio Admission

P-NAPP-017 was retired on 2026-05-25. It admits no active Nimi App, grants no
permission scope, and must not be used as an active admission authority. The
`nimi.realm-agent-studio` app_id, the
`nimi.realm-agent-studio.bundled-with-nimi` release descriptor, the
`app.nimi.realm-agent-studio` Runtime caller identity, and the
`apps/realm-agent-studio` source tree are withdrawn; any future Realm Agent
Studio admission requires a new P-NAPP-* rule.

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
- `artifact.size` — typed sub-object (`P-NAPP-019`).
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
- `permissions_ref` — admitted permission scope set.
- `storage_policy_ref` — storage policy identifier (`P-NAPP-015`;
  `P-NAPP-019+` admits typed posture enum).
- `update_channel_ref` — admitted release channel identity.
- `rollback_eligibility` — typed eligibility marker (separate from the
  rollback candidate version in `P-NAPP-019`).
- `review` — sub-object with decision schema (`P-NAPP-025`).
- `support` — sub-object with required manifest fields (`P-NAPP-026`).

`MUST NOT`：a third-party admission MUST NOT collapse the descriptor shape
into a developer manifest or any other parallel-truth artifact. The
admitted descriptor is the platform-owned canonical truth produced by
review (`P-NAPP-013`, `P-NAPP-014`); the developer-authored manifest is
not admission truth.

## P-NAPP-019 — No-Collapsed Sizes, Dates, And Versions

`MUST`：`artifact.size` on every third-party admitted release descriptor
MUST be a typed sub-object with five distinct integer fields:

- `download` — wire-bytes downloaded from the artifact locator;
- `installed` — bytes on disk under
  `<nimi_data>/apps/<app_id>/releases/<version>/`;
- `user_data` — bytes under `<nimi_data>/apps/<app_id>/data/`;
- `cache` — bytes under `<nimi_data>/apps/<app_id>/cache/`;
- `shared_deps` — bytes attributable to admitted shared runtime
  dependencies.

Collapsing any subset of these into a single integer fails admission
closed with typed reason `artifact_size_collapsed`.

`MUST`：dates MUST be kept distinct across the admission lifecycle. The
admitted descriptor + registry projection carry the following typed dates
as separate fields:

- `release.publisher_release_date` — publisher's release timestamp on the
  source artifact;
- `review.decided_at` — review terminal-decision timestamp (`P-NAPP-025`);
- `registry.admission_date` — registry row admission timestamp;
- `install-evidence.local_install_date` — host-local install timestamp;
- `install-evidence.local_update_date` — host-local update timestamp;
- `launch-evidence.last_used_at` — host-local last launch timestamp.

Aliasing any two of these into a single field fails admission closed with
typed reason `descriptor_date_collapsed`.

`MUST`：versions MUST be kept distinct:

- `install-evidence.installed_version` — host-local currently-installed
  version;
- `registry.latest_approved_version` — registry's latest admitted version
  for the app;
- `install-evidence.rollback_candidate_version` — admitted prior
  descriptor eligible for rollback (`P-NAPP-018` `rollback_eligibility`).

Collapsing any two of these into a single `version` field fails admission
closed with typed reason `descriptor_version_collapsed`.

`MUST NOT`：a third-party admission MUST NOT carry a single "size", a
single "date", or a single "version" field that conflates the typed
fields above. The five sizes, six dates, and three versions are not
interchangeable projections of one another.

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

`MUST NOT`：a third-party admission MUST NOT carry `macos_notarization:
not-applicable` or `windows_code_signing: not-applicable`. The
`not-applicable` value is forbidden for third-party admitted artifacts;
declaring it fails admission closed with typed reason
`platform_signing_required`.

`MUST NOT`：a third-party admission MUST NOT carry `macos_notarization:
not-required-internal` or `windows_code_signing: not-required-internal`.
The `not-required-internal` value is valid ONLY when
`trust_tier_ref: nimi-first-party`; declaring it on any other tier fails
admission closed with typed reason `platform_signing_required`.

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
- `review.decided_at` — terminal-decision timestamp (distinct from the
  other lifecycle dates per `P-NAPP-019`).

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

- `nimi-mediated-default` — app uses Nimi-mediated file APIs and the
  Nimi-owned data root tree;
- `app-owned-os-storage` — app writes through OS-level file IO to
  paths it chooses; disclosure carried per `P-NAPP-028`.

Missing or unrecognized `storage_policy_ref.kind` fails admission
closed with typed reason `storage_policy_kind_unresolved`.

`MUST`：when `storage_policy_ref.kind` is `nimi-mediated-default`, the
descriptor's resolved storage template MUST be exactly:

```text
<nimi_data>/apps/<app_id>/releases/<version>
<nimi_data>/apps/<app_id>/data
<nimi_data>/apps/<app_id>/cache
<nimi_data>/apps/<app_id>/tmp
```

Runtime materializes this tree at install per `K-APP-011` and the
storage roots are admitted by `P-NAPP-015`; this rule binds the
descriptor's `storage_policy_ref.kind` to those existing admitted
behaviors without duplicating them. Template-resolution failure
(unresolved `<nimi_data>` selection, unresolved `<app_id>`, or any
sub-path missing from the resolved template) fails admission closed
with typed reason `nimi_mediated_storage_unresolved`.

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

`MUST NOT`：Runtime uninstall (`K-APP-014`), Update (`K-APP-015`), or
HealthRepair (`K-APP-016`) MUST NOT unilaterally touch paths listed
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
  - `permission_scope_ref` (`P-PERM-007`),
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
required; collapsing two (e.g. treating `permission_scope_ref`
resolution as implied by `release_descriptor_ref` resolution) fails
the row out of `ordinary-visible` projection by violating the
admitted conjunction.

## P-NAPP-031 — Unified Apps Inventory Source Model

`MUST`：the Desktop/SDK Apps surface projects a unified inventory composed from
three admitted source families:

- `catalog` — Platform registry rows that satisfy the `P-NAPP-009` /
  `P-NAPP-030` ordinary listing predicate;
- `account` — Runtime authenticated account app inventory rows
  (`K-APP-024`) whose account state is verified or entitled, including rows
  whose local install state is `not-installed`;
- `local` — Runtime local adoption rows (`K-APP-025`) written only after an
  explicit local adoption validation succeeds.

`MUST`：source identity is part of the projection. A single `app_id` may carry
more than one source, but source truth must remain independently inspectable.
Catalog admission, account verification, and local adoption are not
interchangeable.

`MUST NOT`：`P-NAPP-031` MUST NOT redefine the `P-NAPP-009` ordinary listing
predicate. It admits an inventory composition above that predicate; it does not
allow hidden-internal, app-local spec, source-discovered, or workspace apps to
enter catalog truth.

## P-NAPP-032 — Explicit Local Adoption Boundary

`MUST`：a locally installed external app can enter Nimi only through explicit
Runtime local adoption. The user-selected root must contain a validated
`nimi.app.yaml` or `nimi.app.json` with app id, display name, version, runtime
entry ref, permission scope ref, and storage policy ref. Runtime owns the
adoption record and may expose it as an inventory source.

`MUST`：local adoption establishes a local trust posture, not public Platform
admission. It does not grant ordinary visibility, mirror rights, publisher
identity assurance, review decision, or release descriptor admission.

`MUST NOT`：Nimi MUST NOT infer local adoption from npm/npx installs, cloned
repositories, PATH entries, process liveness, filesystem presence, or app-local
spec slices. Local adoption MUST NOT bypass permission, account/session,
AIConfig, storage, or Runtime OpenApp gates.

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
- `.nimi/spec/sdks/kernel/nimi-app-client-contract.md` — `S-APP-001..S-APP-021`
- `.nimi/spec/runtime/kernel/local-engine-contract.md` — `K-LENG-024..K-LENG-028`
- `.nimi/spec/desktop/kernel/nimi-home-shell-contract.md` — `D-HOME-001..D-HOME-012`
