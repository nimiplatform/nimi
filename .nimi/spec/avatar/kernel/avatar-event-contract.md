# Avatar Event Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: Baseline updated 2026-04-21 (consumer-aligned to mounted runtime substrate)
> **Upstream platform refs**:
> - [Runtime HookIntent contract](../../runtime/kernel/agent-hook-intent-contract.md)
> - [Runtime presentation/activity projection seam](../../runtime/kernel/agent-presentation-stream-contract.md)
> - [Runtime transient presentation seam](../../runtime/kernel/agent-presentation-stream-contract.md)
> - [Conversation anchor contract](../../runtime/kernel/agent-conversation-anchor-contract.md)
> **Sibling kernel contracts**:
> - [Agent script contract](agent-script-contract.md)
> - [Embodiment projection contract](embodiment-projection-contract.md)
> - [App shell contract](app-shell-contract.md)
> - [Live2D render contract](live2d-render-contract.md)

---

## 0. 阅读指南

本 contract 定义 Nimi Avatar app 作为 first-party event producer / subscriber 的 event spec，遵守 runtime HookIntent / presentation projection authority 与 Avatar-local event convention。Avatar 是独立 app，但 current canonical normal path 由 desktop bridge / handoff 启动；owner 为 `avatar.*`。

Avatar app 的 rendering backend（Live2D / VRM / 3D / Lottie / 极简 blob）具体选型**不影响**本 spec 的 event 定义。Runtime presentation/activity projection 与 Avatar spec-owned `tables/activity-mapping.yaml` 把语义映射从 rendering 解耦；其 reusable projection helper 可以由 `@nimiplatform/kit/features/avatar` 发布。closed activity ontology 只保留为设计证据，不是本 app 的活动 authority。

The active Avatar event surface covers the multi-backend BackendBranch carrier abstraction:

- `avatar.audio.pipeline.*`, `avatar.audio.playback.*`, `avatar.lipsync.*`,
  `avatar.motion.preset.*`, `avatar.emote.applied`, `avatar.hit_region.*`,
  `avatar.carrier.lifecycle.*` are admitted as new event families.
- `avatar.model.load` schema migrates from `compatibility_tier` / `adapter_id`
  (Live2D-specific) to `model_kind` (`'live2d' | 'vrm' | 'nimi2d'`) + `backend_meta`
  (open object).
- `lipsync_frame_batch` consume references are removed (avatar-side hard-cut;
  platform-side emit deprecation requires separate admitted authority). Synthetic-audio mime
  triggers `avatar.lipsync.silent { silent_reason: 'synthetic_audio' }` —
  no decode, no mouth movement.
- `avatar.lipsync.frame` per-frame event is **deprecated** as a public surface.
  Avatar consumers do not subscribe to
  per-frame lipsync events; mouth movement is driven by
  `BackendAudioConsumer.snapshot()` in the surface useFrame loop. Existing
  subscribers must migrate to `avatar.lipsync.{active,silent,frame_drop}`.

---

## 1. Namespace Declaration

- App namespace: `avatar` (first-party reserved)
- Sub-namespaces: `avatar.user.*` / `avatar.*` / `avatar.app.*` / `avatar.composition.*` / `avatar.shell.*`
- Before-event namespace: `avatar.before.*`

---

## 2. Events

### 2.1 User Input (9 events, `avatar.user.*`)

用户对 avatar 形象的直接交互：

| Event | 语义 | Rate tier | Cancellable |
|---|---|---|---|
| `avatar.user.click` | 单击 avatar；local lightweight interaction only, must not create a Runtime conversation turn | Low | — |
| `avatar.user.double_click` | 双击 avatar；request foreground response priority via Runtime-owned boundary | Low | — |
| `avatar.user.right_click` | 右键 avatar（唤起 avatar-local context menu） | Low | — |
| `avatar.user.long_press` | 左键静止长按 avatar 1s；唤起 avatar-local action radial，不创建 Runtime conversation turn | Low | — |
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
| `avatar.activity.start` | Runtime typed activity cue 触发执行 | Low | ✅ via `.before.activity.start` |
| `avatar.activity.end` | Activity 正常结束 | Low | — |
| `avatar.activity.cancel` | Activity 被抢占取消 | Low | — |
| `avatar.motion.play` | Motion group 播放 | Low | — |
| `avatar.motion.complete` | Motion 完成 | Low | — |
| `avatar.expression.change` | Expression 层变化 | Low | — |
| `avatar.pose.set` | Runtime typed pose cue 设置 | Low | — |
| `avatar.pose.clear` | Runtime typed pose clear cue | Low | — |
| `avatar.lookat.set` | Runtime typed lookat cue 触发 | Low | — |
| `avatar.lipsync.frame` | **Deprecated**. Per-frame lipsync no longer flows through the event bus; consumers read `BackendAudioConsumer.snapshot()` in surface useFrame. New subscribers MUST use `avatar.lipsync.active` / `avatar.lipsync.silent` instead. | n/a (deprecated) | — |
| `avatar.speak.start` | TTS playback start；与 runtime `runtime.agent.presentation.voice_playback_requested` 时间戳对齐 | Low | — |
| `avatar.speak.chunk` | TTS chunk；audio playback chunk 对齐 lipsync frame batch | Medium | — |
| `avatar.speak.end` | TTS playback completion；voice playback state == `completed` | Low | — |
| `avatar.speak.interrupt` | TTS interrupt；voice playback state ∈ `{interrupted, canceled}` | Low | — |

### 2.3 App Lifecycle (5 events, `avatar.app.*`)

| Event | 语义 | Rate tier | Cancellable |
|---|---|---|---|
| `avatar.app.start` | App 启动（normal path 由 desktop handoff 选定 target；fixture / dev path 可显式独立启动） | Burst | — |
| `avatar.app.ready` | visual carrier 初始化完成；runtime binding 状态单独由 runtime/driver surface 表达 | Burst | — |
| `avatar.app.focus.change` | Avatar 形象获得/失去焦点 | Low | — |
| `avatar.app.visibility.change` | Avatar 可见性（on-screen / off-screen / tray-minimized） | Low | — |
| `avatar.app.shutdown` | App 关闭 | Burst | — |

### 2.4 Shell Overlay Interaction (20 events, `avatar.shell.*`)

Embodied output layer transient overlays and avatar-local shell interactions. Text and voice authority remains Runtime-owned; these events record shell presentation/input lifecycle only.

| Event | 语义 | Rate tier | Cancellable |
|---|---|---|---|
| `avatar.shell.context_menu.opened` | Right-click opened avatar-local tool menu | Low | — |
| `avatar.shell.context_menu.dismissed` | Context menu dismissed by action, outside click, Escape, or composition change | Low | — |
| `avatar.shell.action_radial.opened` | Press-hold opened character interaction radial | Low | — |
| `avatar.shell.action_radial.dismissed` | Action radial dismissed | Low | — |
| `avatar.shell.action_radial.selected` | Local presentation action selected | Low | — |
| `avatar.shell.composer.opened` | Transient text composer opened | Low | — |
| `avatar.shell.composer.submitted` | Transient composer submitted a bounded text turn to Runtime-bound agent context | Low | — |
| `avatar.shell.composer.send-failed` | Runtime/binding/network rejected composer submission | Low | — |
| `avatar.shell.composer.dismissed` | Composer closed by focus switch, Escape, explicit close, or composition change | Low | — |
| `avatar.shell.scale.changed` | Wheel scale changed current avatar instance size | Medium | — |
| `avatar.shell.scale.reset` | User reset current avatar instance size | Low | — |
| `avatar.shell.foreground_priority.requested` | Double-click or menu requested this avatar become foreground respondent | Low | — |
| `avatar.shell.appearance.opened` | Context menu opened the transient read-only Avatar appearance overlay | Low | — |
| `avatar.shell.settings.changed` | Shell-local setting changed | Low | — |
| `avatar.shell.hide-requested` | Context menu requested this avatar window hide from the desktop until Desktop/Runtime relaunches or reveals it | Low | — |
| `avatar.shell.close-requested` | Context menu requested this avatar instance window close | Low | — |
| `avatar.shell.interrupt.requested` | Context menu requested Runtime cancel the active current-anchor companion participation / turn | Low | — |
| `avatar.shell.interrupt.failed` | Runtime rejected or failed the interrupt request | Low | — |
| `avatar.shell.debug.opened` | Context menu opened the transient Avatar debug overlay | Low | — |
| `avatar.shell.debug.request-failed` | Runtime rejected a debug probe request from the transient overlay | Low | — |

### 2.4.1 Avatar Debug Backend Evidence (3 events, `avatar.debug.*`)

Avatar-owned backend debug evidence supports Runtime-owned avatar debug probe
semantics. Avatar must not mint public debug success outside Runtime's typed
probe result path.

| Event | 语义 | Rate tier | Cancellable |
|---|---|---|---|
| `avatar.debug.session-evidence` | Avatar backend debug session evidence was evaluated locally | Low | — |
| `avatar.debug.probe-submit-failed` | Avatar failed to evaluate or submit backend evidence for a Runtime debug probe | Low | — |
| `avatar.debug.probe-submit-skipped` | Runtime debug probe is not Avatar-submittable, so Avatar did not submit a result | Low | — |

### 2.4.2 Live2D Backend Evidence (1 event, `avatar.live2d.*`)

Live2D backend evidence is Avatar-owned rendering/backend evidence. It may
support debug/configuration presentation by ref, but it does not define Runtime
emotion ontology and must not expose raw model/provider/NAS payloads.

| Event | 语义 | Rate tier | Cancellable |
|---|---|---|---|
| `avatar.live2d.expression-inventory` | Parsed model-local `exp3.json` expression inventory summary was evaluated for the loaded Live2D backend | Low | — |

### 2.5 Composition State (4 events, `avatar.composition.*`)

Composition state 转移与 surface mount/unmount 证据。具体 state 枚举见 `app-shell-contract.md` §6.1：

| Event | 语义 | Rate tier | Cancellable |
|---|---|---|---|
| `avatar.composition.transition` | Composition state 切换（含 from/to/reason） | Low | — |
| `avatar.composition.relaunch-pending` | Desktop 推送了 launch context update，进入 relaunch-pending 状态 | Low | — |
| `avatar.composition.surface-mounted` | embodiment-stage / transient overlay / degraded-surface 挂载完成 | Low | — |
| `avatar.composition.surface-unmounted` | 上述任一 surface 卸载完成 | Low | — |

### 2.5.1 Audio Pipeline & Lipsync

Hard-cut delete frame_batch consume path on the Avatar side. Platform-side emit
deprecation remains owned by runtime event authority.

| Event | 语义 | Rate tier | Cancellable |
|---|---|---|---|
| `avatar.audio.pipeline.ready` | AudioContext + wLipSync worklet 加载完成（per session 一次） | Burst | — |
| `avatar.audio.pipeline.failed` | context / worklet / mime / fetch / decode 任一失败 | Burst | — |
| `avatar.audio.playback.requested` | voice_playback_requested mirrored；audioPipeline.play 入口 | Low | — |
| `avatar.audio.playback.started` | source.start() 完成 | Low | — |
| `avatar.audio.playback.completed` | source.onended 自然结束 | Low | — |
| `avatar.audio.playback.interrupted` | runtime 端 `voice_playback_state='interrupted'` | Low | — |
| `avatar.audio.playback.canceled` | runtime 端 `voice_playback_state='canceled'` | Low | — |
| `avatar.audio.playback.failed` | mime / decode / fetch / readBytes 失败 | Low | — |
| `avatar.audio.lifecycle.state_changed` | Presence capsule mapped local audio/voice lifecycle changed; state ids come from `wake-local-audio-lifecycle-contract.md` | Medium | — |
| `avatar.audio.privacy.indicator_changed` | Visible microphone/audio privacy indicator changed in the foreground Avatar surface | Medium | — |
| `avatar.lipsync.active` | 进入 active phase（silent → active 转换） | Medium | — |
| `avatar.lipsync.silent` | 进入 silent phase；`silent_reason` 之一：`amp_below` / `idle_window` / `winner_gain` / `no_source` / `synthetic_audio` / `no_expression_manager` | Medium | — |
| `avatar.lipsync.frame_drop` | wLipSyncNode 异常或缺帧（telemetry-only） | High (opt-in) | — |

### 2.5.2 Generated Motion & Emote

| Event | 语义 | Rate tier | Cancellable |
|---|---|---|---|
| `avatar.motion.preset.played` | VRM generated route crossfade 启动；Live2D motion-group 起播 | Low | — |
| `avatar.motion.preset.fail_close` | generated provider missing / route 不存在 / capability 缺失 / unsafe pose / interchange asset drift | Low | — |
| `avatar.emote.applied` | emote bundle 应用完成；含 `skipped_count`（model 缺 expression preset 跳过的条目数） | Low | — |

### 2.5.3 Hit Region Snapshot

| Event | 语义 | Rate tier | Cancellable |
|---|---|---|---|
| `avatar.hit_region.snapshot` | bbox snapshot 上报到 carrier（throttled 100ms minimum） | Medium | — |
| `avatar.hit_region.degraded` | alpha-mask 不可用，仅 bbox 路径生效（device tier C） | Low | — |

### 2.5.4 Carrier Lifecycle

| Event | 语义 | Rate tier | Cancellable |
|---|---|---|---|
| `avatar.carrier.lifecycle.context_lost` | WebGL/AudioContext 丢失 | Burst | — |
| `avatar.carrier.lifecycle.context_restored` | 1500ms 内单次重试恢复成功 | Burst | — |
| `avatar.carrier.lifecycle.failed_closed` | 二次 context_lost / load_failed / 不可恢复 | Burst | — |

### 2.6 Shell Lifecycle (3 events, `avatar.shell.*`)

Shell-level reload / relaunch / window 行为：

| Event | 语义 | Rate tier | Cancellable |
|---|---|---|---|
| `avatar.shell.reload-requested` | 用户在 degraded-surface 触发 reload | Low | — |
| `avatar.shell.reload-resumed` | Reload 完成后回到 loading composition state | Low | — |
| `avatar.shell.window-bounds-changed` | Dynamic window sizing 重算后 set_size 完成 | Medium | — |

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

avatar.user.long_press:
  detail:
    region: enum(body|head|face|accessory|null)
    x: int
    y: int
    button: enum(left)
    client_x: int                                  # viewport position for action radial anchoring
    client_y: int

avatar.activity.start:
  detail:
    activity_name: string                          # admitted runtime ontology id only, e.g. "happy" or spec-admitted "ext:grateful"
    category: enum(emotion|interaction|state)
    intensity: enum(weak|moderate|strong) | null   # null if not applicable
    source: enum(apml_output|direct_api|mock)
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
    stream_id: string                              # runtime-owned stream id
    turn_id: string                                # runtime-owned turn id
    sequence: int                                  # monotonic within stream

avatar.speak.start:
  detail:
    voice_adapter_id: string                       # provider-neutral adapter id
    voice_id: string?
    text_preview: string                           # first N chars
    duration_estimate_ms: int
    stream_id: string
    turn_id: string

avatar.shell.composer.submitted:
  detail:
    avatar_instance_id: string
    agent_id: string
    conversation_anchor_id: string
    text_length: int
    submitted_at: string

avatar.shell.composer.send-failed:
  detail:
    avatar_instance_id: string
    agent_id: string
    conversation_anchor_id: string
    reason_code: string
    account_reason_code: string?
    action_hint: string?
    failed_at: string                              # ISO 8601

avatar.shell.foreground_priority.requested:
  detail:
    avatar_instance_id: string
    agent_id: string
    source: enum(double_click|context_menu|runtime_projection)
    requested_at: string

avatar.shell.appearance.opened:
  detail:
    avatar_instance_id: string?
    agent_id: string?
    conversation_anchor_id: string?
    model_id: string?
    backend_kind: enum(live2d|vrm|nimi2d|unknown)
    source_authority: enum(runtime|fixture|unknown)
    scale: number
    opened_at: string                              # ISO 8601

avatar.shell.scale.changed:
  detail:
    avatar_instance_id: string
    previous_scale: float
    next_scale: float
    source: enum(wheel|reset|restore)
    changed_at: string

avatar.shell.settings.changed:
  detail:
    key: enum(always_on_top|show_voice_captions)
    value: bool
    changed_at: string

avatar.shell.hide-requested:
  detail:
    avatar_instance_id: string
    agent_id: string
    source: enum(context_menu)
    requested_at: string

avatar.shell.close-requested:
  detail:
    avatar_instance_id: string
    agent_id: string
    source: enum(context_menu)
    requested_at: string

avatar.shell.interrupt.requested:
  detail:
    avatar_instance_id: string
    agent_id: string
    conversation_anchor_id: string
    active_turn_id: string
    active_turn_phase: enum(accepted|started|streaming|committed)
    source: enum(context_menu)
    reason: enum(user_cancel)
    requested_at: string

avatar.shell.interrupt.failed:
  detail:
    avatar_instance_id: string
    agent_id: string
    conversation_anchor_id: string
    active_turn_id: string?
    reason_code: string
    error: string
    failed_at: string

avatar.shell.debug.opened:
  detail:
    avatar_instance_id: string
    agent_id: string
    conversation_anchor_id: string
    client_x: int
    client_y: int
    opened_at: string                              # ISO 8601

avatar.shell.debug.request-failed:
  detail:
    avatar_instance_id: string
    agent_id: string
    conversation_anchor_id: string
    probe_kind: enum(backend_load|capability_profile|route_support_matrix|generated_motion|emotion_expression|speech_lipsync|window_hit_region)
    reason_code: string
    error: string?
    failed_at: string                              # ISO 8601

avatar.live2d.expression-inventory:
  detail:
    status: enum(ready|unsupported|error)
    source: enum(live2d-backend-session)
    model_kind: enum(live2d)
    model_id: string
    expression_inventory_ref: string?
    expression_count: int
    expression_ids: string[]                       # model-local ids only
    expression_parameter_count: int
    expression_parameter_ids: string[]             # parameter ids only, no raw exp3 payload
    expression_blend_mode_counts:
      add: int
      multiply: int
      overwrite: int
    reason_code: string?
    observed_at: string                            # ISO 8601

avatar.composition.transition:
  detail:
    from: string                                   # composition state name
    to: string
    reason_code: string?
    account_reason_code: string?
    stage: string?
    recorded_at: string                            # ISO 8601

avatar.composition.relaunch-pending:
  detail:
    next_launch_context:
      agent_id: string
      avatar_instance_id: string?
      launch_source: string?
    notified_at: string

avatar.composition.surface-mounted:
  detail:
    surface: enum(embodiment-stage|context-menu|action-radial|transient-composer|settings-overlay|appearance-overlay|debug-overlay|caption-overlay|degraded-surface)
    composition_state: string                      # composition state at mount time
    mounted_at: string                             # ISO 8601

avatar.composition.surface-unmounted:
  detail:
    surface: enum(embodiment-stage|context-menu|action-radial|transient-composer|settings-overlay|appearance-overlay|debug-overlay|caption-overlay|degraded-surface)
    composition_state: string                      # composition state at unmount time
    unmounted_at: string                           # ISO 8601

avatar.shell.reload-requested:
  detail:
    from_state: string                             # composition state name
    requested_at: string

avatar.shell.window-bounds-changed:
  detail:
    width: int
    height: int
    embodiment_bounds: { x: int, y: int, width: int, height: int }
    scale: float
    changed_at: string

avatar.model.load:
  detail:
    model_id: string
    model_kind: enum(live2d|vrm|nimi2d)     # replaces compatibility_tier / adapter_id
    backend_meta: object                    # backend-specific opaque descriptor (BackendBranch.metadata())
    nas_handler_count: int
    loaded_at: string                       # ISO 8601

avatar.audio.pipeline.ready:
  detail:
    audio_context_state: enum(running|suspended)
    wlipsync_loaded: bool
    ready_at: string

avatar.audio.pipeline.failed:
  detail:
    reason_code: string                     # e.g. wlipsync_init_failed | no_audio_context
    failed_at: string

avatar.audio.playback.requested:
  detail:
    audio_artifact_id: string
    audio_mime_type: string
    requested_at: string

avatar.audio.playback.started:
  detail:
    audio_artifact_id: string
    duration_ms: int                        # decoded buffer duration
    started_at: string

avatar.audio.playback.completed:
  detail:
    audio_artifact_id: string
    completed_at: string

avatar.audio.playback.interrupted:
  detail:
    audio_artifact_id: string
    interrupted_at: string

avatar.audio.playback.canceled:
  detail:
    audio_artifact_id: string
    canceled_at: string

avatar.audio.playback.failed:
  detail:
    audio_artifact_id: string
    reason_code: string                     # e.g. unsupported_mime | artifact_not_found |
                                            #      artifact_too_large | artifact_forbidden |
                                            #      artifact_mime_mismatch | fetch_failed |
                                            #      decode_failed | no_audio_context
    failed_at: string

avatar.audio.lifecycle.state_changed:
  detail:
    from_state: string?
    to_state: enum(idle|foreground_listening|transcribing|turn_pending|assistant_speaking|interrupted|muted_or_audio_unavailable|blocked|error|runtime_degraded|wake_future_unadmitted)
    voice_status: string
    audio_playback_state: string
    lipsync_active: bool
    changed_at: string

avatar.audio.privacy.indicator_changed:
  detail:
    indicator: enum(mic_idle|mic_active|mic_blocked|capture_processing|speaker_active|speaker_unavailable|none)
    visible: bool
    foreground_only: bool
    changed_at: string

avatar.lipsync.active:
  detail:
    audio_artifact_id: string?
    started_at: string

avatar.lipsync.silent:
  detail:
    silent_reason: enum(amp_below|idle_window|winner_gain|no_source|synthetic_audio|no_expression_manager)
    audio_artifact_id: string?
    silent_at: string

avatar.lipsync.frame_drop:
  detail:
    drop_count: int
    window_ms: int
    recorded_at: string

avatar.motion.preset.played:
  detail:
    model_kind: enum(live2d|vrm|nimi2d)
    preset_id: string                       # e.g. nod_yes (vrm) | Activity_Happy (live2d)
    fade_sec: float
    loop: bool
    played_at: string

avatar.motion.preset.fail_close:
  detail:
    model_kind: enum(live2d|vrm|nimi2d)
    preset_id: string
    reason_code: string                     # e.g. generated_provider_missing | route_not_admitted | capability_missing | unsafe_pose | low_confidence | interchange_asset_drift
    recorded_at: string

avatar.emote.applied:
  detail:
    model_kind: enum(live2d|vrm|nimi2d)
    emote: string                           # admitted ontology emotion id only; extension requires runtime/APML authority
    skipped_count: int                      # expressions skipped because preset missing on loaded model
    applied_at: string

avatar.hit_region.snapshot:
  detail:
    model_kind: enum(live2d|vrm|nimi2d)
    body: { left: float, top: float, right: float, bottom: float }    # 0..1 viewport-normalized
    drag: { left: float, top: float, right: float, bottom: float }
    has_alpha_mask: bool
    snapshot_at: string

avatar.hit_region.degraded:
  detail:
    model_kind: enum(live2d|vrm|nimi2d)
    reason_code: string                     # e.g. render_target_unavailable | device_tier_c
    recorded_at: string

avatar.carrier.lifecycle.context_lost:
  detail:
    model_kind: enum(live2d|vrm|nimi2d)
    context_kind: enum(webgl|webgl2|audio)
    lost_at: string

avatar.carrier.lifecycle.context_restored:
  detail:
    model_kind: enum(live2d|vrm|nimi2d)
    context_kind: enum(webgl|webgl2|audio)
    restore_duration_ms: int
    restored_at: string

avatar.carrier.lifecycle.failed_closed:
  detail:
    model_kind: enum(live2d|vrm|nimi2d)
    reason_code: string                     # e.g. context_lost_twice | load_failed | wlipsync_init_failed
    closed_at: string
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
  - name: "avatar.user.long_press"
    detail_schema:
      region: enum(body|head|face|accessory|null)
      x: int
      y: int
      button: enum(left)
      client_x: int
      client_y: int
    rate_limit_tier: low
    stability: stable
    visibility: public
  - name: "avatar.activity.start"
    detail_schema:
      activity_name: string
      category: enum(emotion|interaction|state)
      intensity: enum(weak|moderate|strong)?
      source: enum(apml_output|direct_api|mock)
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
      stream_id: string
      turn_id: string
      sequence: int
    rate_limit_tier: very_high_opt_in
    default_max_rate_hz: 60
    stability: deprecated
    visibility: unavailable_public_surface
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
  # Layer B raw parser-event subscriptions are rejected by runtime
  # (internal-only; Avatar consumes typed runtime.agent.* projection only)
  # Generated motion provider routing starts only after typed runtime projection;
  # route ids never become public APML syntax or runtime activity ontology.
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
| `runtime.agent.presentation.motion_requested` | typed runtime motion cue；Avatar 可按已 admit mapping 投影到 backend route，但不得把 route id 反向定义为 runtime payload |
| `runtime.agent.presentation.expression_requested` | typed runtime expression cue；不是 public APML direct expression syntax |
| `runtime.agent.presentation.pose_requested` / `pose_cleared` | typed runtime pose cue；不是 public APML direct pose / clear-pose syntax |
| `runtime.agent.presentation.lookat_requested` | typed runtime look-at cue；不是 public APML direct look-at syntax |
| `runtime.agent.state.posture_changed` | `PostureProjection` 变化 → avatar 调整姿态 |
| `runtime.agent.state.emotion_changed` | emotion 变化 → avatar 调整 affect baseline |
| `runtime.agent.state.status_text_changed` | Status 变化 → avatar 显示 status bubble |
| `runtime.agent.hook.running` | Life-track hook 运行中 → avatar 做对应的 state activity（如 sleeping / focused） |
| `system.focus.*` | 系统焦点变化 |

---

## 7. Rendering Backend 边界

Avatar app 的 rendering backend 具体实现（Live2D Cubism SDK / VRM / 3D / Lottie / 极简 blob）不影响本 spec 的 event 定义 —— event 语义是 rendering-agnostic 的。

Activity → motion/expression 的具体映射见 [activity mapping table](tables/activity-mapping.yaml)。该表的 authority 留在 Avatar spec；代码侧可通过 Kit Avatar headless helper 消费。每个 rendering backend 按其 convention + metadata 解析。

Generated motion provider routing consumes only typed `runtime.agent.*`
projection and Avatar-owned mapping/profile/route tables under
`.nimi/spec/avatar/**`. Kit may expose route/protocol types and pure resolver
helpers, but concrete VRM provider/runtime implementation remains a launched
Avatar backend concern unless a backend renderer seam is separately admitted.
It must not subscribe to the runtime-internal APML parser diagnostic namespace,
define an Avatar-local activity ontology, or promote Avatar backend route ids
into public APML syntax.

---

## 8. Evolution

- 新增 event → 本 spec minor bump + avatar app release
- 改 event 语义 / 删 event → avatar app major bump
- 必须符合本 contract 的 event contract version（当前 1.0）
- 添加 event 前需同步更新 manifest 声明

---

**Baseline updated 2026-04-21**。Avatar app 具体 rendering 实现（Cubism SDK 接入 /
lip-sync pipeline / TTS 绑定 / model 加载策略 / settings UI 等）不在本 spec 范围，仅定义
Avatar-local event contract。平台级 runtime projection 以 `.nimi/spec/runtime/kernel/**`
为准。
