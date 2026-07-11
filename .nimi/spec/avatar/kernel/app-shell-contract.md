# App Shell Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: active industrial baseline (supersedes retired small-button surface framing)
> **Sibling contracts**:
> - [Embodiment projection contract](embodiment-projection-contract.md)
> - [Live2D render contract](live2d-render-contract.md)
> - [Agent script contract](agent-script-contract.md)
> - [Avatar event contract](avatar-event-contract.md)
>
> **First-Party Runtime Boundary**：
> 本 contract 约束默认 Nimi Avatar app。Avatar 是 Runtime-admitted local first-party Nimi app（default app id `nimi.avatar`），Desktop 启动时只传递 `agent_id`、optional `avatar_instance_id`、optional non-authoritative `launch_source`。Avatar 使用 Runtime account projection 与 Runtime-mediated Realm/service operations only；public `GetAccessToken` is a deny-all tombstone pending A.3d removal，first-party identity 不产生 bearer exception。它不得持有 access/refresh token、authorization header、durable auth session、shared auth truth、independent Realm auth truth、或 Avatar-local JWT subject truth。Desktop 不得把 scoped binding、visual package truth、conversation anchor truth、account/user truth、Realm/auth material 透传给默认 Avatar 启动路径。
>
> Explicit binding-only / embedded / delegated Avatar mode 仍可由 `K-BIND-*` admit，但它不是 Desktop-launched Avatar 的默认路径。
>
> **Surface Composition Admission**: this contract fixes the surface composition model as `embodiment-stage` / transient Avatar overlays / `degraded-surface`. The ready posture is embodiment-first: `embodiment-stage` is the only default visible ready surface. Text entry, settings, context menu, action radial, captions, and other controls are transient overlays opened by explicit user intent or Runtime presentation state. The retired small chat button path and permanent bottom companion bar remain forbidden; degraded posture remains isolated in `degraded-surface`.

---

## 0. 阅读指南

本 contract 定义 Nimi Avatar 桌面 shell 的 window、交互、surface composition 与 lifecycle 行为。Avatar 不是常规软件窗口，而是**桌面悬浮 embodiment surface**：形象即 UI，透明背景，无 chrome，always-on-top。本 contract 专注 Tauri shell surface 的规则；shell 依赖 embodiment projection layer 提供 surface bounds / hit region，而不是直接拥有 backend truth。

本 contract 是 Avatar shell surface 的完整权威。新增 surface、composition state、window sizing、hit-region 或 lifecycle 行为必须先更新本 contract 及对应 table authority。

---

## 1. Window Configuration

## K-NAV-SHELL-001 Tauri Window Config

Window 必须以如下 config 启动（不可 runtime 改变）：

| Property | Value | Reason |
|---|---|---|
| `transparent` | `true` | 背景透明，形象即 UI |
| `decorations` | `false` | 无 title bar / close / min buttons |
| `alwaysOnTop` | `true` (default) | Avatar embodiment 默认常驻可见；用户 setting 可覆盖 |
| `resizable` | `true` (programmatic only) | Runtime 按 model bounds + transient overlay policy 调整 |
| `skipTaskbar` | `true` | 不在 taskbar 显示（dock 上有 tray icon） |
| `shadow` | `false` | 无 window shadow（形象自身有阴影） |
| `width` / `height` | Initial 400 × 600 | 启动占位，model 加载完按 bounds 调整 |

## K-NAV-SHELL-002 Dynamic Window Size

Window 尺寸**必须**默认跟随当前 embodiment backend 产出的 surface bounds。Transient overlay 不是默认 ready window footprint 的一部分，除非对应 wave 显式 admission 为 window-contained overlay：

- Model 加载完成（`avatar.model.load`）→ renderer 计算 `embodiment_bounds`（model alpha bounding box）→ 调用 kit 标准 `floatingWindow.setBounds({ width, height })` 同步 window
- Model 切换（`avatar.model.switch`）→ 同上
- Avatar scale changes → recompute `embodiment_bounds * scale` + `floatingWindow.setBounds`
- Transient overlay open/close → default 不改变 ready window bounds；overlay 自身按 floating layer 定位和 click-through 区域参与 hit-region
- User 手动 resize 不允许（通过 `resizable: false` 在 runtime 效果上禁止 drag-handle；程序化 `floatingWindow.setBounds` 仍然可用）

详细 sizing policy 见 `kernel/tables/window-bounds-policy.yaml`。

## K-NAV-SHELL-003 Initial Position

- 首次启动：屏幕右下角 padding 24px
- 后续启动：记忆上次关闭时位置（persisted via `tauri-plugin-window-state` 或等价机制）
- Multi-monitor：恢复到上次 monitor；若 monitor 不可用，fallback 到 primary monitor

---

## K-NAV-SHELL-004 Hit Region & Click-through

### 2.1 Hit Region 定义

Avatar window 形状为矩形，但用户视觉只看到 embodiment surface + active transient overlays。**两者外区域必须穿透鼠标事件到下层 app**。

### 2.2 Hit Region 计算

每帧（或 active surface bounds / alpha mask 变化时）计算 hit region：

```
hit_region = union of:
  - embodiment-stage 当前 backend surface alpha > threshold (current Live2D branch uses model alpha)
  - active transient overlay rectangles (context menu, action radial, transient composer, captions, settings, appearance, debug)
  - degraded-surface 矩形（degraded 状态下替代 embodiment + transient overlays）
```

渲染器把 hit region 以 mask 形式通过 kit 标准 `floatingWindow.setIgnoreCursorEvents` + per-region 切换应用到 window。cursor 位置查询是 avatar app-local hit-testing（与 alpha-mask click-through 决策紧耦合，app-owned），不属于 kit 标准 floating-window primitive。

### 2.3 Click-through 边界规则

- **In-region**（surface 像素 / active transient overlays / degraded-surface）：鼠标事件属于 avatar
- **Out-of-region**（透明区域）：`floatingWindow.setIgnoreCursorEvents({ ignore: true })` 状态，事件穿透到下层 app
- **State transition**：mouse move 跨越 region 边界 → immediate switch；不做 hysteresis

## K-NAV-SHELL-COMPOSITION-006 Hit Region 双层结构

> Replaces the retired single-layer alpha-mask path with **alpha-mask + bbox 双层互补**.

Hit region 由 **两层** 数据组成：

1. **alpha-mask hit query**（pixel-level，per-frame query）
   - 来自 `BackendHitRegion.isOpaqueAtClientPoint(clientX, clientY, threshold?)`
     —— 当前 backend 提供精确 alpha 抽样 API
   - 实现走 **offscreen render-target** + 1/2 res sampling（airi 工业基线）
   - 默认 `threshold = 10/255`（airi）；caller 可覆盖
   - per-frame query budget ≤ 1ms；超预算 fallback 到当前帧 bbox
   - 当 backend 返回 `null`（未实现 / 不可用 / device tier C 退化）→ 仅用 bbox

2. **bbox snapshot**（粗粒度 rect，throttled 上报）
   - 来自 `BackendHitRegion.body` / `BackendHitRegion.drag`
   - 100ms minimum throttle 上报到 `embodiment-stage`；coalesce frequent
     bbox 变化以避免刷爆 `floatingWindow.setIgnoreCursorEvents` 调用
   - 是 OS-level click-through fallback：alpha-mask 失败 / device 不支持
     时单独工作

事件触发顺序（pointermove → click-through 决策）：

```
pointermove(clientX, clientY)
  ↓
backend.hitRegion.isOpaqueAtClientPoint(x, y)
  ├── true  → floatingWindow.setIgnoreCursorEvents({ ignore: false })（事件归 avatar）
  ├── false → guard by body bbox
  │           ├── inside  → floatingWindow.setIgnoreCursorEvents({ ignore: false })（alpha probe 可能误读；保交互入口）
  │           └── outside → floatingWindow.setIgnoreCursorEvents({ ignore: true })（穿透到下层 app）
  └── null  → fallback to body bbox check
              ├── inside  → floatingWindow.setIgnoreCursorEvents({ ignore: false })
              └── outside → floatingWindow.setIgnoreCursorEvents({ ignore: true })
```

`floatingWindow.setIgnoreCursorEvents` 调用频率约束 ≤ 60Hz（avatar 侧节流纪律强制；log assert）。

## K-NAV-SHELL-COMPOSITION-007 Device Tier Baseline

> Per-device capability detection at carrier mount.

| Tier | 设备 baseline | 能力 |
|---|---|---|
| **A** | M-series Apple Silicon (M1+) | 全 alpha-mask + bbox 双层 + 60Hz pointermove + VRM MToon outline |
| **B** | Intel macOS 12+ / Win 11 / Linux Wayland with integrated GPU | 全 alpha-mask + bbox 双层 + 60Hz；MToon outline 按 GPU 报告决定 |
| **C** | 旧设备 / capability detection failure / pointermove > 60Hz （hardware fallback） | **bbox-only**；emit `avatar.hit_region.degraded { reason_code: 'device_tier_c' }`；alpha-mask 不调用 |

device tier detect：carrier 启动时通过 GPU vendor / GLSL ES 版本 / 基准帧率
测试综合判定；结果存 `nimi.avatar.deviceTier` 全局 key。tier 一旦确定不再
runtime 变更（除非 reload）。

## K-NAV-SHELL-008 Drag Region 限定

Window drag（§3）仅在 embodiment-stage 内部触发：

- Drag-allowed = embodiment alpha > threshold AND not within active transient overlay bounds
- Transient overlay 内部 pointer down 不开启 window drag（保留组件自身交互如 input focus / button click）
- Degraded-surface 内部 pointer down 同样不开启 window drag

---

## K-NAV-SHELL-005 Window Drag

### 3.1 Drag 触发

用户在 drag-allowed region 内按下左键拖动 → 整个 window 移动：

```
Pointer down inside drag-allowed region (§2.4)
  ↓
Move N pixels
  ↓ yes → window drag mode
  │
  └── pointer up without threshold → click/double-click event
```

- `drag_threshold`: 4px (避免误触)
- Stationary hold does not start window drag. A 1s hold with movement below
  `drag_threshold` is reserved for `avatar.user.long_press` → action radial.

### 3.2 Drag 实现

通过 kit 标准 `floatingWindow.beginManualDrag`（返回当前 window origin，`mode = manual`）+ `floatingWindow.moveManualDrag`（origin + 总位移）实现 manual 拖动。透明悬浮窗不依赖系统级 `start_dragging`。拖动期间：

- Emit `avatar.user.drag.start` at drag begin
- Emit `avatar.user.drag.move` at 30 Hz during drag
- Emit `avatar.user.drag.end` at drag end
- Runtime 接收 events 可做 physics feedback（NAS continuous handler）

### 3.3 Drag Edge Constraints

- 不限制到 screen 内（允许拖到屏幕边缘部分可见，便于 peek）
- 最小可见 padding：embodiment_bounds 的 20% 必须留在屏幕内
- 多 monitor：允许拖到其他 monitor，移动时 window state 同步 monitor 变更

## K-NAV-SHELL-010 Visible Area Constraint

Avatar window movement must preserve the visible-area invariant defined by
`kernel/tables/window-bounds-policy.yaml`: at least 20% of the active
`embodiment_bounds` area remains inside the current monitor work area. Transient
overlay footprint is excluded from the ratio so the visible avatar body, not
auxiliary UI, remains recoverable by drag. The invariant is enforced via the kit standard `floatingWindow.constrainToVisibleArea({ minVisibleRatio })` primitive (called after drag end); the 20% visible-area policy remains avatar authority.

---

## K-NAV-SHELL-006 Always-on-Top & Focus

### 4.1 Default 状态

- Always-on-top **启用**（default）
- 即使 avatar window 无 focus，依然 render 于顶层

### 4.2 Context Menu Shell Lifecycle Actions

The avatar-local context menu may expose shell-owned lifecycle actions:

- `Hide avatar` calls the kit standard `floatingWindow.hide` to hide the current window. It does not destroy runtime/agent authority and does not mutate conversation state. Desktop/Runtime launch or reveal flows may show the same instance window again.
- `Close this avatar` calls the kit standard `floatingWindow.close` to close the current avatar instance window. Registry cleanup and durable instance truth remain owned by the Tauri/Desktop launch substrate, not the renderer.
- Both actions must record explicit request evidence before invoking shell
  lifecycle commands.
- These actions must not be implemented as renderer-only CSS visibility,
  unmounting, or local store state; the OS window lifecycle is the source of
  truth.

### 4.2.1 Context Menu Interrupt Action

The avatar-local context menu may expose `Interrupt` only when the current
Runtime-bound conversation anchor has an active turn projection. The action:

- calls the Avatar bootstrap handle backed by
  `runtime.companionParticipation.cancel`
- passes the current `conversation_anchor_id` and active `turn_id`
- records `avatar.shell.interrupt.requested` before invoking Runtime
- records `avatar.shell.interrupt.failed` if Runtime rejects the request
- must not locally synthesize `interrupted`, stop playback as a success claim,
  or mutate conversation history; Runtime turn/audio projection remains the
  source of interruption truth

## K-NAV-SHELL-011 User Override

Avatar shell 仅暴露下列 avatar-shell-local 行为开关，默认通过 context menu 的 settings transient overlay 调整：

- `always_on_top: true|false`（default `true`）
- `show_voice_captions: true|false`（default `true`；只影响 bounded foreground caption reveal，不影响 voice continuity truth）

Settings UI 必须保持 product-light：

- 不得暴露 transcript-heavy、desktop-parity、background voice、或 runtime owner-crossing setting
- 不得把 settings 当作 launch/runtime fail-closed posture 的 bypass
- 不得 inline 在主区（embodiment-stage），必须以 transient overlay 形式弹出，遵从 K-NAV-SHELL-OUTPUT-004 / 009

### 4.3 Focus Event

- Avatar 获得系统 focus → emit `avatar.app.focus.change` with `{ focused: true }`
- 失去 focus → emit with `{ focused: false }`
- 不把 always-on-top 等同于 focus（两者独立）

---

## K-NAV-SHELL-007 Visibility

### 5.1 Visibility States

| State | 语义 |
|---|---|
| `on_screen` | 正常显示 |
| `off_screen` | 用户手动隐藏（tray 图标右键 → hide） |
| `tray_minimized` | 最小化到 tray |

### 5.2 Visibility Transitions

- User 显式 hide/show → emit `avatar.app.visibility.change` with new state
- 系统级 screen lock / display sleep → emit with `off_screen`；resume 时 `on_screen`

---

## 6. Surface Composition (K-NAV-SHELL-COMPOSITION-*)

## K-NAV-SHELL-COMPOSITION-001 Composition States

Avatar shell 的渲染由 **composition state** 决定。任何时刻 shell 处于且仅处于以下一个 composition state：

| Composition state | 触发条件 | 渲染 surface |
|---|---|---|
| `ready` | bootstrap 完成 + visual carrier ready + runtime binding active | `embodiment-stage`；transient overlays only when explicitly opened |
| `loading` | bootstrap 进行中（pre-`avatar.app.ready`） | 仅 `loading-surface`（degraded-surface 子形态） |
| `degraded:reauth-required` | runtime account state ≠ AUTHENTICATED | 仅 `degraded-surface`（reauth posture） |
| `degraded:runtime-unavailable` | daemon 不可用 / protected access 不可用 / driver_start 失败 | 仅 `degraded-surface`（runtime posture） |
| `degraded:launch-context-invalid` | 缺失或非法 launch intent（无 `agent_id`） | 仅 `degraded-surface`（launch posture） |
| `error:bootstrap-fatal` | bootstrap 抛错且不属于上述 typed degraded reason | 仅 `degraded-surface`（fatal posture） |
| `relaunch-pending` | desktop 推送了 launch context update，等待 shell reload | 仅 `degraded-surface`（relaunch notice） |

## K-NAV-SHELL-COMPOSITION-002 互斥规则

- 三类 surface（embodiment-stage / transient overlays / degraded-surface）必须**硬性互斥呈现**于 ready 与非 ready 之间：
  - `ready` → embodiment-stage 默认可见；transient overlays 仅按用户/Runtime 明确状态短暂挂载；degraded-surface 不渲染
  - 任何 non-ready composition state → 仅 degraded-surface 可见；embodiment-stage 与 transient overlays 完全不渲染
- 不允许出现"degraded panel + embodiment 一起渲染"的 mid-state；若 ready 转入 degraded，必须先卸载 ready surface 再挂载 degraded surface
- 不允许在 ready 主区域显示 diagnostic 文字、reason summary、或 recovery copy；这些信息只能出现在 degraded-surface
- 不允许在 degraded-surface 内嵌入 transient overlay 或 embodiment-stage 子组件（保持视觉权威单一）

## K-NAV-SHELL-COMPOSITION-003 状态转移

- `loading` → `ready`：bootstrap 完成 + visual ready
- `loading` → `degraded:*`：bootstrap 失败，按 typed reason 进入对应 degraded sub-state
- `ready` → `degraded:*`：runtime/account/binding 在运行期失效（典型如 access token expire 后 refresh 失败、binding revoked、carrier disconnect 不可恢复）
- `ready` → `relaunch-pending`：desktop 推送 `nimi-avatar://launch?...` 更新到现有 instance；shell 必须卸载 ready surface、显示 relaunch notice 并主动 reload
- 任何 degraded → `loading`：仅由用户显式触发的 reload 路径开启；shell 不允许自动从 degraded 自愈到 ready

## K-NAV-SHELL-COMPOSITION-004 Composition Evidence

每次 composition state 转移必须写入 evidence（`avatar-carrier-evidence` projection）：

- `avatar.composition.transition`：detail 包含 `from`、`to`、`reason_code`、`account_reason_code`、`stage`、`recorded_at`
- 转入 `degraded:*` 与 `error:*` 时同步 emit `avatar.runtime.bind-failed` 或 `avatar.startup.failed`（按既有 evidence schema）
- `relaunch-pending` 转移必须 emit `avatar.composition.relaunch-pending`，含 `next_launch_context` summary

## K-NAV-SHELL-COMPOSITION-005 Fail-Close 与 Mock 路径

- 任何非 explicit fixture mode（`VITE_AVATAR_DRIVER=mock`）下，runtime 不可用时禁止 silent fallback 到 mock
- explicit fixture mode 下，shell 进入特殊 composition state `fixture:active`，渲染 embodiment-stage + fixture-only diagnostics overlay（仅消费 fixture data，不连 runtime）+ persistent banner 标识 fixture 来源
- 任何 composition state 不允许向用户隐瞒来源（runtime 与 fixture 必须可读区分）

---

## 7. Embodied Output Interaction (K-NAV-SHELL-OUTPUT-*)

Avatar ready posture is an embodied output layer. The character is the product surface. Tooling, text entry, settings, and local interaction controls are transient overlays. Avatar does not own conversation authority, wake-word authority, foreground listener arbitration, or multi-avatar speech orchestration; those belong to Runtime / Nimi ecosystem app authority.

## K-NAV-SHELL-OUTPUT-001 Default ready posture

- `embodiment-stage` is the only always-visible ready surface.
- No bottom companion bar, persistent chat box, persistent settings strip, or permanent presence capsule is admitted in product default.
- Privacy/activity state may be shown through character motion, expression, short captions, small transient indicators, or Runtime-driven presentation state.
- A dev/debug fixture may expose extra diagnostics, but it must be visibly fixture-only.

## K-NAV-SHELL-OUTPUT-002 Authority boundary

- Runtime owns wake phrase lifecycle, foreground response priority, listening fan-out, audible speaker serialization, interruption policy, and text/voice conversation truth.
- Nimi ecosystem apps may route output through Avatar, but the app/Runtime owns what is expressed.
- Avatar owns local presentation: model rendering, motion/expression playback, local interaction affordances, transient overlays, position, scale, and hit-region.
- Avatar must not create local conversation history, local wake-word truth, or local multi-avatar speaker arbitration.

## K-NAV-SHELL-OUTPUT-003 Avatar-local inputs

| Input | Behavior | Owner |
|---|---|---|
| Single click | local lightweight character reaction only; must not create a Runtime conversation turn | Avatar presentation |
| Press-and-hold 1s with no meaningful pointer movement | open action radial | Avatar shell |
| Double click | mark this avatar as foreground response priority and play wake feedback | Runtime priority intent + Avatar feedback |
| Right click | open avatar-local context menu | Avatar shell |
| Wheel over opaque avatar body | scale current avatar instance | Avatar shell persisted state |
| Drag | move current avatar window | Avatar shell |

## K-NAV-SHELL-OUTPUT-004 Context menu

Right click on the opaque avatar body opens a menu scoped to that avatar instance. The menu is tool-focused, not character-play-focused:

- Open text input.
- Wake / set as foreground respondent.
- Interrupt current output.
- Appearance.
- Reset scale.
- Always on top.
- Hide.
- Close this avatar.
- Settings.
- Debug.

## K-NAV-SHELL-OUTPUT-005 Action radial

Press-and-hold opens a character-interaction radial. The first admitted radial actions are presentation-only unless explicitly opening text input:

- Greet.
- Look at me: local focused presentation / gaze feedback only; must not create
  a Runtime text or voice turn.
- Happy.
- Quiet.
- Random motion.
- Open text input.

## K-NAV-SHELL-OUTPUT-006 Transient text composer

Text input is a transient composer, similar to a command/search input:

- Opens from context menu or action radial.
- Anchors near the avatar; it must not sit as a permanent bar under the feet.
- Shows no conversation history.
- Enter submits a bounded text turn to the current Runtime-bound agent context.
- Submission must not auto-close; repeated text turns are allowed while it remains focused.
- Focus switch, Escape, or explicit close dismisses it.
- Desktop agent chat remains history authority.

## K-NAV-SHELL-OUTPUT-007 Voice and proactive output

- Default wake words are global `Nimi` plus avatar name; users may customize them through Runtime-owned policy.
- Avatar may display listening, speaking, waiting, emotion, and app-driven output states, but must not own the decision to listen or respond.
- Same-time audible speech across avatars is serialized by Runtime. Non-speaking avatars may show expressions, motions, or short captions.
- Proactive output from Runtime/Nimi apps is allowed. Default policy is non-interrupting unless Runtime marks higher urgency.
- Closed lifecycle ids in `wake-local-audio-lifecycle-contract.md` remain the presentation vocabulary for local audio/voice state. `wake_future_unadmitted` must fail closed until Runtime admits wake lifecycle ownership.

## K-NAV-SHELL-OUTPUT-008 Scale

- Wheel over the opaque avatar body scales that avatar instance.
- Scale persists by `avatar_instance_id`; when no instance id exists, an explicit fixture/dev fallback key may be used.
- Scale affects embodiment bounds, hit-region, window size, and visible-area constraint. It must not be CSS-only visual scaling.
- Context menu must expose reset scale.

## K-NAV-SHELL-OUTPUT-009 Transient overlay lifecycle events

Precise schema lives in [avatar-event-contract.md](avatar-event-contract.md). Required event families:

- `avatar.shell.context_menu.*`
- `avatar.shell.action_radial.*`
- `avatar.shell.composer.*`
- `avatar.shell.scale.*`
- `avatar.shell.foreground_priority.requested`
- `avatar.shell.appearance.*`
- `avatar.shell.debug.*`

## K-NAV-SHELL-OUTPUT-010 Debug overlay

Context-menu `Debug` may open a transient Avatar debug overlay only when the
current shell is Runtime-bound to an active `agent_id + conversation_anchor_id`.
The overlay is a local diagnostic entry to Runtime-owned Avatar debug probes; it
is not the Desktop debug workbench authority.

Fixed rules:

- The overlay may read Runtime avatar debug snapshot/list projections through
  typed SDK/Runtime avatar debug methods.
- The overlay may request only Avatar-backend probes:
  `backend_load`, `capability_profile`, `route_support_matrix`,
  `generated_motion`, `emotion_expression`, `speech_lipsync`, and
  `window_hit_region`.
- `requested_by` remains Runtime's stable admitted `desktop_debug_workbench`
  enum value for this typed probe client; the enum name is not Desktop-local UI
  authority. Avatar must not add a local requested-by enum or raw app-bus
  bypass.
- Avatar backend evidence must still flow through Runtime's typed
  `SubmitAvatarDebugProbeResult` path before becoming public diagnostic truth.
- The overlay must not expose package paths, tokens, raw APML, raw provider
  payloads, raw MCP/A2A payloads, app business data, or backend command strings.
- `Appearance` remains separate authority; Debug must not mutate asset/model
  selection or avatar instance ownership.

## K-NAV-SHELL-OUTPUT-011 Appearance overlay

Context-menu `Appearance` may open a transient Avatar appearance overlay only as
a read-only view of the currently running Avatar visual carrier. It is not the
Desktop Agent Avatar configuration surface and must not become a local asset
selection, import, activation, or model-switch authority.

Fixed rules:

- The overlay may display current runtime-local carrier summary fields:
  backend kind, model id, current source authority (`runtime` or explicit
  `fixture`), and current avatar-local scale.
- The overlay may record `avatar.shell.appearance.opened` and normal
  `avatar.composition.surface-mounted/unmounted` lifecycle evidence.
- The overlay must not mutate `local_avatar_asset_ref`, runtime
  `AgentPresentationProfile`, Desktop avatar configuration, launch payload, or
  avatar live instance binding.
- The overlay must not expose package paths, materialization roots, model file
  paths, local filesystem paths, package descriptors, tokens, raw APML, raw
  provider payloads, raw MCP/A2A payloads, app business data, or backend command
  strings.
- Asset import, selection, readiness, and launch policy remain owned by Desktop
  Agent Avatar configuration and the Runtime/Avatar local materialization
  boundary described in §9.

## K-NAV-SHELL-OUTPUT-012 Localization boundary

All user-visible Avatar shell copy must be backed by bundled locale resources.
The Avatar kernel owns localization semantics only:

- required surface roles such as title, summary, recovery affordance,
  diagnostics labels, captions, menu labels, and aria labels
- required product meaning for fail-closed Runtime/account/binding states
- forbidden wording classes, including CORS, shared auth, workaround, raw stack,
  raw provider payload, token, and local bypass language
- interpolation semantics when a product fact must be included, such as a
  human-readable reason or active state

Concrete i18n key names, English/Chinese text, fallback text, translation
values, and consuming component paths are app-owned implementation resources.
They must stay outside `.nimi/spec/**`. App-side validation must fail closed
when locale resources are missing required keys, contain orphan keys, or contain
empty/TODO copy.

---

## 8. Degraded Surface (K-NAV-SHELL-DEGRADED-*)

## K-NAV-SHELL-DEGRADED-001 Surface 形态

Degraded Surface 是 ready 之外所有 composition state 的唯一渲染表面。Surface 内部结构：

| 区域 | 内容 |
|---|---|
| Banner | composition state 类型与 reason badge（如 `Runtime unavailable` / `Reauth required` / `Launch context invalid`） |
| Title | 本地化的简短描述 |
| Summary | 本地化的多行描述，包含 reason code / action hint（如可读化） |
| Recovery affordance | 一个显式 `reload shell` button（仅触发 app reload / relaunch）；degraded 期不允许其他 affordance |

## K-NAV-SHELL-DEGRADED-002 Reason 透传

- Bootstrap 抛错时透传到 degraded-surface 的字段：`stage`、`reason_code`、`account_reason_code`、`action_hint`、`source`、`retryable`
- Surface 必须显式呈现本地化的 stage 与 reason_code 标签（不是裸字符串）
- 不允许显示 stack trace 或 raw error message 作为主区文案；仅本地化 diagnostics 子区域以 collapsible 形式可选呈现

## K-NAV-SHELL-DEGRADED-003 No Mock Fallback

- Degraded surface 期间禁止任何 mock fallback 路径
- 不允许把"上一次成功的 visual carrier"留作 degraded 期间的部分 ready；进入 degraded 立即卸载 carrier

## K-NAV-SHELL-DEGRADED-004 Reload 行为

- `reload shell` 行为：调用 shell-reload 流程，清空 avatar-local transient state（draft、bubble echo、foreground voice capture/caption）后重新进入 `loading`
- Reload 不允许触发 silent retry / 自动重连；必须由 user 显式启动
- Relaunch-pending 状态下的 reload 与 launch context update 联动：reload 完成后 desktop-pushed 新 context 接管启动

## K-NAV-SHELL-DEGRADED-005 Degraded Lifecycle Evidence

- 进入 degraded 状态：emit `avatar.composition.transition` (K-NAV-SHELL-COMPOSITION-004) + 对应的 startup/bind-failed evidence
- User 触发 reload：emit `avatar.shell.reload-requested`，detail 含 `from_state`
- Reload 完成后回到 `loading` 时 emit `avatar.shell.reload-resumed`

---

## K-NAV-SHELL-009 App Lifecycle Events

### 9.1 Start → Ready 序列

```
1. Tauri window created
2. Renderer bootstrap (React mount)
3. Emit avatar.app.start (composition state = loading)
4. Register / identify as Runtime-admitted local first-party app (`nimi.avatar`)
5. Validate launch `agent_id` through Runtime / SDK authority
6. Prepare SDK Runtime-backed protected access provider (typed admitted)
7. Resolve the selected local Avatar asset and load materialized Live2D / VRM
   files
8. Create or recover Avatar-owned conversation context
9. Scan <model>/runtime/nimi/ for NAS handlers (§agent-script-contract)
10. Compute initial hit region + resize window to embodiment surface bounds
11. Mount embodiment-stage (composition state → ready); transient overlays remain unmounted until explicitly opened
12. Emit avatar.app.ready
```

任一 step 失败必须按 §6 状态机进入对应 degraded composition state，且不允许 partial mount（embodiment 还在 loading 状态时不得显示 ready overlays）。

### 9.2 Runtime First-Party Bootstrap

Supersedes the earlier Desktop scoped-binding-only launch rule. Avatar is a
local first-party app and uses Runtime account projection plus Runtime-mediated
broker/service operations when it needs authorized private data.

Normal path boundary:

- launch bootstrap：Desktop launch intent only (`agent_id`, optional
  `avatar_instance_id`, optional `launch_source`)
- runtime bootstrap：Runtime local first-party app registration / account
  projection / SDK Runtime-backed token provider
- protected access bootstrap：Avatar 通过 SDK local first-party
  Runtime-backed token provider 为 `runtime.agent` turns API 获取
  request-time capability token；默认路径不 issue scoped binding
- visual bootstrap：Avatar resolves the selected local Avatar asset into
  materialized Live2D/VRM files after Runtime validates `agent_id`. Remote
  marketplace package sources are retired (Asset Market withdrawn); local
  import + materialization is the only launch-time source of visual truth.
  Current Agent Center resolver plumbing is local Avatar asset materialization
  storage, not marketplace package lifecycle, inventory, or activation
  authority. For Live2D, the resolver MAY project the Desktop-owned
  `live2d_calibration_ref` as opaque read-only evidence when present; this
  projection is not launch payload, not calibration payload/value truth, and
  MUST report calibration effect as not admitted.
- data bootstrap：Runtime / SDK validates `agent_id` for the current Runtime
  account projection before private agent/user data or authorized local visual
  materialization loads
- conversation bootstrap：Avatar creates or recovers an Avatar-owned context

Login / account handling:

- Avatar may invoke the Runtime-brokered local first-party login adapter when
  account state requires user action.
- Avatar must not run independent Realm login or own browser callback custody.
- Avatar must not receive refresh tokens, durable session material, raw JWT, or
  Avatar-local subject truth.
- Avatar never receives account bearer material; Runtime performs credential
  access, authorization and network invocation before returning typed results.

Failure handling:

- missing/unavailable Runtime account state closes data/interaction capabilities
  that require account authority; it must not silently downgrade to fixture.
- unauthorized `agent_id` must show a typed unauthorized state.
- 任何 stage 失败必须按 §6 转入对应 degraded composition state；不允许把"已加载的 local visual carrier" 留作 degraded 期间的伪 ready.
- failure copy must use product account/runtime language and must not mention
  backend CORS or shared auth as a solution.

### 9.3 Shutdown 序列

```
1. User triggers quit (tray → exit / hotkey)
2. Emit avatar.app.shutdown
3. Cancel in-flight NAS handlers (abort signal)
4. Cancel transient overlay/composer in-flight operations
5. Dispose Cubism SDK resources
6. Close Tauri window
7. Process exit
```

### 9.4 Event Payload Shapes

```yaml
avatar.app.start:
  detail:
    launched_by: enum(standalone|with_desktop|tray)
    composition_state: enum(loading)
    model_path: string?

avatar.app.ready:
  detail:
    model_id: string
    nas_handler_count: int
    startup_duration_ms: int
    composition_state: enum(ready)

avatar.composition.transition:
  detail:
    from: string                      # composition state name
    to: string
    reason_code: string?
    account_reason_code: string?
    stage: string?
    recorded_at: string               # ISO 8601

avatar.app.focus.change:
  detail:
    focused: bool
    prev_focused_app: string?

avatar.app.visibility.change:
  detail:
    state: enum(on_screen|off_screen|tray_minimized)
    trigger: enum(user|system_sleep|screen_lock|other)

avatar.app.shutdown:
  detail:
    reason: enum(user_quit|os_shutdown|crash_recovery)
```

---

## 10. Boundary with Other Contracts

| Concern | This contract | Other contract |
|---|---|---|
| Window config / sizing / drag / click-through | ✅ | — |
| Surface composition states | ✅ | — |
| Embodied output interaction / transient overlay lifecycle | ✅ | — |
| Degraded surface 与 reload 行为 | ✅ | — |
| Embodiment projection truth | shell consumes only | `embodiment-projection-contract.md` |
| Live2D rendering pipeline | current backend branch | `live2d-render-contract.md` |
| NAS handler execution | — | `agent-script-contract.md` |
| `avatar.user.*` / `avatar.app.*` / `avatar.shell.*` event schema | App shell emits | `avatar-event-contract.md` defines schema |
| Mock driver vs real SDK binding | — | `mock-fixture-contract.md` |
| Lipsync timing / voice playback truth | — | `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` |

---

## 11. Tauri Permission Requirements

Minimum permission set for industrial baseline shell。窗口控制走 kit 标准 `nimi_shell_tauri` floating-window 命令，这些命令在 Rust 侧直接调用 window API，仍需要下列 window 权限（manual drag 用 `set_position`，不再依赖 `start_dragging`）：

- `core:window:allow-set-size`
- `core:window:allow-set-position`
- `core:window:allow-set-always-on-top`
- `core:window:allow-set-ignore-cursor-events`
- `fs:allow-read-dir` / `fs:allow-read-text-file`（scoped to model folders + `mock.json`）
- `dialog:allow-open`（model folder picker, settings 中的 model swap）

不允许包含：

- `auth_session_*` IPC 命令
- 任何允许从 disk 读取 `~/.nimi/auth/**` 的 fs scope
- refresh token / session custody read-write capability
- Desktop shared auth read-write capability

---

## 12. Evolution

- 新增 window behavior（resize constraints / magnet snap 等）→ 新 rule id with minor bump
- 改变 hit-region / drag-region algorithm → major bump
- 新增 lifecycle event → `avatar-event-contract.md` minor bump
- 新增 / 改变 composition state 或 surface 子结构 → 本 contract major bump，并同步 `avatar-event-contract.md` + `feature-matrix.yaml`
- Platform-level window 行为变更 → 必须同步 `agent-script-contract.md` ctx.app 字段

---

## 13. First-Party Runtime Boundary (K-NAV-SHELL-FIRST-PARTY-RUNTIME)

> Upstream authority：`.nimi/spec/runtime/kernel/account-session-contract.md`（`K-ACCSVC-*`）、`.nimi/spec/sdks/kernel/runtime-contract.md`（`S-RUNTIME-109` / `S-RUNTIME-110`）、`.nimi/spec/runtime/kernel/scoped-app-binding-contract.md`（explicit binding-only modes only）。

## K-NAV-SHELL-FIRST-PARTY-RUNTIME-001 默认 Avatar 禁止的能力

默认 Avatar app shell 不允许：

- 读取 Desktop shared auth session（`~/.nimi/auth/session.v1.json`）或调用 `auth_session_load` / `auth_session_save` / `auth_session_clear`
- 持有 refresh token、durable account session、raw JWT、`subject_user_id`、或 independent Realm auth truth
- 调用 Realm `passwordLogin` / `oauthLogin` / `requestEmailOtp` / `verifyEmailOtp` / `walletLogin` 作为 app-owned login path
- 调用 `MeService.getMe` 作为 account truth
- 注入 app-owned access token provider、refresh token provider、subject provider、session store、或 JWT decode hook
- 从 Desktop launch context 读取 scoped binding、package、anchor、account/user、Realm、auth material、Live2D calibration / preview / expression / render-policy truth
- 在 mock 之外回退到 fixture 模式以隐藏 account、agent、package、或 Runtime 不可用
- 在 Tauri permission set 中包含 auth / session / account 相关 capability

## K-NAV-SHELL-FIRST-PARTY-RUNTIME-002 默认 Avatar 允许的能力

默认 Avatar app shell 允许：

- 加载 Desktop 启动 intent：required `agent_id`、optional `avatar_instance_id`、optional non-authoritative `launch_source`
- 以 `nimi.avatar` / stable `app_instance_id` 注册或识别为 Runtime-admitted local first-party app
- 调用 Runtime account projection / event stream 与 admitted `InvokeRealmUnary` broker operation；Avatar 不拥有 login/logout/switch/refresh account-control UX
- default `nimi.avatar` 只能调用 independently admitted Runtime-mediated
  broker/service operations；registry 或 first-party posture 不得启用 public token RPC
- `runtime.agent` turns API 由 Runtime server-side evaluator、current account/app
  relation、capability/grant 与 scoped binding 授权；SDK/host 不安装 bearer provider
- 默认通过 SDK Runtime-mediated Realm transport 访问授权 Realm data API；不得
  直连 Realm、构造 authorization header 或自行 refresh
- 通过 Runtime / SDK 验证 `agent_id`，解析 agent/user projection 与
  authorized visual package ref / local materialization
- 创建或恢复 Avatar-owned conversation context

## K-NAV-SHELL-FIRST-PARTY-RUNTIME-003 Minimal Launch Intent

Desktop 默认启动 Avatar 只允许传递：

- `agent_id`
- optional `avatar_instance_id`
- optional `launch_source`

禁止字段：scoped binding / binding handle / binding state、conversation anchor、
visual package id / path / descriptor、runtime app id、world id、Realm URL、
access token、refresh token、raw JWT、`subject_user_id`、account id、user id、
shared auth payload、auth UX route、Live2D calibration ref/payload、model digest、
preview artifact ref、framing calibration、render scale、target FPS、performance
policy、expression inventory。

`agent_id` 是 selector，不是 authorization proof。Avatar 必须通过 Runtime /
SDK 验证。

如果 Desktop 已经拥有当前 Runtime `ConversationAnchor`，它只能通过 Runtime
`K-AGCORE-138` 注册 `avatar_instance_id -> conversation_anchor_id` 绑定。
Avatar 启动后可通过 SDK 解析该绑定恢复同一 anchor；不得把
`conversation_anchor_id`、owner/account/user truth 或 scoped binding 放入 launch
payload。

## K-NAV-SHELL-FIRST-PARTY-RUNTIME-004 Tauri Permission 排除

Avatar Tauri capability 文件不允许包含：

- `auth_session_*` IPC 命令
- 任何允许从 disk 读取 `~/.nimi/auth/**` 的 fs scope
- refresh token / session custody read-write capability
- Desktop shared auth read-write capability

guardrail 必须随本 contract 的 first-party runtime boundary 同步落地（见 `negative-test-matrix.md` 与 `guardrail-scan-plan.md`）。

## K-NAV-SHELL-FIRST-PARTY-RUNTIME-005 Agent / Visual Package / Conversation Ownership

Avatar 必须：

- 在加载 private agent data 或 selected local Avatar asset materialization 前
  验证 `agent_id`
- 仅从 Avatar local asset resolver 返回的 materialized Live2D/VRM files 读取
  visual files；远程 marketplace package 来源已退役（Asset Market 撤回），
  本地 import + materialization 是 visual 唯一来源
- 对 Live2D，Avatar local asset resolver 可以返回 host-projected
  `live2d_calibration_ref` 作为只读 opaque evidence；不得读取 calibration
  payload/values，不得将该 ref 解释为 carrier truth 或 render/framing effect
- 创建或恢复 Avatar-owned conversation context
- 通过 Runtime / SDK `K-AGCORE-138` live-instance binding 恢复 Desktop-current
  conversation anchor；缺失绑定时不得从 same-agent identity 推断同一 conversation
- 支持同一 `agent_id` 的多个 `avatar_instance_id` 并存

Desktop 不得预解析或透传 agent authorization、remote package truth、或
conversation anchor truth。

## K-NAV-SHELL-FIRST-PARTY-RUNTIME-006 Binding-Only Mode Exclusion

Explicit binding-only / embedded / delegated Avatar mode 可以由 `K-BIND-*` admit，
但它不是默认 Desktop launch path。

Every Avatar mode, including default first-party and binding-only, MUST be
rejected by the public `GetAccessToken` tombstone with
`ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED`; a separately admitted binding-scoped
broker operation never grants account-control, refresh, or bearer authority.

默认 Avatar 不得把 scoped binding 当作启动阶段或 turns API 的 authorization
替代物；`runtime.agent` turns API 必须由 Runtime server-side evaluator
authorize and execute。Scoped binding 只属于 explicit binding-only / embedded /
delegated Avatar mode，且作为 carrier-relation attachment，不替代 token。

---
**Industrial baseline.** Embodied Output Interaction、Transient Overlays、Degraded Surface、Composition State 属于本 contract 的完整权威；实现不得偏离本 contract 已声明的规则，新增表面 / 新增 composition state 必须先以 minor / major bump 方式更新本 contract。
