# App Shell Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: App-local kernel contract
> **Status**: Phase 1 baseline draft
> **Sibling contracts**:
> - [Embodiment projection contract](embodiment-projection-contract.md)
> - [Live2D render contract](live2d-render-contract.md)
> - [Agent script contract](agent-script-contract.md)
> - [Avatar event contract](avatar-event-contract.md)
>
> **Hard Cut Status (topic `2026-04-28-runtime-core-account-session-broker-hardcut` wave-1)**：
> 本 contract 约束 **Desktop-launched Avatar embodiment instance**。该 instance 不参与 login、不持有 account session truth、不持有 Realm client、不请求 Runtime account access token、不调用 `MeService.getMe`、不直接调用 `RuntimeAuthService.RegisterApp` / `OpenSession`、不创建或持有 conversation anchor。runtime interaction 通过 Desktop/Runtime 发出的 scoped binding（`K-BIND-*`，见 `.nimi/spec/runtime/kernel/scoped-app-binding-contract.md`）消费。runtime binding 不可用只关闭 interaction/voice/activity，不得隐藏已加载的 local visual carrier。Tauri permission 必须排除 auth/session capability（详见下文 `NAV-SHELL-RUNTIME-BINDING`）。
>
> Future Avatar-as-primary-app 是单独 mode，若后续 admit，必须按 Runtime-brokered local first-party app 使用 `RuntimeAccountService`，不得拥有 refresh token、durable auth session、shared auth truth、或 independent Realm auth truth。

---

## 0. 阅读指南

本 contract 定义 Nimi Avatar 桌面 shell 的 window、交互、lifecycle 行为。Avatar 不是常规软件窗口，而是**桌面悬浮 embodiment surface**：形象即 UI，透明背景，无 chrome，always-on-top。本 contract 专注 Tauri shell surface 的规则；shell 依赖 embodiment projection layer 提供 surface bounds / hit region，而不是直接拥有 backend truth。

---

## 1. Window Configuration

### 1.1 Tauri Window Config (NAV-SHELL-001)

Window 必须以如下 config 启动（不可 runtime 改变）：

| Property | Value | Reason |
|---|---|---|
| `transparent` | `true` | 背景透明，形象即 UI |
| `decorations` | `false` | 无 title bar / close / min buttons |
| `alwaysOnTop` | `true` (default) | Pet 始终可见；用户 setting 可覆盖 |
| `resizable` | `true` (programmatic only) | Runtime 按 model bounds 调整 |
| `skipTaskbar` | `true` | 不在 taskbar 显示（dock 上有 tray icon） |
| `shadow` | `false` | 无 window shadow（形象自身有阴影） |
| `width` / `height` | Initial 400 × 600 | 启动占位，model 加载完按 bounds 调整 |

### 1.2 Dynamic Window Size (NAV-SHELL-002)

Window 尺寸**必须**跟随当前 embodiment backend 产出的 surface bounds：

- Model 加载完成（`avatar.model.load`）→ renderer 计算 surface bounds → 调用 Tauri `set_size` 同步 window
- Model 切换（`avatar.model.switch`）→ 同上
- User 手动 resize 不允许（通过 `resizable: false` 在 runtime 效果上禁止 drag-handle；程序化 set_size 仍然可用）

### 1.3 Initial Position (NAV-SHELL-003)

- 首次启动：屏幕右下角 padding 24px
- 后续启动：记忆上次关闭时位置（persisted via `tauri-plugin-window-state` 或等价机制）
- Multi-monitor：恢复到上次 monitor；若 monitor 不可用，fallback 到 primary monitor

---

## 2. Hit Region & Click-through (NAV-SHELL-004)

### 2.1 Hit Region 定义

Avatar window 形状为矩形，但用户视觉只看到 embodiment surface 本身。**形象外区域必须穿透鼠标事件到下层 app**。

### 2.2 Hit Region 计算

每帧（或 active surface bounds / alpha mask 变化时）计算 hit region：

```
hit_region = union of:
  - 当前 backend surface alpha > threshold (current Live2D branch uses model alpha)
  - UI overlays (small button, chat bubble in Phase 2)
```

渲染器把 hit region 以 mask 形式通过 Tauri API（`set_ignore_cursor_events` + per-region 切换，或 `window.setShape`）应用到 window。

### 2.3 Click-through 边界规则

- **In-region**（backend surface 像素 / UI overlay）：鼠标事件属于 avatar，触发 `avatar.user.*` events
- **Out-of-region**（透明区域）：`set_ignore_cursor_events(true)` 状态，事件穿透到下层 app
- **State transition**：mouse move 跨越 region 边界 → immediate switch；不做 hysteresis

---

## 3. Window Drag (NAV-SHELL-005)

### 3.1 Drag 触发

用户在 hit region 内按下左键拖动 → 整个 window 移动：

```
Pointer down inside hit region
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
- 最小可见 padding：model bounds 的 20% 必须留在屏幕内
- 多 monitor：允许拖到其他 monitor，移动时 window state 同步 monitor 变更

---

## 4. Always-on-Top & Focus (NAV-SHELL-006)

### 4.1 Default 状态

- Always-on-top **启用**（default）
- 即使 avatar window 无 focus，依然 render 于顶层

### 4.2 User Override

Wave 4 shipped settings 只允许 avatar-shell 自有行为：

- `always_on_top: true|false`（default `true`）
- `bubble_auto_open: true|false`（default `true`；关闭后只保留 unread cue，不强开 bubble）
- `bubble_auto_collapse: true|false`（default `true`）
- `show_voice_captions: true|false`（default `true`；只影响 bounded foreground caption reveal，不影响 voice continuity truth）

Settings UI 必须保持 product-light：

- 不得暴露 transcript-heavy、desktop-parity、background voice、或 runtime owner-crossing setting
- 不得把 settings 当作 launch/runtime fail-closed posture 的 bypass

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

## 6. Small Chat Button (Phase 2, placeholder in Phase 1)

### 6.1 Phase 1 行为 (NAV-SHELL-008)

- Button 不渲染；但 hit region 包含其未来位置（避免 click-through 误算）
- 实现占位：`<ChatTriggerButton disabled />` 不可见但占 hit region

### 6.2 Phase 2 完整行为

- Button 位于 model bounds 右下角外侧（offset: x=+16, y=-16）
- Click → open chat input floating box + chat bubble area
- 默认隐藏 bubble；有新消息时显示
- bubble 只承载**当前 launch-selected `agent_id + conversation_anchor_id`** 下的 latest-message cue；不得扩写成 full transcript panel
- floating input 只允许向当前显式 anchor 提交一个 bounded text turn；不得因为 same-agent convenience 推断或切换 anchor
- app-local bubble state 只可保留 latest assistant cue + bounded user echo 作为 presentation cache；不得提升为 canonical transcript truth
- launch/runtime binding 不可用时，button / bubble / input 必须一起 fail closed；不得留下 fake-send surface

### 6.3 Hotkey (Phase 2)

- `Alt+Space`（可自定义）触发 chat，与 button click 等价

### 6.4 Foreground Voice Companion UX (Wave 3)

- voice 入口只能由 avatar shell 内的显式用户交互触发；不得因为 route readiness、
  microphone availability、或 prior voice activity 自动进入 listening
- foreground voice UI 必须显式绑定当前 launch-selected `agent_id +
  conversation_anchor_id`
- shell 必须可读地表达 `idle` / `listening` / `transcribing` / `pending reply` /
  `reply active` / `interrupted`
- user voice capture 只允许在 foreground companion surface 内发生；不得 admit
  wake-word、background continuation、或 lock-screen continuation
- voice interruption 必须作用于当前显式 anchor continuity；不得把 same-agent 其他
  anchor 的 active turn 当作可打断目标
- 在 admitted active-turn evidence 出现前，shell 只可表达 transcript submitted /
  reply pending；不得本地假设 speaking、playback active、或开放 interrupt
- app-local voice caption 只可保留：
  - 当前一次 voice input 的 bounded user transcript cue
  - 当前一次 anchor reply 的 bounded live / committed assistant caption cue
- voice caption reveal 不得扩写成 full transcript history、inspection panel、
  或 detached transcript owner truth
- foreground voice 不可用时，voice affordance 必须 fail closed；不得留下 fake-active
  listening / reply-active UI

---

## 7. App Lifecycle Events (NAV-SHELL-009)

### 7.1 Start → Ready 序列

```
1. Tauri window created
2. Renderer bootstrap (React mount)
3. Emit avatar.app.start
4. Load Desktop-selected local Agent Center visual package through an opaque
   non-account package descriptor/capability (Live2D / VRM branch)
5. Attempt runtime IPC consume binding (default) or explicit fixture mode (`VITE_AVATAR_DRIVER=mock`)
6. Scan <model>/runtime/nimi/ for NAS handlers (§agent-script-contract)
7. Compute initial hit region + resize window to surface bounds
8. Emit avatar.app.ready
```

### 7.2 Runtime Binding Revalidation

Supersedes the earlier shared desktop auth session revalidation rule. Avatar is
not an auth/session owner and must not read shared auth, bootstrap Realm login,
call Realm HTTP, or treat Realm/user identity as local truth.

Normal path boundary:

- visual bootstrap：Desktop-selected non-account Agent Center package descriptor/capability → local Live2D/VRM render
- runtime bootstrap：runtime IPC/bridge only
- Desktop/Runtime own auth, Realm, runtime binding, agent, and anchor truth
- Avatar consumes only the explicit launch context, local visual package
  descriptor/capability, and runtime IPC projections

Runtime binding failure handling:

- missing/unavailable runtime IPC affects only interaction, voice, activity,
  and runtime-driven presentation
- the loaded visual carrier must remain visible when the local package is valid
- stale runtime bundle / binding must be discarded on bind failure or rebind
- failure must not silently downgrade to mock fixture
- failure copy must use runtime/binding product language and must not mention
  login, Realm, CORS, or shared auth

### 7.2.1 Recovery Posture (Wave 4)

当 shell 处于 missing-runtime、runtime-unbound、launch handoff update、或其他 degraded posture 时：

- renderer 可以显示 product-grade recovery copy 与显式 `reload shell` affordance
- `reload shell` 只允许触发 app reload / relaunch 流程；不得发明 app-local runtime fallback
- desktop 更新 launch context 时，shell 可以先显示短暂 relaunch/rebind notice，再显式 reload
- relaunch/rebind 前必须清空 avatar-local transient companion state（draft、bubble echo、foreground voice capture/caption 等），避免 stale state 泄漏到新 anchor / session

### 7.3 Shutdown 序列

```
1. User triggers quit (tray → exit / hotkey)
2. Emit avatar.app.shutdown
3. Cancel in-flight NAS handlers (abort signal)
4. Dispose Cubism SDK resources
5. Close Tauri window
6. Process exit
```

### 7.4 Event Payload Shapes

```yaml
avatar.app.start:
  detail:
    launched_by: enum(standalone|with_desktop|tray)
    model_path: string?

avatar.app.ready:
  detail:
    model_id: string
    nas_handler_count: int
    startup_duration_ms: int

avatar.app.focus.change:
  detail:
    focused: bool
    prev_focused_app: string?     # system info if available

avatar.app.visibility.change:
  detail:
    state: enum(on_screen|off_screen|tray_minimized)
    trigger: enum(user|system_sleep|screen_lock|other)

avatar.app.shutdown:
  detail:
    reason: enum(user_quit|os_shutdown|crash_recovery)
```

---

## 8. Boundary with Other Contracts

| Concern | This contract | Other contract |
|---|---|---|
| Window config / sizing / drag / click-through | ✅ | — |
| Embodiment projection truth | shell consumes only | `embodiment-projection-contract.md` |
| Live2D rendering pipeline | current backend branch | `live2d-render-contract.md` |
| NAS handler execution | — | `agent-script-contract.md` |
| `avatar.user.*` / `avatar.app.*` event producer | App shell emits | `avatar-event-contract.md` defines schema |
| Mock driver vs real SDK binding | — | `mock-fixture-contract.md` |

---

## 9. Tauri Permission Requirements

Minimum permission set for Phase 1 shell：

- `core:window:allow-set-size`
- `core:window:allow-set-position`
- `core:window:allow-set-always-on-top`
- `core:window:allow-set-ignore-cursor-events`
- `core:window:allow-start-dragging`
- `fs:allow-read-dir` / `fs:allow-read-text-file`（scoped to model folders + `mock.json`）
- `dialog:allow-open`（model folder picker, Phase 2 settings）

---

## 10. Evolution

- 新增 window behavior（resize constraints / magnet snap 等）→ new rule id with minor bump
- 改变 hit-region algorithm → major bump
- 新增 lifecycle event → `avatar-event-contract.md` minor bump
- Platform-level window 行为变更 → 必须同步 `agent-script-contract.md` ctx.app 字段

---

## 11. Runtime Binding Boundary (NAV-SHELL-RUNTIME-BINDING)

> 本节由 topic `2026-04-28-runtime-core-account-session-broker-hardcut` wave-1 admit。
> Upstream authority：`.nimi/spec/runtime/kernel/account-session-contract.md`（`K-ACCSVC-*`）、`.nimi/spec/runtime/kernel/scoped-app-binding-contract.md`（`K-BIND-*`）。

### 11.1 Desktop-launched Avatar 禁止的能力 (NAV-SHELL-RUNTIME-BINDING-001)

Desktop-launched Avatar embodiment app shell 不允许：

- 读取 Desktop shared auth session（`~/.nimi/auth/session.v1.json`）或调用 `auth_session_load` / `auth_session_save` / `auth_session_clear`
- 创建或持有 `Realm` HTTP 客户端
- 调用 `MeService.getMe`、`RealmAuthService.passwordLogin` / `oauthLogin` / `requestEmailOtp` / `verifyEmailOtp` / `walletLogin` 或任何 Realm 认证路径
- 调用 `RuntimeAuthService.RegisterApp`、`OpenSession`、`RegisterExternalPrincipal`、`OpenExternalPrincipalSession`
- 调用 `RuntimeAccountService` 的 account / token owner 方法（包括 `BeginLogin` / `CompleteLogin` / `GetAccessToken` / `Logout` / `SwitchAccount` / `IssueScopedAppBinding`）
- 创建或预约 conversation anchor（`open_new` 路径必须由 Desktop / Runtime 拥有，见 `K-BIND-008`）
- 持有、缓存、或转交 access token、refresh token、raw JWT、`subject_user_id`
- 在 mock 之外回退到 fixture 模式以隐藏 runtime binding 不可用
- 在 Tauri permission set 中包含 auth / session / account 相关 capability

### 11.2 Desktop-launched Avatar 允许的能力 (NAV-SHELL-RUNTIME-BINDING-002)

Desktop-launched Avatar embodiment app shell 仅允许：

- 加载 Desktop / Runtime 在启动时投递的 launch context：`runtime_app_id`、`avatar_instance_id`、`agent_id`、`conversation_anchor_id`、`world_id`（如适用）、binding handle / id，以及用于 `K-BIND-012` relation 校验的非账号 selector（`app_instance_id`、`window_id`）
- 通过 SDK Runtime 投影面（`S-RUNTIME-109` / `S-RUNTIME-110`）订阅 binding 事件、agent 事件
- 在 binding 不可用时关闭 interaction / voice / activity 消费，但保持已加载的 visual carrier 可见

### 11.3 Binding 失败语义 (NAV-SHELL-RUNTIME-BINDING-003)

Runtime binding 不可用、binding state 非 `active`、或事件流不可用时：

- Avatar 必须显示 typed unavailable state（不显示 fixture 数据）
- 如果 visual model 已加载且仍合法，必须保持可见（仅关闭 interaction）
- 不允许尝试自行重新 binding 或 fallback 到 Realm / shared auth
- 不允许把 Tauri 错误投影成"伪登录"路径

### 11.4 Tauri Permission 排除 (NAV-SHELL-RUNTIME-BINDING-004)

Avatar Tauri capability 文件不允许包含：

- `auth_session_*` IPC 命令
- `runtime.account.*` 的 direct account / token owner 调用面
- `runtime.auth.*` 的 `RegisterApp` / `OpenSession` 直接调用面
- 任何允许从 disk 读取 `~/.nimi/auth/**` 的 fs scope

guardrail 必须在 `wave-6` 落地（见 `negative-test-matrix.md` 与 `guardrail-scan-plan.md`）。

### 11.5 Launch Handoff 字段 (NAV-SHELL-RUNTIME-BINDING-005)

Desktop 启动 Desktop-launched Avatar embodiment 时只允许传递 typed launch context：

- `runtime_app_id`、`avatar_instance_id`、`agent_id`、`conversation_anchor_id`、`world_id`（如适用）
- Runtime-issued binding id 或 bridge-side opaque handle（`K-BIND-003` `allowed` / `allowed-only-behind-runtime-bridge`）
- opaque non-account visual model package descriptor/capability（例如 package kind/id 或 bridge-side local package reference）

禁止字段：Realm URL、access token、refresh token、raw JWT、`subject_user_id`、account id、user id、shared auth payload、any auth UX route。

### 11.6 Avatar-as-primary-app 非本 contract 范围 (NAV-SHELL-RUNTIME-BINDING-006)

Avatar-as-primary-app 不由本 Desktop-launched embodiment contract admit。若后续产品需要 Avatar 作为主入口，它必须新建或扩展 spec，按 local first-party Runtime-brokered app mode 接入：

- login 通过 Runtime Nimi Auth Browser callback `code/state`
- refresh token / durable session 仍由 Runtime custody 拥有
- direct Realm data access 只能使用 Runtime-backed short-lived access-token provider
- 不允许复用 Desktop-launched embodiment binding carrier 作为 account token

---

**Baseline: Phase 1 scope only**. Phase 2 chat button / hotkey / settings UI 在本 contract 的 placeholder section 明确标记，不作为 Phase 1 实现义务。
