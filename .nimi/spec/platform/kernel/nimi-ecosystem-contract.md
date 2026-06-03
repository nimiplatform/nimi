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
