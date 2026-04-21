# Avatar Event Contract

> **App**: `@nimiplatform/nimi-avatar`
> **Authority**: App-local kernel contract
> **Status**: Baseline updated 2026-04-21 (consumer-aligned to mounted runtime substrate)
> **Upstream platform refs**:
> - [Platform event contract + App convention](../../../../.nimi/local/report/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/event-hook-contract.md)
> - [Activity ontology](../../../../.nimi/local/report/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/activity-ontology.md)
> - [Runtime transient presentation seam](../../../../.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
> - [Conversation anchor contract](../../../../.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
> **Sibling kernel contracts**:
> - [Agent script contract](agent-script-contract.md)
> - [App shell contract](app-shell-contract.md)
> - [Live2D render contract](live2d-render-contract.md)

---

## 0. 阅读指南

本 contract 定义 Nimi Avatar app 作为 first-party event producer / subscriber 的 event spec，遵守 platform event contract（议题 3）convention。Avatar 是独立 app（可独立启动或随 desktop 启动），owner 为 `avatar.*`。合计 31 events（8 user + 18 avatar + 5 app）。

Avatar app 的 rendering backend（Live2D / VRM / 3D / Lottie / 极简 blob）具体选型**不影响**本 spec 的 event 定义 —— activity-ontology.md §8 已经把语义映射从 rendering 解耦。

---

## 1. Namespace Declaration

- App namespace: `avatar` (first-party reserved)
- Sub-namespaces: `avatar.user.*` / `avatar.*` / `avatar.app.*`
- Before-event namespace: `avatar.before.*`

---

## 2. Events

### 2.1 User Input (8 events, `avatar.user.*`)

用户对 avatar 形象的直接交互：

| Event | 语义 | Rate tier | Cancellable |
|---|---|---|---|
| `avatar.user.click` | 单击 avatar | Low | — |
| `avatar.user.double_click` | 双击 avatar | Low | — |
| `avatar.user.right_click` | 右键 avatar（唤起菜单等） | Low | — |
| `avatar.user.hover` | 悬停 avatar | Medium | — |
| `avatar.user.leave` | 离开 avatar | Medium | — |
| `avatar.user.drag.start` | 开始拖拽 avatar 形象 | Low | — |
| `avatar.user.drag.move` | 拖拽中 | Medium (30 Hz) | — |
| `avatar.user.drag.end` | 拖拽结束 | Low | — |

### 2.2 Avatar Surface (18 events, `avatar.*`)

Avatar 渲染 + agent 表现（默认由 runtime-owned
`runtime.agent.presentation.*` / `runtime.agent.turn.*` / `runtime.agent.state.*`
projection 触发）：

| Event | 语义 | Rate tier | Cancellable |
|---|---|---|---|
| `avatar.app.mount` | Avatar 挂载 | Burst | — |
| `avatar.app.unmount` | Avatar 卸载 | Burst | — |
| `avatar.model.load` | 模型加载完成 | Burst | — |
| `avatar.model.switch` | 模型切换 | Burst | — |
| `avatar.activity.start` | `<activity>` 触发执行 | Low | ✅ via `.before.activity.start` |
| `avatar.activity.end` | Activity 正常结束 | Low | — |
| `avatar.activity.cancel` | Activity 被抢占取消 | Low | — |
| `avatar.motion.play` | Motion group 播放 | Low | — |
| `avatar.motion.complete` | Motion 完成 | Low | — |
| `avatar.expression.change` | Expression 层变化 | Low | — |
| `avatar.pose.set` | `<pose>` 设置 | Low | — |
| `avatar.pose.clear` | `<clear-pose/>` | Low | — |
| `avatar.lookat.set` | `<lookat>` 触发 | Low | — |
| `avatar.lipsync.frame` | Lip-sync frame | **Very high (opt-in)** | — |
| `avatar.speak.start` | TTS 播放开始 | Low | — |
| `avatar.speak.chunk` | TTS chunk | Medium | — |
| `avatar.speak.end` | TTS 播放完成 | Low | — |
| `avatar.speak.interrupt` | TTS 被打断 | Low | — |

### 2.3 App Lifecycle (5 events, `avatar.app.*`)

| Event | 语义 | Rate tier | Cancellable |
|---|---|---|---|
| `avatar.app.start` | App 启动（独立或随 desktop） | Burst | — |
| `avatar.app.ready` | 初始化完成（runtime 连上 + model 加载好） | Burst | — |
| `avatar.app.focus.change` | Avatar 形象获得/失去焦点 | Low | — |
| `avatar.app.visibility.change` | Avatar 可见性（on-screen / off-screen / tray-minimized） | Low | — |
| `avatar.app.shutdown` | App 关闭 | Burst | — |

---

## 3. Before-Events (Cancellable)

| Before Event | 用途 |
|---|---|
| `avatar.before.activity.start` | 拦截 activity 播放（例如正在更高 priority motion） |

---

## 4. Representative Payload Shapes

```yaml
avatar.user.click:
  detail:
    region: enum(body|head|face|accessory|null)   # which body part clicked
    x: int                                         # local to avatar surface
    y: int
    button: enum(left|middle|right)

avatar.activity.start:
  detail:
    activity_name: string                          # "happy" | "ext:grateful" | "mod-foo:bar"
    category: enum(emotion|interaction|state)
    intensity: enum(weak|moderate|strong) | null   # null if not applicable
    source: enum(runtime_projection|direct_api)
    expected_duration_ms: int | null

avatar.motion.play:
  detail:
    motion_group: string                           # e.g. "Activity_Happy"
    motion_file: string                            # resolved file ref
    priority: string
    loop: bool

avatar.lipsync.frame:
  detail:
    mouth_open_y: float                            # 0.0 - 1.0
    timestamp_offset_ms: int

avatar.speak.start:
  detail:
    tts_engine: string
    voice_id: string?
    text_preview: string                           # first N chars
    duration_estimate_ms: int
```

---

## 5. App Manifest 示意

```yaml
app_namespace: "avatar"
event_contract_version: "1.0"
lifecycle_events: [start, ready, focus.change, visibility.change, shutdown]

events:
  - name: "avatar.user.click"
    detail_schema:
      region: enum(body|head|face|accessory|null)
      x: int
      y: int
      button: enum(left|middle|right)
    rate_limit_tier: low
    stability: stable
    visibility: public
  - name: "avatar.activity.start"
    detail_schema:
      activity_name: string
      category: enum(emotion|interaction|state)
      intensity: enum(weak|moderate|strong)?
      source: enum(runtime_projection|direct_api)
      expected_duration_ms: int?
    rate_limit_tier: low
    cancellable: false
    stability: stable
    visibility: public
  - name: "avatar.before.activity.start"
    parent: "avatar.activity.start"
    cancellable: true
    visibility: public
  - name: "avatar.lipsync.frame"
    detail_schema:
      mouth_open_y: float
      timestamp_offset_ms: int
    rate_limit_tier: very_high_opt_in
    default_max_rate_hz: 60
    stability: stable
    visibility: public            # opt-in only; subscribers must declare max_rate_hz
  # ... 其他 events

before_cancel_policy:
  public_cancellable:
    - avatar.before.activity.start
  self_only: []

subscriptions:
  - "runtime.agent.turn.*"                   # text / commit / interrupt continuity
  - "runtime.agent.presentation.*"           # activity / motion / expression / pose / lookat
  - "runtime.agent.state.*"                  # posture_projection / status_text / execution_state / emotion 同步
  - "desktop.chat.message.send"              # 可选 first-party UI cue；不是 runtime chat ingress
  - "desktop.chat.message.receive"
  - "system.focus.*"                         # 系统焦点变化
  # Layer B (apml.*) 订阅请求会被 runtime 拒绝 (internal-only)
```

---

## 6. Cross-App Subscriptions

Avatar app 订阅对方 app 的 events（通过 runtime 中转）：

| Subscription | 用途 |
|---|---|
| `desktop.chat.message.send` | 可选 first-party UI cue：用户发送消息时，avatar 做"注视用户"的 activity |
| `desktop.chat.message.receive` | Agent 回复完成时，avatar 做对应情绪 activity |
| `runtime.agent.turn.message_committed` | 同 anchor 内 chat turn commit → avatar 可做响应收尾 |
| `runtime.agent.presentation.activity_requested` | runtime 请求 avatar 做某个 activity |
| `runtime.agent.state.posture_changed` | `PostureProjection` 变化 → avatar 调整姿态 |
| `runtime.agent.state.emotion_changed` | emotion 变化 → avatar 调整 affect baseline |
| `runtime.agent.state.status_text_changed` | Status 变化 → avatar 显示 status bubble |
| `runtime.agent.hook.running` | Life-track hook 运行中 → avatar 做对应的 state activity（如 sleeping / focused） |
| `system.focus.*` | 系统焦点变化 |

---

## 7. Rendering Backend 边界

Avatar app 的 rendering backend 具体实现（Live2D Cubism SDK / VRM / 3D / Lottie / 极简 blob）不影响本 spec 的 event 定义 —— event 语义是 rendering-agnostic 的。

Activity → motion/expression 的具体映射见 [activity-ontology §8](../../../../.nimi/local/report/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/activity-ontology.md)。每个 rendering backend 按其 convention + metadata 解析。

---

## 8. Evolution

- 新增 event → 本 spec minor bump + avatar app release
- 改 event 语义 / 删 event → avatar app major bump
- 必须符合议题 3 的 event contract version（当前 1.0）
- 添加 event 前需同步更新 manifest 声明

---

**Baseline updated 2026-04-21**。Avatar app 具体 rendering 实现（Cubism SDK 接入 /
lip-sync pipeline / TTS 绑定 / model 加载策略 / settings UI 等）不在本 spec 范围，仅定义
app-local event contract。平台级 runtime projection 以 `.nimi/spec/runtime/kernel/**`
为准。
