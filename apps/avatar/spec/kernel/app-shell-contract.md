# App Shell Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: App-local kernel contract
> **Status**: Wave 0 industrial baseline (supersedes earlier "Phase 1 / Phase 2 deferred" framing)
> **Sibling contracts**:
> - [Embodiment projection contract](embodiment-projection-contract.md)
> - [Live2D render contract](live2d-render-contract.md)
> - [Agent script contract](agent-script-contract.md)
> - [Avatar event contract](avatar-event-contract.md)
>
> **Hard Cut Status (topic `2026-04-29-avatar-first-party-app-launch-hardcut` wave-1)**：
> 本 contract 约束默认 Nimi Avatar app。Avatar 是 Runtime-admitted local first-party Nimi app（default app id `nimi.avatar`），Desktop 启动时只传递 `agent_id`、optional `avatar_instance_id`、optional non-authoritative `launch_source`。Avatar 可以像其他 local first-party app 一样使用 Runtime account projection 与 Runtime-issued short-lived access token 访问授权数据；它不得持有 refresh token、durable auth session、shared auth truth、independent Realm auth truth、或 app-local JWT subject truth。Desktop 不得把 scoped binding、visual package truth、conversation anchor truth、account/user truth、Realm/auth material 透传给默认 Avatar 启动路径。
>
> Explicit binding-only / embedded / delegated Avatar mode 仍可由 `K-BIND-*` admit，但它不是 Desktop-launched Avatar 的默认路径。
>
> **Wave 0 Surface Composition admit**：本 contract 重写 surface composition 模型为 `embodiment-stage` / `companion-surface` / `degraded-surface` 三互斥结构（NAV-SHELL-COMPOSITION-*）。原 "Phase 2 deferred small chat button" 路径正式废弃，由 always-visible Companion Surface（NAV-SHELL-COMPANION-*）取代；degraded posture 由独立 Degraded Surface（NAV-SHELL-DEGRADED-*）承载，不再混入 ready 主区。

---

## 0. 阅读指南

本 contract 定义 Nimi Avatar 桌面 shell 的 window、交互、surface composition 与 lifecycle 行为。Avatar 不是常规软件窗口，而是**桌面悬浮 embodiment surface**：形象即 UI，透明背景，无 chrome，always-on-top。本 contract 专注 Tauri shell surface 的规则；shell 依赖 embodiment projection layer 提供 surface bounds / hit region，而不是直接拥有 backend truth。

Wave 顺序见 `nimi-avatar.md` 与 `kernel/tables/feature-matrix.yaml`。本 contract 在 Wave 0 admit 之后即作为完整契约对所有 wave 生效；后续 wave 实现的 surface 行为不得偏离本 contract 已声明的规则。

---

## 1. Window Configuration

### 1.1 Tauri Window Config (NAV-SHELL-001)

Window 必须以如下 config 启动（不可 runtime 改变）：

| Property | Value | Reason |
|---|---|---|
| `transparent` | `true` | 背景透明，形象即 UI |
| `decorations` | `false` | 无 title bar / close / min buttons |
| `alwaysOnTop` | `true` (default) | Pet 始终可见；用户 setting 可覆盖 |
| `resizable` | `true` (programmatic only) | Runtime 按 model bounds + companion footprint 调整 |
| `skipTaskbar` | `true` | 不在 taskbar 显示（dock 上有 tray icon） |
| `shadow` | `false` | 无 window shadow（形象自身有阴影） |
| `width` / `height` | Initial 400 × 600 | 启动占位，model 加载完按 bounds 调整 |

### 1.2 Dynamic Window Size (NAV-SHELL-002)

Window 尺寸**必须**跟随当前 embodiment backend 产出的 surface bounds **加** companion-surface footprint：

- Model 加载完成（`avatar.model.load`）→ renderer 计算 `embodiment_bounds`（model alpha bounding box）+ `companion_footprint`（companion-surface 当前 height/width）→ 调用 Tauri `set_size` 同步 window
- Model 切换（`avatar.model.switch`）→ 同上
- Companion-surface footprint 变化（assistant-bubble 展开 / 收起、composer 多行输入展开）→ debounce 重算 + `set_size`
- User 手动 resize 不允许（通过 `resizable: false` 在 runtime 效果上禁止 drag-handle；程序化 set_size 仍然可用）

详细 sizing policy 见 `kernel/tables/window-bounds-policy.yaml`（Wave 4 admit）。

### 1.3 Initial Position (NAV-SHELL-003)

- 首次启动：屏幕右下角 padding 24px
- 后续启动：记忆上次关闭时位置（persisted via `tauri-plugin-window-state` 或等价机制）
- Multi-monitor：恢复到上次 monitor；若 monitor 不可用，fallback 到 primary monitor

---

## 2. Hit Region & Click-through (NAV-SHELL-004)

### 2.1 Hit Region 定义

Avatar window 形状为矩形，但用户视觉只看到 embodiment surface + companion surface。**两者外区域必须穿透鼠标事件到下层 app**。

### 2.2 Hit Region 计算

每帧（或 active surface bounds / alpha mask 变化时）计算 hit region：

```
hit_region = union of:
  - embodiment-stage 当前 backend surface alpha > threshold (current Live2D branch uses model alpha)
  - companion-surface 矩形（含 assistant-bubble、status-row、composer 当前 bounding box）
  - degraded-surface 矩形（degraded 状态下替代 embodiment + companion）
```

渲染器把 hit region 以 mask 形式通过 Tauri API（`set_ignore_cursor_events` + per-region 切换，或 `window.setShape`）应用到 window。

### 2.3 Click-through 边界规则

- **In-region**（surface 像素 / companion-surface / degraded-surface）：鼠标事件属于 avatar
- **Out-of-region**（透明区域）：`set_ignore_cursor_events(true)` 状态，事件穿透到下层 app
- **State transition**：mouse move 跨越 region 边界 → immediate switch；不做 hysteresis

### 2.4 Drag Region 限定 (NAV-SHELL-004-DRAG)

Window drag（§3）仅在 embodiment-stage 内部触发：

- Drag-allowed = embodiment alpha > threshold AND not within companion-surface bounds
- Companion-surface 内部 pointer down 不开启 window drag（保留组件自身交互如 input focus / button click）
- Degraded-surface 内部 pointer down 同样不开启 window drag

---

## 3. Window Drag (NAV-SHELL-005)

### 3.1 Drag 触发

用户在 drag-allowed region 内按下左键拖动 → 整个 window 移动：

```
Pointer down inside drag-allowed region (§2.4)
  ↓
Hold + move N pixels within drag_threshold_ms
  ↓ yes → window drag mode
  │
  └── pointer up without threshold → click/double-click event
```

- `drag_threshold`: 4px (避免误触)
- `drag_threshold_ms`: 200ms

### 3.2 Drag 实现

通过 Tauri command `nimi_avatar_start_window_drag` 调用系统 window drag API。拖动期间：

- Emit `avatar.user.drag.start` at drag begin
- Emit `avatar.user.drag.move` at 30 Hz during drag
- Emit `avatar.user.drag.end` at drag end
- Runtime 接收 events 可做 physics feedback（NAS continuous handler）

### 3.3 Drag Edge Constraints

- 不限制到 screen 内（允许拖到屏幕边缘部分可见，便于 peek）
- 最小可见 padding：embodiment_bounds 的 20% 必须留在屏幕内
- 多 monitor：允许拖到其他 monitor，移动时 window state 同步 monitor 变更

---

## 4. Always-on-Top & Focus (NAV-SHELL-006)

### 4.1 Default 状态

- Always-on-top **启用**（default）
- 即使 avatar window 无 focus，依然 render 于顶层

### 4.2 User Override (NAV-SHELL-006-SETTINGS)

Avatar shell 仅暴露下列 4 个 avatar-shell-local 行为开关，默认通过 settings popover（NAV-SHELL-COMPANION-009）调整：

- `always_on_top: true|false`（default `true`）
- `bubble_auto_open: true|false`（default `true`；关闭后只保留 unread cue，不强开 bubble）
- `bubble_auto_collapse: true|false`（default `true`）
- `show_voice_captions: true|false`（default `true`；只影响 bounded foreground caption reveal，不影响 voice continuity truth）

Settings UI 必须保持 product-light：

- 不得暴露 transcript-heavy、desktop-parity、background voice、或 runtime owner-crossing setting
- 不得把 settings 当作 launch/runtime fail-closed posture 的 bypass
- 不得 inline 在主区（embodiment-stage 或 companion-surface），必须以 popover 形式弹出，遵从 NAV-SHELL-COMPANION-009

### 4.3 Focus Event

- Avatar 获得系统 focus → emit `avatar.app.focus.change` with `{ focused: true }`
- 失去 focus → emit with `{ focused: false }`
- 不把 always-on-top 等同于 focus（两者独立）

---

## 5. Visibility (NAV-SHELL-007)

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

## 6. Surface Composition (NAV-SHELL-COMPOSITION-*)

### 6.1 Composition States (NAV-SHELL-COMPOSITION-001)

Avatar shell 的渲染由 **composition state** 决定。任何时刻 shell 处于且仅处于以下一个 composition state：

| Composition state | 触发条件 | 渲染 surface |
|---|---|---|
| `ready` | bootstrap 完成 + visual carrier ready + runtime binding active | `embodiment-stage` + `companion-surface` 双层共存 |
| `loading` | bootstrap 进行中（pre-`avatar.app.ready`） | 仅 `loading-surface`（degraded-surface 子形态） |
| `degraded:reauth-required` | runtime account state ≠ AUTHENTICATED | 仅 `degraded-surface`（reauth posture） |
| `degraded:runtime-unavailable` | daemon 不可用 / protected access 不可用 / driver_start 失败 | 仅 `degraded-surface`（runtime posture） |
| `degraded:launch-context-invalid` | 缺失或非法 launch intent（无 `agent_id`） | 仅 `degraded-surface`（launch posture） |
| `error:bootstrap-fatal` | bootstrap 抛错且不属于上述 typed degraded reason | 仅 `degraded-surface`（fatal posture） |
| `relaunch-pending` | desktop 推送了 launch context update，等待 shell reload | 仅 `degraded-surface`（relaunch notice） |

### 6.2 互斥规则 (NAV-SHELL-COMPOSITION-002)

- 三类 surface（embodiment-stage / companion-surface / degraded-surface）必须**硬性互斥呈现**于 ready 与非 ready 之间：
  - `ready` → embodiment-stage + companion-surface 同时可见；degraded-surface 不渲染
  - 任何 non-ready composition state → 仅 degraded-surface 可见；embodiment-stage 与 companion-surface 完全不渲染
- 不允许出现"degraded panel + embodiment 一起渲染"的 mid-state；若 ready 转入 degraded，必须先卸载 ready surface 再挂载 degraded surface
- 不允许在 ready 主区域显示 diagnostic 文字、reason summary、或 recovery copy；这些信息只能出现在 degraded-surface
- 不允许在 degraded-surface 内嵌入 companion-surface 或 embodiment-stage 子组件（保持视觉权威单一）

### 6.3 状态转移 (NAV-SHELL-COMPOSITION-003)

- `loading` → `ready`：bootstrap 完成 + visual ready
- `loading` → `degraded:*`：bootstrap 失败，按 typed reason 进入对应 degraded sub-state
- `ready` → `degraded:*`：runtime/account/binding 在运行期失效（典型如 access token expire 后 refresh 失败、binding revoked、carrier disconnect 不可恢复）
- `ready` → `relaunch-pending`：desktop 推送 `nimi-avatar://launch?...` 更新到现有 instance；shell 必须卸载 ready surface、显示 relaunch notice 并主动 reload
- 任何 degraded → `loading`：仅由用户显式触发的 reload 路径开启；shell 不允许自动从 degraded 自愈到 ready

### 6.4 Composition Evidence (NAV-SHELL-COMPOSITION-004)

每次 composition state 转移必须写入 evidence（`avatar-carrier-evidence` projection）：

- `avatar.composition.transition`：detail 包含 `from`、`to`、`reason_code`、`account_reason_code`、`stage`、`recorded_at`
- 转入 `degraded:*` 与 `error:*` 时同步 emit `avatar.runtime.bind-failed` 或 `avatar.startup.failed`（按既有 evidence schema）
- `relaunch-pending` 转移必须 emit `avatar.composition.relaunch-pending`，含 `next_launch_context` summary

### 6.5 Fail-Close 与 Mock 路径 (NAV-SHELL-COMPOSITION-005)

- 任何非 explicit fixture mode（`VITE_AVATAR_DRIVER=mock`）下，runtime 不可用时禁止 silent fallback 到 mock
- explicit fixture mode 下，shell 进入特殊 composition state `fixture:active`，渲染 embodiment-stage + companion-surface（仅消费 fixture data，不连 runtime）+ persistent banner 标识 fixture 来源
- 任何 composition state 不允许向用户隐瞒来源（runtime 与 fixture 必须可读区分）

---

## 7. Companion Surface (NAV-SHELL-COMPANION-*)

Companion Surface 是 avatar shell 的一等表面，在 `ready` 与 `fixture:active` 状态下与 embodiment-stage 共存。它是 always-visible，不再依赖外部 trigger button。

### 7.1 三层结构 (NAV-SHELL-COMPANION-001)

Companion Surface 由三层垂直堆叠组成（自顶向下）：

| 子组件 | 责任 | 可隐藏？ |
|---|---|---|
| `assistant-bubble` | 显示当前 anchor 的最新 assistant message + close × button | ✅ user 关闭 / 无消息时不渲染 |
| `status-row` | 显示 mic toggle、mode label（idle/listening/transcribing/replying/interrupted）、speaker indicator、settings cog | ❌ 始终可见 |
| `composer` | text input + send button；Enter 提交一个 bounded text turn | ❌ 始终可见 |

### 7.2 定位与窗口约束 (NAV-SHELL-COMPANION-002)

- Companion Surface 默认锚定 embodiment-stage 右下角，offset (-16px, -16px)，可由 settings 配置改为 left-bottom / right-bottom（默认）
- Companion footprint 计入 §1.2 dynamic window sizing；window 必须容纳 embodiment_bounds 和 companion_footprint 之和加边距
- Companion Surface 矩形必须接受 pointer 事件并阻止 window drag（§2.4）

### 7.3 Anchor 绑定 (NAV-SHELL-COMPANION-003)

Companion Surface 显式绑定当前 launch-selected `agent_id + conversation_anchor_id`：

- 不得跨 anchor 显示消息（同 agent 其他 anchor 的 message 不出现在 bubble）
- composer 提交的 text turn 必须显式打到当前 anchor；不得做 same-agent fallback
- voice 入口（status-row mic）打开的 listening session 必须绑定当前 anchor
- desktop 推送 launch context update（不同 anchor）必须先转入 `relaunch-pending`，清空 companion 本地 transient state，再重新挂载

### 7.4 Assistant Bubble (NAV-SHELL-COMPANION-004)

- 文本来源：runtime turn 的 `text` / `committed_message`（projection-only），不构造 client-side history
- 显示策略：
  - `bubble_auto_open=true` + 新消息 → 自动展开
  - `bubble_auto_collapse=true` + idle 一段后 → 自动收起为 unread cue
  - User 主动 close → 收起，本次消息不重复 auto-open
- Bubble 内不展示 transcript 历史；只展示当前最新一条 assistant cue + 当前 active turn 的 text/streaming preview
- 文本溢出：max-height + scroll；不展开成 full transcript view
- 关闭按钮：右上角 × ；点击触发 `avatar.companion.bubble.dismissed` event

### 7.5 Status Row (NAV-SHELL-COMPANION-005)

Status row 必须可读地表达当前模式，且每个图标代表的行为完整接通：

| 元素 | 状态 → 视觉 | 点击行为 |
|---|---|---|
| Mic icon | `idle` (off) / `listening` (active filled + level ring) / `transcribing` (spinner) / `pending` (paused) / `replying` (locked) / `error` (alert) | `idle` 点击进入 listening；`listening` 点击 commit；`replying` 点击 interrupt；其他状态按需 |
| Mode label | `idle` / `Listening…` / `Transcribing…` / `Reply pending` / `Reply active` / `Interrupted` / `Voice unavailable` | non-clickable |
| Speaker indicator | `inactive` (灰) / `playing` (active highlight) / `muted` (按 settings) | non-clickable（playback 无 user-toggle，由 runtime 决定） |
| Settings cog | always visible | 点击展开 settings popover（NAV-SHELL-COMPANION-009） |

Voice 行为约束：

- voice 入口只能由 user click 触发；不得因为 route readiness、mic availability、prior voice activity 自动进入 listening
- voice listening session 必须显式绑定当前 anchor
- 不允许 wake-word、background continuation、lock-screen continuation
- voice interruption 仅作用于当前 anchor 的 active turn；不得作用于 same-agent 其他 anchor
- 在 admitted active-turn evidence 出现前，shell 只能表达 transcript submitted / reply pending；不得本地伪装 speaking、playback active、interrupt opened
- voice 不可用（runtime 不发 lipsync_frame_batch / capability 不允许）→ status 进入 `Voice unavailable`，mic icon disabled，不模拟听到声音

### 7.6 Composer (NAV-SHELL-COMPANION-006)

- 单行 text input，placeholder 来自 i18n key `Avatar.composer.placeholder`
- Enter 提交（Shift+Enter 换行展开多行）
- 提交期间 input + send button 进入 sending 状态：disabled + 显示 inline progress；不允许 user 重复触发
- 提交内容必须经过 anchor 绑定（§7.3）；提交前不允许任何 anchor switch
- 提交失败 → emit `avatar.companion.composer.send-failed` evidence + status-row 切到 transient error label；不允许静默吞掉

### 7.7 Caption Reveal (NAV-SHELL-COMPANION-007)

- 当 `show_voice_captions=true` 且 voice listening / replying 时，可以在 status-row 下方临时浮出 caption（user transcript cue + assistant live caption）
- Caption 文本必须直接来自 runtime turn `text_delta` / committed projection，不允许本地伪造
- Caption 不展开成 transcript view；user 离开 voice 模式后立即清空

### 7.8 Cross-app Coordination (NAV-SHELL-COMPANION-008)

- Companion Surface 不向 desktop 推送 transcript 副本；transcript truth owner 是 runtime
- Companion Surface 可以接收 desktop 的 `avatar_instance_registry` projection 用于"当前 instance 是否依然 admitted"的健康指示，但不允许据此自行决定 ready/degraded 转移（composition state 仍由 runtime carrier 决定）

### 7.9 Settings Popover (NAV-SHELL-COMPANION-009)

- 从 status-row 的 settings cog 触发，弹出在 status-row 上方
- 仅暴露 §4.2 列出的 4 个 toggle
- Popover 不能 inline 占据 stage 主区或 push 内容布局；必须是 floating layer
- Popover 关闭：点击外部 / Esc / cog 再次点击

### 7.10 Companion Lifecycle Events (NAV-SHELL-COMPANION-010)

下列 evidence 必须由 companion-surface 在对应交互发生时 emit：

- `avatar.companion.bubble.opened` / `dismissed`
- `avatar.companion.composer.submitted` / `send-failed`
- `avatar.companion.voice.listen-start` / `listen-commit` / `transcribe-start` / `interrupt`
- `avatar.companion.settings.changed`（detail 含 changed key 与 new value）

精确 schema 见 [avatar-event-contract.md](avatar-event-contract.md)。

---

## 8. Degraded Surface (NAV-SHELL-DEGRADED-*)

### 8.1 Surface 形态 (NAV-SHELL-DEGRADED-001)

Degraded Surface 是 ready 之外所有 composition state 的唯一渲染表面。Surface 内部结构：

| 区域 | 内容 |
|---|---|
| Banner | composition state 类型与 reason badge（如 `Runtime unavailable` / `Reauth required` / `Launch context invalid`） |
| Title | i18n 化的简短描述（`Avatar.degraded.<state>.title`） |
| Summary | i18n 化的多行描述，包含 reason code / action hint（如可读化） |
| Recovery affordance | 一个显式 `reload shell` button（仅触发 app reload / relaunch）；degraded 期不允许其他 affordance |

### 8.2 Reason 透传 (NAV-SHELL-DEGRADED-002)

- Bootstrap 抛错时透传到 degraded-surface 的字段：`stage`、`reason_code`、`account_reason_code`、`action_hint`、`source`、`retryable`
- Surface 必须显式呈现 i18n 化的 stage 与 reason_code（不是裸字符串）
- 不允许显示 stack trace 或 raw error message 作为主区文案；仅 `Avatar.degraded.diagnostics` 子区域以 collapsible 形式可选呈现

### 8.3 No Mock Fallback (NAV-SHELL-DEGRADED-003)

- Degraded surface 期间禁止任何 mock fallback 路径
- 不允许把"上一次成功的 visual carrier"留作 degraded 期间的部分 ready；进入 degraded 立即卸载 carrier

### 8.4 Reload 行为 (NAV-SHELL-DEGRADED-004)

- `reload shell` 行为：调用 shell-reload 流程，清空 avatar-local transient state（draft、bubble echo、foreground voice capture/caption）后重新进入 `loading`
- Reload 不允许触发 silent retry / 自动重连；必须由 user 显式启动
- Relaunch-pending 状态下的 reload 与 launch context update 联动：reload 完成后 desktop-pushed 新 context 接管启动

### 8.5 Degraded Lifecycle Evidence (NAV-SHELL-DEGRADED-005)

- 进入 degraded 状态：emit `avatar.composition.transition` (NAV-SHELL-COMPOSITION-004) + 对应的 startup/bind-failed evidence
- User 触发 reload：emit `avatar.shell.reload-requested`，detail 含 `from_state`
- Reload 完成后回到 `loading` 时 emit `avatar.shell.reload-resumed`

---

## 9. App Lifecycle Events (NAV-SHELL-009)

### 9.1 Start → Ready 序列

```
1. Tauri window created
2. Renderer bootstrap (React mount)
3. Emit avatar.app.start (composition state = loading)
4. Register / identify as Runtime-admitted local first-party app (`nimi.avatar`)
5. Validate launch `agent_id` and resolve authorized visual package descriptor
   through Runtime / SDK authority (Live2D / VRM branch)
6. Prepare SDK Runtime-backed protected access provider (typed admitted)
7. Load local visual files from the authorized descriptor
8. Create or recover Avatar-owned conversation context
9. Scan <model>/runtime/nimi/ for NAS handlers (§agent-script-contract)
10. Compute initial hit region + resize window to surface bounds + companion footprint
11. Mount embodiment-stage + companion-surface (composition state → ready)
12. Emit avatar.app.ready
```

任一 step 失败必须按 §6 状态机进入对应 degraded composition state，且不允许 partial mount（embodiment 加载完但 companion 不可见，或 companion 可见但 embodiment 还在 loading 状态）。

### 9.2 Runtime First-Party Bootstrap

Supersedes the earlier Desktop scoped-binding-only launch rule. Avatar is a
local first-party app and uses Runtime account projection / SDK Runtime-backed
short-lived access-token provider when it needs authorized private data.

Normal path boundary:

- launch bootstrap：Desktop launch intent only (`agent_id`, optional
  `avatar_instance_id`, optional `launch_source`)
- runtime bootstrap：Runtime local first-party app registration / account
  projection / SDK Runtime-backed token provider
- protected access bootstrap：Avatar 通过 SDK local first-party
  Runtime-backed token provider 为 `runtime.agent` turns API 获取
  request-time capability token；默认路径不 issue scoped binding
- visual bootstrap：Runtime / SDK-authorized Agent Center package descriptor →
  local Live2D/VRM render
- data bootstrap：Runtime / SDK validates `agent_id` for the current Runtime
  account projection before private agent/user data or package descriptors load
- conversation bootstrap：Avatar creates or recovers an Avatar-owned context

Login / account handling:

- Avatar may invoke the Runtime-brokered local first-party login adapter when
  account state requires user action.
- Avatar must not run independent Realm login or own browser callback custody.
- Avatar must not receive refresh tokens, durable session material, raw JWT, or
  app-local subject truth.
- Avatar may receive short-lived access tokens only through Runtime-backed SDK
  providers and only for request-time Realm data access.

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
4. Cancel companion voice/composer in-flight operations
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
| Companion surface 三层结构与 lifecycle | ✅ | — |
| Degraded surface 与 reload 行为 | ✅ | — |
| Embodiment projection truth | shell consumes only | `embodiment-projection-contract.md` |
| Live2D rendering pipeline | current backend branch | `live2d-render-contract.md` |
| NAS handler execution | — | `agent-script-contract.md` |
| `avatar.user.*` / `avatar.app.*` / `avatar.companion.*` event schema | App shell emits | `avatar-event-contract.md` defines schema |
| Mock driver vs real SDK binding | — | `mock-fixture-contract.md` |
| Lipsync timing / voice playback truth | — | `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` |

---

## 11. Tauri Permission Requirements

Minimum permission set for industrial baseline shell：

- `core:window:allow-set-size`
- `core:window:allow-set-position`
- `core:window:allow-set-always-on-top`
- `core:window:allow-set-ignore-cursor-events`
- `core:window:allow-start-dragging`
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

## 13. First-Party Runtime Boundary (NAV-SHELL-FIRST-PARTY-RUNTIME)

> 本节由 topic `2026-04-29-avatar-first-party-app-launch-hardcut` wave-1 admit。
> Upstream authority：`.nimi/spec/runtime/kernel/account-session-contract.md`（`K-ACCSVC-*`）、`.nimi/spec/sdk/kernel/runtime-contract.md`（`S-RUNTIME-109` / `S-RUNTIME-110`）、`.nimi/spec/runtime/kernel/scoped-app-binding-contract.md`（explicit binding-only modes only）。

### 13.1 默认 Avatar 禁止的能力 (NAV-SHELL-FIRST-PARTY-RUNTIME-001)

默认 Avatar app shell 不允许：

- 读取 Desktop shared auth session（`~/.nimi/auth/session.v1.json`）或调用 `auth_session_load` / `auth_session_save` / `auth_session_clear`
- 持有 refresh token、durable account session、raw JWT、`subject_user_id`、或 independent Realm auth truth
- 调用 Realm `passwordLogin` / `oauthLogin` / `requestEmailOtp` / `verifyEmailOtp` / `walletLogin` 作为 app-owned login path
- 调用 `MeService.getMe` 作为 account truth
- 注入 app-owned access token provider、refresh token provider、subject provider、session store、或 JWT decode hook
- 从 Desktop launch context 读取 scoped binding、package、anchor、account/user、Realm、auth material
- 在 mock 之外回退到 fixture 模式以隐藏 account、agent、package、或 Runtime 不可用
- 在 Tauri permission set 中包含 auth / session / account 相关 capability

### 13.2 默认 Avatar 允许的能力 (NAV-SHELL-FIRST-PARTY-RUNTIME-002)

默认 Avatar app shell 允许：

- 加载 Desktop 启动 intent：required `agent_id`、optional `avatar_instance_id`、optional non-authoritative `launch_source`
- 以 `nimi.avatar` / stable `app_instance_id` 注册或识别为 Runtime-admitted local first-party app
- 调用 Runtime account projection / event stream / login adapter / `GetAccessToken` 等 local first-party account 方法，受 `K-ACCSVC-*` 与 app registry admission 约束
- 通过 SDK local-first-party Runtime-backed token provider 为 `runtime.agent` turns API 请求获取 protected access token
- 通过 SDK local-first-party Runtime-backed token provider 访问授权 Realm data API
- 通过 Runtime / SDK 验证 `agent_id`，解析 agent/user projection 与 visual package descriptor
- 创建或恢复 Avatar-owned conversation context

### 13.3 Minimal Launch Intent (NAV-SHELL-FIRST-PARTY-RUNTIME-003)

Desktop 默认启动 Avatar 只允许传递：

- `agent_id`
- optional `avatar_instance_id`
- optional `launch_source`

禁止字段：scoped binding / binding handle / binding state、conversation anchor、
visual package id / path / descriptor、runtime app id、world id、Realm URL、
access token、refresh token、raw JWT、`subject_user_id`、account id、user id、
shared auth payload、auth UX route。

`agent_id` 是 selector，不是 authorization proof。Avatar 必须通过 Runtime /
SDK 验证。

### 13.4 Tauri Permission 排除 (NAV-SHELL-FIRST-PARTY-RUNTIME-004)

Avatar Tauri capability 文件不允许包含：

- `auth_session_*` IPC 命令
- 任何允许从 disk 读取 `~/.nimi/auth/**` 的 fs scope
- refresh token / session custody read-write capability
- Desktop shared auth read-write capability

guardrail 必须在合规 wave 落地（见 `negative-test-matrix.md` 与 `guardrail-scan-plan.md`）。

### 13.5 Agent / Visual Package / Conversation Ownership (NAV-SHELL-FIRST-PARTY-RUNTIME-005)

Avatar 必须：

- 在加载 private agent data 或 visual package descriptor 前验证 `agent_id`
- 仅从 Runtime / SDK-authorized descriptor 读取 local visual package files
- 创建或恢复 Avatar-owned conversation context
- 支持同一 `agent_id` 的多个 `avatar_instance_id` 并存

Desktop 不得预解析或透传 agent authorization、visual package truth、或
conversation anchor truth。

### 13.6 Binding-Only Mode Exclusion (NAV-SHELL-FIRST-PARTY-RUNTIME-006)

Explicit binding-only / embedded / delegated Avatar mode 可以由 `K-BIND-*` admit，
但它不是默认 Desktop launch path。

默认 Avatar 不得把 scoped binding 当作启动阶段或 turns API 的 authorization
替代物；`runtime.agent` turns API 必须依赖 Runtime-issued protected access
capability token。Scoped binding 只属于 explicit binding-only / embedded /
delegated Avatar mode，且作为 carrier-relation attachment，不替代 token。

---

**Industrial baseline.** Companion Surface、Degraded Surface、Composition State 三个机制在 Wave 0 admit 之后即作为完整契约对所有 wave 生效；后续 wave 的实现工作不得偏离本 contract 已声明的规则，新增表面 / 新增 composition state 必须先以 minor / major bump 方式更新本 contract。
