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

## P-COLD-008 — First App / Apps Projection Owner Split

| Concern | Owner | Allowed | Forbidden |
|---|---|---|---|
| First app / Apps projection | Platform registry + Home projection | 显示 admitted ordinary-visible apps + 显式 unknown / unavailable 状态 | App-local discovery truth |

## P-COLD-009 — Product-Local Control Record

`MUST`：installed Nimi product shell 的 user-local control record 固定为
`~/.nimi/nimi.json`。该文件拥有 ordinary product readiness gate 的小型本地
控制状态，包括 `schemaVersion`、`installId`、`productVersion`、`state`、
`dataRoot`、`firstRun`、`pointers`、and `repair`。

Allowed `state` values are:

- `not_logged_in`
- `config_missing`
- `data_root_missing`
- `data_root_selected`
- `ai_environment_unconfigured`
- `local_ai_profile_selected_assets_missing`
- `local_ai_profile_selected_environment_not_ready`
- `local_ai_assets_downloaded_environment_not_ready`
- `local_ai_ready`
- `repair_required`
- `blocked`
- `ready_for_use`

`MUST NOT`：repo `.nimi/spec/**`、Runtime config、Desktop path cache、or
app-local state must not replace `~/.nimi/nimi.json` as product readiness
owner. Missing or invalid `~/.nimi/nimi.json` routes to `config_missing` /
repair; it must not be treated as ordinary ready.

## P-COLD-010 — User-Selected Data Root

`MUST`：first-run must record an absolute user-selected `nimi_data` path in
`~/.nimi/nimi.json` before heavy downloads, dependency installation, app
package install, model materialization, or environment setup starts. The path is
ready only after writability and required root directory creation evidence.

`nimi_data` owns the large data plane:

```text
models/
dependencies/
environments/
apps/<app-id>/{releases,data,cache,tmp}
accounts/<account-id>/{data,cache,exports,tmp}
cache/
logs/
audit/
generated/
tmp/
```

`MUST NOT`：first-run readiness may not silently default `nimi_data` to
`~/.nimi/data`. Existing Desktop path records may be migration inputs only; they
are not readiness truth until reconciled into `~/.nimi/nimi.json`.

## P-COLD-011 — First-Run Install Level State Machine

`MUST`：first-run presents `Minimal` and `Recommended` install levels, not raw
provider/model/dependency routing. Both levels must be local baselines.

- `Minimal` maps to local text/chat plus local basic STT and TTS.
- `Recommended` is device-aware and may add admitted local embedding, image, or
  GPU support when Runtime evidence and user confirmation support the plan.

Only `ready_for_use` enters ordinary shell, and it requires login, valid
`~/.nimi/nimi.json`, selected `nimi_data`, Account Default Profile, built-in
AIConfigs, Runtime baseline readiness, and execution evidence.

`MUST NOT`：Cloud API, cloud-only, cloud-first, hybrid, connector setup, video
generation, or app-specific pack setup may satisfy first-run readiness.

## P-COLD-012 — Ready Entry And Auth Gate

`MUST`：after `ready_for_use`, Desktop opens ordinary product use at
`Chat -> Nimi Chat`. `Home` remains the Realm feed surface; it is not the ready
entry target.

`MUST`：logged-out ordinary shell use is not current product baseline.
Unauthenticated users route to login or recovery-only states until a Runtime
account session projection exists.

`MUST NOT`：Desktop may not render the ordinary shell as normal use when account
state is `not_logged_in`, and may not treat anonymous Runtime/debug posture as
authenticated product readiness.

## P-COLD-013 — Runtime Config Owner Split

`MUST`：Runtime config belongs under `~/.nimi/runtime/config.json` and may
reference selected `nimi_data` through `dataRootRef` and managed root fields.
Runtime config owns daemon/materialization roots and service posture; product
setup ownership remains in `~/.nimi/nimi.json`.

`MUST NOT`：root-level `~/.nimi/config.json`, `~/.nimi/runtime/config.json`,
`~/.nimi/nimi.json`, and Desktop path cache records are not interchangeable
owners. Migration may read old files only as explicit migration evidence and
must fail closed on ambiguous conflicts.

## P-COLD-014 — Canonical First-Run State Machine

`MUST`：first-run product states, entry conditions, allowed user actions, exit
conditions, and copy floor are canonically recorded in
`tables/first-run-state-machine.yaml`.

`MUST`：Desktop first-run UI must consume the product-control state semantics
from this table. Generic cold-start diagnostics may be displayed as secondary
status, but must not replace the first-run workflow state.

`MUST NOT`：Desktop may not collapse the first-run workflow into generic
`ready` / `available` / `done` states, and may not show technical enum names as
the primary user-facing copy.

## P-COLD-015 — Product-Control Record Schema Invariants

`MUST`：the canonical product-control record schema invariants are recorded in
`tables/product-control-record-schema.yaml`.

`MUST`：any path that transitions `~/.nimi/nimi.json` to `ready_for_use` must
validate selected `nimi_data`, local install level, Account Default Profile,
built-in `AIConfig` refs, Runtime baseline ref, and execution evidence ref.

`MUST NOT`：Runtime config, Desktop path cache, file existence, transfer
completion, import success, endpoint probe, script exit, or renderer-local
state may satisfy product readiness without the `ready_for_use` product-control
record and required evidence fields.

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
- `.nimi/spec/runtime/kernel/config-contract.md` — `K-CFG-*`
- `.nimi/spec/runtime/kernel/local-environment-materializers-contract.md`
- `.nimi/spec/runtime/kernel/local-environment-consumer-activation-contract.md`
- `.nimi/spec/platform/kernel/tables/first-run-state-machine.yaml`
- `.nimi/spec/platform/kernel/tables/product-control-record-schema.yaml`
- `.nimi/topics/closed/2026-05-17-nimi-home-platform-entry-redesign/cold-start-authority-contract.md`
