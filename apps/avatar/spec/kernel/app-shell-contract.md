# App Shell Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: App-local kernel contract
> **Status**: Phase 1 baseline draft
> **Sibling contracts**:
> - [Live2D render contract](live2d-render-contract.md)
> - [Agent script contract](agent-script-contract.md)
> - [Avatar event contract](avatar-event-contract.md)

---

## 0. 阅读指南

本 contract 定义 Nimi Avatar 桌面 shell 的 window、交互、lifecycle 行为。Avatar 不是常规软件窗口，而是**桌面悬浮 Live2D 角色**：形象即 UI，透明背景，无 chrome，always-on-top。本 contract 专注 Tauri shell surface 的规则（与 Live2D rendering pipeline 和 NAS handler runtime 并列）。

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

Window 尺寸**必须**跟随当前 Live2D model bounds：

- Model 加载完成（`avatar.model.load`）→ renderer 计算 model bounds → 调用 Tauri `set_size` 同步 window
- Model 切换（`avatar.model.switch`）→ 同上
- User 手动 resize 不允许（通过 `resizable: false` 在 runtime 效果上禁止 drag-handle；程序化 set_size 仍然可用）

### 1.3 Initial Position (NAV-SHELL-003)

- 首次启动：屏幕右下角 padding 24px
- 后续启动：记忆上次关闭时位置（persisted via `tauri-plugin-window-state` 或等价机制）
- Multi-monitor：恢复到上次 monitor；若 monitor 不可用，fallback 到 primary monitor

---

## 2. Hit Region & Click-through (NAV-SHELL-004)

### 2.1 Hit Region 定义

Avatar window 形状为矩形，但用户视觉只看到 Live2D 形象本身。**形象外区域必须穿透鼠标事件到下层 app**。

### 2.2 Hit Region 计算

每帧（或 Live2D bounds 变化时）计算 hit region：

```
hit_region = union of:
  - Live2D model alpha > threshold (e.g. 0.5)
  - UI overlays (small button, chat bubble in Phase 2)
```

渲染器把 hit region 以 mask 形式通过 Tauri API（`set_ignore_cursor_events` + per-region 切换，或 `window.setShape`）应用到 window。

### 2.3 Click-through 边界规则

- **In-region**（Live2D 像素 / UI overlay）：鼠标事件属于 avatar，触发 `avatar.user.*` events
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

Settings UI（Phase 2+）提供开关：

- `always_on_top: true`（default）
- `always_on_top_when_chat_active: true`（chat 时强制置顶）
- `always_on_top: false`（正常窗口堆叠顺序）

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

### 6.3 Hotkey (Phase 2)

- `Alt+Space`（可自定义）触发 chat，与 button click 等价

---

## 7. App Lifecycle Events (NAV-SHELL-009)

### 7.1 Start → Ready 序列

```
1. Tauri window created
2. Renderer bootstrap (React mount)
3. Emit avatar.app.start
4. Connect to runtime (Phase 1: mock driver init; Phase 2: gRPC)
5. Load Live2D model from configured path
6. Scan <model>/runtime/nimi/ for NAS handlers (§agent-script-contract)
7. Compute initial hit region + resize window to model bounds
8. Emit avatar.app.ready
```

### 7.2 Shutdown 序列

```
1. User triggers quit (tray → exit / hotkey)
2. Emit avatar.app.shutdown
3. Cancel in-flight NAS handlers (abort signal)
4. Dispose Cubism SDK resources
5. Close Tauri window
6. Process exit
```

### 7.3 Event Payload Shapes

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
| Live2D rendering pipeline | — | `live2d-render-contract.md` |
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

**Baseline: Phase 1 scope only**. Phase 2 chat button / hotkey / settings UI 在本 contract 的 placeholder section 明确标记，不作为 Phase 1 实现义务。
