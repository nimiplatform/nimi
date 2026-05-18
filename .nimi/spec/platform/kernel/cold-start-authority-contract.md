# Cold Start Authority Contract

> Owner Domain: `P-COLD-*`

## Scope

定义 `Nimi` 冷启动场景下的 authority owner split。本契约的 floor 由 Wave 0
`cold-start-authority-contract.md` 决议确认，并在本契约固化为 Platform
canonical 规则。

冷启动指 process 启动之后、account / Runtime / 本地依赖 / app registry /
factory AIProfile selection 中任何 authority 尚未 ready 的时间段。

## P-COLD-001 — Fail-Closed Only State Set

`MUST`：在任何 upstream authority ready 之前，`Nimi Home` 只能投影以下
fail-closed 状态：

- `unavailable`
- `setup-required`
- `needs-confirmation`
- `in-progress`
- `failed`
- `unsupported`
- `stale-projection`

`MUST NOT`：不得投影 `empty success`、`best-effort-ready`、`guessed
default`、`anonymous success as authenticated`、或任何"latest-known
projection"作为 ready。

## P-COLD-002 — Process Start Owner Split

| Concern | Owner | Allowed | Forbidden |
|---|---|---|---|
| Process starts | Desktop-hosted Home | 渲染 shell、加载 packaged release metadata、显示非 ready 状态 | 声称 Runtime / account / model / app / memory ready 而未消费 authority projection |

## P-COLD-003 — Runtime Bootstrap Owner Split

| Concern | Owner | Allowed | Forbidden |
|---|---|---|---|
| Runtime bootstrap | Runtime + Desktop host projection | 启动 / 观察 packaged daemon；显示精确失败 | Desktop-owned Runtime 替换、PATH fallback、fake version |

## P-COLD-004 — Account Unauthenticated Owner Split

| Concern | Owner | Allowed | Forbidden |
|---|---|---|---|
| Account unauthenticated | Realm + Runtime custody projection | 显示 sign-in / skip / local posture；Runtime 报告 local custody 状态 | Renderer durable token custody、anonymous success as authenticated |

## P-COLD-005 — Host Capability Detection Owner Split

| Concern | Owner | Allowed | Forbidden |
|---|---|---|---|
| Host capability detection | Runtime | probe / project host profile（`K-LENG-024` 与 `tables/host-capability-profiles.yaml`） | Home GPU / CUDA / Python probing 或 installer 逻辑 |

## P-COLD-006 — AIProfile Selection Policy Owner Split

| Concern | Owner | Allowed | Forbidden |
|---|---|---|---|
| factory AIProfile selection | Platform-owned AIProfile selection policy consuming Runtime evidence | 按 `P-AIPS-004` / `P-AIPS-006` 选择 factory AIProfile；按 `D-AIPC-005` apply 到 AIConfig | UI 中 provider / model 常量（`P-AIPS-008`） |

## P-COLD-007 — Local Dependency Setup Owner Split

| Concern | Owner | Allowed | Forbidden |
|---|---|---|---|
| Local dependency setup | Runtime materializers | plan、confirm、job、verify、promote selected source records（`K-LENV-MAT-*`、`K-LENV-ACT-*`） | Home 直接 download / verify / repair |

## P-COLD-008 — First App / Library Projection Owner Split

| Concern | Owner | Allowed | Forbidden |
|---|---|---|---|
| First app / library projection | Platform registry（Wave 3）+ Home projection | 显示 admitted seed apps + 显式 unknown / unavailable 状态 | App-local discovery truth |

## Cross-Wave Closure

`MUST`：本契约的每条规则均依赖下列下游 wave 与对应 authority；它们的关闭
事件不变 invariant：

- Wave 2 `P-AIPS-*` AIProfile selection policy。
- Wave 3 Nimi App registry / 申请 / 跨 wave joins。
- Wave 4 permission fabric（account、data、agent identity、AI spend、
  memory / cognition access）。
- Wave 5 first-party app integration（Avatar / ParentOS，受 Avatar
  productization master gate 约束）。

`MUST NOT`：在 wave 关闭前以"代为预判"的 default ready 状态投影任何
upstream authority。

## Fact Sources

- `.nimi/spec/platform/kernel/nimi-home-contract.md` — `P-HOME-001..P-HOME-010`
- `.nimi/spec/platform/kernel/nimi-self-update-contract.md` — `P-SUPD-001..P-SUPD-008`
- `.nimi/spec/platform/kernel/nimi-package-release-contract.md` — `P-PKGREL-001..P-PKGREL-008`
- `.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md` — `P-AIPS-001..P-AIPS-012`
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — `P-AISC-001..P-AISC-005`
- `.nimi/spec/runtime/kernel/local-engine-contract.md` — `K-LENG-024..K-LENG-028`
- `.nimi/spec/runtime/kernel/local-environment-materializers-contract.md`
- `.nimi/spec/runtime/kernel/local-environment-consumer-activation-contract.md`
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/cold-start-authority-contract.md`
