# Nimi App Admission Contract

> Owner Domain: `P-NAPP-*`

## Scope

定义 `Nimi App` 作为公开可安装 product unit 的 admission authority。本契约拥有
admission row schema、admitted package kind set、trust tier reference、Default
Experience Profile alias hint reference、capability_set / local compute pack /
runtime registration mode / permission scope reference、与 app health/repair
projection 的 fail-closed semantics。

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
- `default_experience_alias_ref` — 引用
  `tables/default-experience-profiles.yaml` 中已 admit 的 alias（`P-DXP-009`）。
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
- `admission_status` — admitted 值集合：`admitted`,
  `gated_by_avatar_master_gate`, `pending_wave_4`, `deferred`,
  `retired`。
- `source_rule` — `P-NAPP-NNN` 引用。

## P-NAPP-003 — Default Experience Profile Hint Resolution

`MUST`：`default_experience_alias_ref` 必须指向
`tables/default-experience-profiles.yaml` 中已 admit 的 alias（`P-DXP-009`）。

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

## P-NAPP-009 — Library / Discovery Non-Owner Rule

`MUST`：Wave 1 Library / Discovery surface（`D-HOME-004` / `D-HOME-005`）
仅消费 registry projection。

`MUST NOT`：Library / Discovery 不得拥有 admission truth、marketplace
truth、economy truth、package trust truth。

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
  必须先由 Avatar 产品化 master gate 清场，才能切换为 `admitted`。
- `nimi.parentos` — `admission_status: admitted`。

其余 `first-party-hardcut-scope-ledger.md` 中的 deferred app（Forge,
Asset Market, Moment, Polyinfo, Shiji, Realm Drift, Lookdev, Video Food
Map, Overtone）暂不进入 Wave 3 seed。

## P-NAPP-012 — Mechanical Guard Registration

`MUST`：mechanical guard `check:no-public-mod-extension-admission` 在
`enforcement-gates-required.md` 中以 `Required before: Wave 3 close` 注册，
并 block：registry/package rows admitting public Mods or Extensions。

## Fact Sources

- `.nimi/spec/platform/kernel/architecture-contract.md` — `P-ARCH-001..P-ARCH-021`
- `.nimi/spec/platform/kernel/nimi-home-contract.md` — `P-HOME-001..P-HOME-010`
- `.nimi/spec/platform/kernel/nimi-self-update-contract.md` — `P-SUPD-001..P-SUPD-008`
- `.nimi/spec/platform/kernel/nimi-package-release-contract.md` — `P-PKGREL-001..P-PKGREL-008`
- `.nimi/spec/platform/kernel/cold-start-authority-contract.md` — `P-COLD-001..P-COLD-008`
- `.nimi/spec/platform/kernel/default-experience-profile-contract.md` — `P-DXP-001..P-DXP-012`
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — `P-AISC-001..P-AISC-005`
- `.nimi/spec/platform/kernel/capability-catalog-contract.md` — `P-CAPCAT-*`
- `.nimi/spec/platform/kernel/app-slice-admission-contract.md` — `P-APP-*`
- `.nimi/spec/platform/kernel/package-authority-admission-contract.md` — `P-PKG-*`
- `.nimi/spec/platform/kernel/mod-extension-retirement-contract.md` — `P-MOEX-001..P-MOEX-006`
- `.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-app-trust-tiers.yaml`
- `.nimi/spec/sdk/kernel/nimi-app-client-contract.md` — `S-APP-001..S-APP-008`
- `.nimi/spec/runtime/kernel/local-engine-contract.md` — `K-LENG-024..K-LENG-028`
- `.nimi/spec/desktop/kernel/nimi-home-shell-contract.md` — `D-HOME-001..D-HOME-012`
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/app-registry-admission-runtime-registration-map.md`
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/trust-tier-enum-floor.md`
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/first-party-hardcut-scope-ledger.md`
