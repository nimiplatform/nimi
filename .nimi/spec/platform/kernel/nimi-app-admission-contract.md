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
admitted package kind set。Wave 3 仅 admit `nimi-app` package kind。

`MUST NOT`：不得 admit Public Mod、Public Extension、shared Nimi Content
Pack、Asset Market generic content channel 作为可安装 product unit。

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
- `local_compute_pack_refs` — 引用
  `.nimi/spec/runtime/kernel/tables/local-compute-packs.yaml` 中已 admit 的
  pack；可为空。
- `runtime_registration_mode` — 当前 admitted 值集合：`app-managed`。
- `permission_scope_ref` — Wave 4 permission fabric 的占位引用；在 Wave 4 close
  前，admitted placeholder 为 `pending_wave_4`。
- `health_repair_projection` — fail-closed 状态集合（见 `P-NAPP-008`）。
- `ordinary_visibility` — `ordinary-visible`、`hidden-internal`、
  `developer-only`、`not-admitted-visible` 之一。Apps 只能显示
  `ordinary-visible` 且 `admission_status=admitted` 的 row。
- `release_descriptor_ref` — 引用
  `tables/nimi-app-release-descriptors.yaml` 中的 installable release
  descriptor；bundled first-party app 可引用 atomic Nimi bundle descriptor。
- `install_storage_policy_ref` — 引用 `P-NAPP-015` 的 storage policy。
- `admission_status` — admitted 值集合：`admitted`,
  `gated_by_avatar_master_gate`, `pending_wave_4`, `deferred`,
  `retired`。
- `source_rule` — `P-NAPP-NNN` 引用。

## P-NAPP-003 — AIProfile Selection Hint Resolution

`MUST`：`ai_profile_selection_ref` 必须指向
`tables/ai-profile-factory-catalog.yaml` 中已 admit 的 factory AIProfile
alias / profileId（`P-AIPS-009`）。

`MUST NOT`：不得在 registry row 中内嵌 provider id / connector id /
engine id / model id 字符串常量。任何 vendor 倾向必须 alias-driven。

## P-NAPP-004 — Trust Tier Reference

`MUST`：`trust_tier_ref` 必须是 Wave 0 floor 的 enum value：
`nimi-first-party`, `nimi-verified-partner`, 或 `nimi-community`
（`trust-tier-enum-floor.md`）。

`MUST NOT`：Wave 3 不得新增第四类 public trust tier；新增必须由 Wave 6 显式
cut。

## P-NAPP-005 — Capability And Compute Pack Resolution

`MUST`：`capability_set_refs` 与 `local_compute_pack_refs` 必须解析到既有
admitted Platform / Runtime row。Admission commit 时任何 unresolved ref 都视为
admission failure。

## P-NAPP-006 — Runtime Registration Ownership

`MUST`：app runtime registration / enforcement / sandbox / process supervision
由 Runtime 拥有。Registry row 仅记录 `runtime_registration_mode` 的引用，不
拥有 runtime registration truth。

`MUST NOT`：Registry / Platform 不得通过 admission row 强行替换 Runtime app
registration semantics。

## P-NAPP-007 — Package Trust / Signature / Update Channel

`MUST`：package trust posture、signature policy、与 update channel identity
由 Platform 拥有，并引用 Wave 1 已 admit 的
`P-PKGREL-002..P-PKGREL-008` 与 `release-gate-registry.yaml`。

`MUST NOT`：Nimi App update 不得 mutate Runtime-owned selected source
record（`P-SUPD-005` / `P-PKGREL-007`）。Wave 3 也不得借 update path 引入
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
truth、package trust truth；不得读取 source workspace、app-local spec、Mods、
Extensions、or unadmitted registry rows to decide visibility.

## P-NAPP-010 — App-Slice Admission Orthogonality

`MUST`：现有 `app-slice-admission-contract.md`（`P-APP-*`）的 audit /
subordinate authority semantics 与本契约 admission 并行存在；两者互不替代。
一个 first-party app 可同时持有 app-slice admission row（audit authority）
与 Nimi App registry row（公开产品 admission）。

`MUST NOT`：Nimi App registry 不得替代 `P-APP-*` 的 audit authority；
`P-APP-*` 也不得替代本契约的 public product admission。

## P-NAPP-011 — First-Party Seed

`MUST`：Wave 3 seed row 仅包含 Wave 5 hardcut targets：

- `nimi.avatar` — `admission_status: gated_by_avatar_master_gate`。Wave 5
  必须先由 Avatar 产品化 master gate 清场，才能切换为 `admitted`。即使
  future status becomes `admitted` for package/update coordination, ordinary
  Apps visibility remains `hidden-internal` unless a later product authority
  explicitly changes Avatar Apps posture.
- `nimi.parentos` — `admission_status: admitted`。

其余 `first-party-hardcut-scope-ledger.md` 中的 deferred app（Forge,
Asset Market, Moment, Polyinfo, Shiji, Realm Drift, Lookdev, Video Food
Map, Overtone）暂不进入 Wave 3 seed。

## P-NAPP-012 — Mechanical Guard Registration

`MUST`：mechanical guard `check:no-public-mod-extension-admission` 在
`enforcement-gates-required.md` 中以 `Required before: Wave 3 close` 注册，
并 block：registry/package rows admitting public Mods or Extensions。

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

## P-NAPP-016 — Developer-Only Tester App Admission

`MUST`：当前 Product/UI alignment cut admits `nimi.tester` only as a
first-party developer-only Nimi App:

- `admission_status: admitted`
- `ordinary_visibility: developer-only`
- `package_kind: nimi-app`
- `release_descriptor_ref: nimi.tester.bundled-with-nimi`
- `install_storage_policy_ref: nimi-data-app-roots`

`MUST`：`nimi.tester` 的 release descriptor 使用 bundled first-party
posture，绑定当前 atomic Nimi release bundle，不授权外部 mutable download。

`MUST NOT`：`nimi.tester` 不得作为 ordinary primary navigation entry，
不得出现在 ordinary-visible Apps projection，且不得以 Desktop-embedded
Tester、workspace fixture cache、Tauri command name、source folder、GitHub repo
或 npm package 作为 App admission/install truth。

`MUST NOT`：该 admission 不删除 Desktop-embedded Tester。Desktop-embedded
Tester 只能作为 frozen internal source/validation surface，后续 hard-cut
retirement 必须等待 `nimi.tester` stability evidence。

## Fact Sources

- `.nimi/spec/platform/kernel/architecture-contract.md` — `P-ARCH-001..P-ARCH-021`
- `.nimi/spec/platform/kernel/nimi-home-contract.md` — `P-HOME-001..P-HOME-010`
- `.nimi/spec/platform/kernel/nimi-self-update-contract.md` — `P-SUPD-001..P-SUPD-008`
- `.nimi/spec/platform/kernel/nimi-package-release-contract.md` — `P-PKGREL-001..P-PKGREL-008`
- `.nimi/spec/platform/kernel/cold-start-authority-contract.md` — `P-COLD-001..P-COLD-008`
- `.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md` — `P-AIPS-001..P-AIPS-012`
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — `P-AISC-001..P-AISC-005`
- `.nimi/spec/platform/kernel/capability-catalog-contract.md` — `P-CAPCAT-*`
- `.nimi/spec/platform/kernel/app-slice-admission-contract.md` — `P-APP-*`
- `.nimi/spec/platform/kernel/package-authority-admission-contract.md` — `P-PKG-*`
- `.nimi/spec/platform/kernel/mod-extension-retirement-contract.md` — `P-MOEX-001..P-MOEX-006`
- `.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-app-release-descriptors.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-app-trust-tiers.yaml`
- `.nimi/spec/sdk/kernel/nimi-app-client-contract.md` — `S-APP-001..S-APP-008`
- `.nimi/spec/runtime/kernel/local-engine-contract.md` — `K-LENG-024..K-LENG-028`
- `.nimi/spec/desktop/kernel/nimi-home-shell-contract.md` — `D-HOME-001..D-HOME-012`
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/app-registry-admission-runtime-registration-map.md`
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/trust-tier-enum-floor.md`
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/first-party-hardcut-scope-ledger.md`
