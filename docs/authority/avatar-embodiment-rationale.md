# Avatar Embodiment - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/avatar/embodiment-surface.authority.yaml`(runtime 产权部分见 `.nimi/spec/runtime/agent-participation.authority.yaml`)。

---

<!-- source: .nimi/spec/avatar/kernel/backend-branch-contract.md -->

# Backend Branch Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: Active multi-backend carrier authority
> **Sibling contracts**:
> - [VRM backend contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Live2D render contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Nimi2D backend contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Embodiment projection contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [App shell contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Avatar event contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Carrier visual acceptance contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)

---

## 0. 阅读指南

本 contract 定义 Nimi Avatar 的 **backend-agnostic carrier abstraction** —
`BackendBranch`。它是 carrier / NAS projection / lipsync / embodiment-stage /
window-bounds / hit-region 共同消费的统一接口。任何 backend（Live2D / VRM /
Nimi2D / 未来 3D 等）必须 conform 此契约。

本 contract 不定义具体 backend 的渲染细节（见 `live2d-render-contract.md` /
`vrm-backend-contract.md`），不定义 ontology semantics（见
`embodiment-projection-contract.md`），不定义 audio pipeline
（audio pipeline 直接 consume platform `runtime.artifacts.readBytes`）。

---

## 1. Authority Scope

`BackendBranch` 是 `apps/avatar` 私有契约：

- 在 `.nimi/spec/avatar/` 内 admit；不导出到 `kit/**`
- 不被其他 app 直接消费（自包含 Avatar carrier authority）
- `kind` 分支只在 `createBackendBranch(model)` 一个工厂位置出现；其余代码
  必须按 `BackendBranch` interface 编程（不允许散落 `if (kind === ...)`）

任何新 backend kind 加入 `BackendKind` union 时，typecheck 强制
`createBackendBranch` exhaustive switch 更新（fail-close on new kind）。

---

## 2. Type Surface

### 2.1 Kind

```ts
export type BackendKind = 'live2d' | 'vrm' | 'nimi2d';
```

`BackendKind` 是 closed union；新 backend admit 必须先 minor-bump 本 contract。
`nimi2d` is admitted as an Avatar-local runtime branch for admitted Nimi2D
packages only. It does not admit default generated Nimi2D asset viability and
must fail closed on missing or invalid package/profile evidence.

### 2.2 NominalBounds

```ts
export type BackendNominalBounds = {
  width: number;          // px (logical), backend's nominal viewport width
  height: number;         // px (logical), backend's nominal viewport height
  bodyCenterX: number;    // 0..1 normalized within nominal viewport
  bodyCenterY: number;    // 0..1 normalized within nominal viewport
};
```

- `width / height` 是 backend 推荐的 carrier viewport 尺寸；window-bounds-policy
  消费此值作为 `embodiment_bounds` 的源（详 `tables/window-bounds-policy.yaml`）
- `bodyCenterX/Y` 是 embodiment/window framing 锚点（visible-area recovery /
  framing intent / hit-region bbox 中心），不得重新引入 companion-surface
  footprint 作为默认 window truth

### 2.3 HitRegion

```ts
export type BackendHitRegion = {
  /** viewport-normalized rect 0..1；OS-level ignore_cursor_events bbox fallback */
  body: { left: number; top: number; right: number; bottom: number };
  /** drag-allowed bbox（transient overlays / degraded surface 区域不开启 drag）*/
  drag: { left: number; top: number; right: number; bottom: number };
  /** 精确 alpha-mask hit query（pixel-level click-through）。
   *  非 null 时优先于 bbox；null 表示当前 backend 仅支持 bbox 路径。
   *  返回 null 表示当前帧 alpha probe 不可用，caller 必须 fallback 到 bbox。
   *  threshold 默认 10/255（airi 工业基线）；caller 可覆盖。*/
  isOpaqueAtClientPoint:
    | ((clientX: number, clientY: number, threshold?: number) => boolean | null)
    | null;
};
```

- alpha-mask + bbox **双层互补**：alpha-mask 优先精确，bbox 是兜底
  （详 `app-shell-contract.md` §"Hit Region 双层结构"）
- `isOpaqueAtClientPoint` 必须 cheap（per-frame query；不允许 readPixels 同步主线程
  整 canvas）；实现走 offscreen render-target + 抽样

### 2.4 AudioConsumer

```ts
export interface WLipSyncSnapshot {
  /** 6-dim AEIOUS weights from wLipSync worklet output (per-frame) */
  weights: Record<'A' | 'E' | 'I' | 'O' | 'U' | 'S', number>;
  /** node.volume reading at snapshot time */
  volume: number;
}

export type BackendAudioConsumer = {
  /** AudioPipeline 在 source.start() 后调用；同一 source 可能被多次 attach
   *  不同 sink。返回 Promise，因为内部首次调用 lazy createWLipSyncNode
   *  （包内 worklet/WASM 加载是 async）。详 design-05 §"wLipSync 集成"。*/
  attachAudioSource(source: AudioBufferSourceNode, audioContext: AudioContext): Promise<void>;
  /** 切 sink / 切 backend / shutdown 时调用；同步行为，仅断开
   *  source ↔ wLipSyncNode 连接；不重置嘴型（嘴型由后续 silent() 显式归零）。*/
  detachAudioSource(): void;
  /** synthetic / fail / interrupt 时强制 mouth 归零；与 detach 互斥
   *  （detach 是连接管理；silent 是行为）。*/
  silent(): void;
  /** 当前帧 wLipSync snapshot；surface useFrame 在 lipsync driver 入口拉取；
   *  无 active source / detached 状态返回 null（lipsync driver 收 null 走
   *  decay 路径）。*/
  snapshot(): WLipSyncSnapshot | null;
};
```

约束：

- `attachAudioSource` **必须**返回 Promise；同步实现是 contract 违反
- `silent()` 必须立即把后续 `snapshot()` 返回值 zero-out（直到下一次 attach）
- AudioConsumer 在 `BackendBranch.surface` mount 时通过 `onAudioConsumerReady`
  回调暴露给 carrier；carrier 把它注册到 `AudioPipeline.registerLipsyncSink`

### 2.5 BackendProjection

```ts
export type BackendProjection = {
  // ontology-level（agent script semantics）
  // 不携带 backend-specific identifier（Live2D parameter id 不在此层）
  applyActivity(input: { name: string; intensity: number | null }): void;
  applyEmotion(input: { current: string; previous: string | null }): void;
  applyMotion(input: { routeId: string; fade?: number; loop?: boolean }): void;
  applyExpression(input: { name: string; weight?: number; fade?: number }): void;
  reset(): void;
};
```

- `applyActivity / applyEmotion / applyMotion / applyExpression / reset` 是
  ontology-level method；name / routeId / emotion id 必须来自 platform
  `agent-activity-ontology.yaml`（K-AGCORE-049）或 Avatar-local generated
  motion/emote authority (`generated-motion-routes.yaml`,
  `vrm-emote-states.yaml`)
- **不允许** 任何方法携带 Live2D parameter id（如 `ParamMouthOpenY`）；
  parameter id 路径降级为 `Live2DBackendExtension.setParameter` escape hatch
- `routeId` is an Avatar backend route id and must not be interpreted as public
  APML syntax or runtime activity ontology ownership.

### 2.6 Live2DBackendExtension

```ts
export type Live2DBackendExtension = {
  /** Live2D-only internal backend channel used by carrier/sandbox
   *  projection translation. Creator-authored NAS handlers must use the
   *  authority-owned projection cue surface instead. */
  setParameter(id: string, value: number, durationSec?: number): void;
};
```

- `Live2DBackendExtension` 通过 `BackendBranch` kind narrowing 暴露
- NAS creator handler source must not call branch-local extension surfaces.
  `Live2DBackendExtension.setParameter` is used by carrier-owned projection
  translation for `setSignal` / `addSignal` and other admitted cue methods.

### 2.7 Surface

```ts
export type BackendSurfaceProps = {
  width: number;
  height: number;
  embodied: boolean;
  onHitRegionChange?: (region: BackendHitRegion) => void;
  onAudioConsumerReady?: (consumer: BackendAudioConsumer) => void;
  onLifecycleEvidence?: (kind: string, detail: Record<string, unknown>) => void;
};

export type BackendSurface = {
  Component: ComponentType<BackendSurfaceProps>;
};
```

- `BackendSurface.Component` 是 React component；embodiment-stage 直接 mount
- `onAudioConsumerReady` 在 surface mount 完成且 audio consumer 就绪时调用
  一次（surface unmount 时不再调）；carrier 在此回调内注册 lipsync sink
- `onHitRegionChange` 在每次 hit region snapshot 变化时调用（throttled by
  backend implementation; 推荐 100ms minimum interval, 详 `app-shell-contract.md`）
- `onLifecycleEvidence(kind, detail)` 上报 backend 级 lifecycle 证据
  （context_lost / context_restored / failed_closed / load_failed 等）

### 2.8 Metadata

```ts
export type BackendMetadata = Record<string, unknown>;
```

- `metadata()` method 返回 backend-specific descriptor（替代固定字段如
  `compatibility_tier` / `adapter_id` / `model_kind`）
- carrier 把 metadata 透传给 evidence event（如 `avatar.model.load`），
  不解释字段语义

### 2.9 BackendBranchBase + BackendBranch

```ts
export type BackendBranchBase = {
  nominalBounds: BackendNominalBounds;
  projection: BackendProjection;
  surface: BackendSurface;
  metadata(): BackendMetadata;
  shutdown(): void;
};

// kind narrowing 暴露 backend-specific extension（仅 live2d 有 extension）
export type BackendBranch =
  | (BackendBranchBase & { kind: 'live2d'; live2dExtension: Live2DBackendExtension })
  | (BackendBranchBase & { kind: 'vrm' })
  | (BackendBranchBase & { kind: 'nimi2d' });
```

- discriminated union 强制 typescript exhaustive check
- `live2dExtension` 仅当 `kind === 'live2d'` 暴露（kind narrowing）；VRM branch
  和 Nimi2D branch 不允许携带 `live2dExtension` 字段
- `shutdown()` 释放所有 backend resources（GL context / Three.js scene /
  Cubism instance / Nimi2D compositor / wLipSync node 等）

---

## 3. Carrier Wiring

### 3.1 createBackendBranch

```ts
async function createBackendBranch(model: ModelManifest): Promise<BackendBranch> {
  switch (model.kind) {
    case 'vrm':    return createVrmBackendBranch(model);
    case 'live2d': return createLive2DBackendBranch(model);
    case 'nimi2d': return createNimi2DBackendBranch(model);
  }
  // exhaustive check enforces fail-close on new kind:
  const _exhaustive: never = model.kind;
  throw new Error(`unhandled backend kind: ${_exhaustive}`);
}
```

`createBackendBranch` 是**唯一**允许出现 `kind` 分支的位置。

### 3.2 AvatarRuntimeCarrier

```ts
export type AvatarRuntimeCarrier = {
  model: ModelManifest;
  registry: HandlerRegistry;
  backend: BackendBranch;
  attachRuntimeDriver(driver: AgentDataDriver): Promise<void>;
  detachRuntimeDriver(): void;
  shutdown(): void;
};
```

carrier 不允许暴露 backend-specific 字段（如 `mouthSignalId`、
`live2dSession`）；任何 backend-specific 行为通过 `backend.live2dExtension`
（kind narrowed）或 NAS handler `requires` field 走。

---

## 4. Event Surface

`BackendBranch.surface.Component` 通过 `onLifecycleEvidence` callback emit 下列
evidence kinds（详 `avatar-event-contract.md`）：

| kind | 触发时机 |
|---|---|
| `context_lost` | WebGL/AudioContext 丢失（VRM webglcontextlost / Live2D Cubism context lost） |
| `context_restored` | 恢复成功（≤ 1500ms 单次重试） |
| `failed_closed` | 二次 context_lost 或 backend 不可恢复 |
| `load_failed` | model 加载失败（VRM `.vrm` 解析失败 / Live2D `.model3.json` parse fail） |
| `audio_pipeline_ready` | AudioContext + worklet 加载完成 |
| `audio_pipeline_failed` | wLipSync init / decode / fetch fail |

evidence kind 与 `avatar-event-contract.md` 命名 1:1 映射；surface
component 不允许 emit 未在 event-contract 列出的 kind。

---

## 5. Drift Check

- **kind 分支唯一性**：grep `apps/avatar/src/**` 中 `model.kind === '` /
  `backend.kind === '` 出现位置必须仅在 `createBackendBranch.ts` /
  carrier factory。其余代码命中即 drift。
- **parameter id 隔离**：`BackendProjection` method 不允许携带 Live2D
  parameter id；任何方法签名出现 `parameterId` / `parameter_id`/
  `ParamMouthOpenY` 字段即 drift。
- **AudioConsumer 完整性**：新 backend 必须实现 `attachAudioSource`（async）/
  `detachAudioSource` / `silent` / `snapshot` 4 method；缺一即 type error。
- **kind narrowing 强制**：`live2dExtension` 字段必须通过 discriminated
  union 暴露；不允许 VRM 或 Nimi2D branch 暴露此字段。
- **exhaustive switch**：`createBackendBranch` 对新 kind 必须强制 typecheck
  fail（`_exhaustive: never`）。
- **Nimi2D bounded admission**：`kind: 'nimi2d'` 只允许在 package manifest 和
  Avatar capability profile 均通过验证时返回真实 `BackendBranch`；缺失、
  无 default outfit、无 renderer binding、或 invalid input 必须 fail closed，
  不得返回 placeholder `BackendBranch`。

---

## 6. Evolution

- 新 backend kind（如 `'pixel-3d'` / `'lottie'`）→ minor bump + 同步
  `BackendKind` union + `createBackendBranch` switch + 新 `<kind>-backend-contract.md`
- 新 BackendProjection method → minor bump
- 改 BackendProjection method 语义 / 改 AudioConsumer signature → major bump
- 新 Live2DBackendExtension capability → minor bump + 同步 `agent-script-contract.md`
  允许的 `requires` 集合

---

<!-- source: .nimi/spec/avatar/kernel/app-shell-contract.md -->

# App Shell Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: active industrial baseline (supersedes retired small-button surface framing)
> **Sibling contracts**:
> - [Embodiment projection contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Live2D render contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Agent script contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Avatar event contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
>
> **First-Party Runtime Boundary**：
> 本 contract 约束默认 Nimi Avatar app。Avatar 是 Runtime-admitted local first-party Nimi app（default app id `nimi.avatar`），Desktop 启动时只传递 `agent_id`、optional `avatar_instance_id`、optional non-authoritative `launch_source`。Avatar 使用 Runtime account projection 与 Runtime-mediated Realm/service operations only；public `GetAccessToken` is a deny-all tombstone pending A.3d removal，first-party identity 不产生 bearer exception。它不得持有 access/refresh token、authorization header、durable auth session、shared auth truth、independent Realm auth truth、或 Avatar-local JWT subject truth。Desktop 不得把 scoped binding、visual package truth、conversation anchor truth、account/user truth、Realm/auth material 透传给默认 Avatar 启动路径。
>
> Explicit binding-only / embedded / delegated Avatar mode 仍可由 `K-BIND-*` admit，但它不是 Desktop-launched Avatar 的默认路径。
>
> **Surface Composition Admission**: this contract fixes the surface composition model as `embodiment-stage` / transient Avatar overlays / `degraded-surface`. The ready posture is embodiment-first: `embodiment-stage` is the only default visible ready surface. Text entry, settings, context menu, action radial, captions, and other controls are transient overlays opened by explicit user intent or Runtime presentation state. The retired small chat button path and permanent bottom companion bar remain forbidden; degraded posture remains isolated in `degraded-surface`.

---

## 0. 阅读指南

本 contract 定义 Nimi Avatar 桌面 shell 的 window、交互、surface composition 与 lifecycle 行为。Avatar 不是常规软件窗口，而是**桌面悬浮 embodiment surface**：形象即 UI，透明背景，无 chrome，always-on-top。Tauri 与 Electron 必须保持相同产品语义；Electron 默认路径由 verified Desktop process 监管并消费 Runtime `bundled_avatar_v1` protected carrier，不能直接启动独立 Electron host。shell 依赖 embodiment projection layer 提供 surface bounds / hit region，而不是直接拥有 backend truth。

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
| `degraded:cloud-offline` | Runtime-mediated Realm operation returns the explicit `REALM_UNAVAILABLE` transport classification | 仅 `degraded-surface`（L1 Cloud offline posture） |
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
- `degraded:cloud-offline` 只能由 Runtime-mediated Realm broker 明确返回 `source=realm`、`reason_code=REALM_UNAVAILABLE` 且 bootstrap stage 为 `realm_connectivity` 时进入；Runtime/account carrier unavailable、anonymous/reauth、permission、validation、contract、429 与其他 Realm application errors 不得映射为 Cloud offline

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

Precise schema lives in [avatar-event-contract.md](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml). Required event families:

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
1. Tauri window or Desktop-supervised Electron Avatar window created
2. Renderer bootstrap (React mount)
3. Emit avatar.app.start (composition state = loading)
4. Identify as fixed Runtime-admitted bundled first-party app (`nimi.avatar`); no `RegisterApp` call
5. Validate launch `agent_id` through Runtime / SDK authority
6. Prepare the SDK transport over the exact host-injected protected carrier; no token provider
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
- runtime bootstrap：Runtime account projection plus the fixed `bundled_avatar_v1` host-injected SDK transport; Avatar does not register an app or open a portable Runtime session
- protected access bootstrap：verified Desktop main/native code binds the exact Avatar renderer window to the fixed method/capability profile. Avatar renderer receives typed SDK responses only; it cannot request or hold a capability token, profile marker, endpoint, metadata, or scoped binding
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
| Lipsync timing / voice playback truth | — | `.nimi/spec/runtime/agent-participation.authority.yaml` |

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

> Upstream authority：`.nimi/spec/runtime/protected-session.authority.yaml`（`K-ACCSVC-*`）、`.nimi/spec/sdks/client-core.authority.yaml`（`S-RUNTIME-109` / `S-RUNTIME-110`）、`.nimi/spec/runtime/app-surface.authority.yaml`（explicit binding-only modes only）。

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
- 以 fixed `nimi.avatar` / `nimi.avatar.desktop-supervised` identity 识别为 Runtime-admitted bundled first-party app；不调用 `RegisterApp` / `OpenSession`
- 调用 Runtime account projection / event stream 与 admitted `InvokeRealmUnary` broker operation；Avatar 不拥有 login/logout/switch/refresh account-control UX
- default `nimi.avatar` 只能调用 independently admitted Runtime-mediated
  broker/service operations；registry 或 first-party posture 不得启用 public token RPC
- `runtime.agent` turns API 由 Runtime server-side evaluator、current account/Agent
  relation与 `bundled_avatar_v1` exact method profile 授权；默认路径不创建 grant、
  scoped binding 或 bearer provider
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

---

<!-- source: .nimi/spec/avatar/kernel/projection-backpressure-smoothing-contract.md -->

# Projection Backpressure Smoothing Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: active. This contract admits renderer-local signal smoothing and
> the reusable Kit Avatar headless helper consumed by the launched Avatar
> carrier.
> **Upstream authority**: Runtime PresentationTimeline (`K-AGCORE-051`) remains
> the owner of activity, speech, lipsync timing, cancellation, and turn
> ordering truth.

---

## AV-PROJ-SMOOTH-001: Scope

Avatar may consume `@nimiplatform/kit/features/avatar` headless smoothing for
renderer-local `EmbodimentProjectionApi.setSignal` and
`EmbodimentProjectionApi.addSignal` writes before they reach a backend command
surface.

This is a renderer hot-path pressure valve only. It is not a Runtime event
ordering layer and must not define activity order, terminal state, voice timing,
lipsync timing, or generated motion truth.

## AV-PROJ-SMOOTH-002: Signal-Only Smoothing

The smoothing layer may:

- coalesce repeated `setSignal(signalId, value, weight)` calls so the latest
  value for one `signalId` wins before the next renderer flush
- accumulate repeated `addSignal(signalId, delta)` calls for one `signalId`
- expose read-your-write behavior for `getSignal(signalId)` while a signal
  write is pending
- bound pending signal memory and force a renderer flush when the bound is hit

The smoothing layer must pass through these methods without coalescing their
meaning:

- `triggerMotion`
- `stopMotion`
- `setExpression`
- `clearExpression`
- `setPose`
- `clearPose`
- `wait`
- `getSurfaceBounds`
- `runDefaultActivity`

Before any pass-through method above runs, pending signal writes must flush so
renderer-local parameter changes preserve local call order.

## AV-PROJ-SMOOTH-003: No Runtime Semantics

The smoothing layer must not:

- create a second Runtime presentation timeline
- reorder or suppress `RuntimeAgentConsumeEvent` records
- own activity, expression, motion, speech, or lipsync success evidence
- interpret external-entry provenance or consent
- emit Avatar package, Desktop launch, or SDK readiness truth

## AV-PROJ-SMOOTH-004: Lifecycle

The smoothing handle is created by the Avatar carrier through the Kit Avatar
headless helper after backend materialization and before NAS/event/interaction
consumers attach. It must be disposed when the runtime driver detaches or the
carrier shuts down.

Disposal must flush pending signal writes before the backend branch is shut
down.

## AV-PROJ-SMOOTH-005: Verification

The guard `pnpm check:avatar-projection-no-cue-semantics` must prove:

- the contract exists and cites `K-AGCORE-051`
- implementation is limited to renderer-local signal writes, even when the
  helper lives under Kit Avatar headless
- motion/expression/pose/default activity methods are pass-through after a
  pending signal flush
- voice/lipsync modules are not part of the smoothing implementation
- no Avatar-local Runtime event scheduling surface is introduced

---

<!-- source: .nimi/spec/avatar/kernel/generated-motion-provider-contract.md -->

# Generated Motion Provider Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: Active Avatar generated motion provider authority
> **Sibling contracts**:
> - [Backend branch contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Embodiment projection contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [VRM backend contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Avatar event contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)

---

## 0. Purpose

This contract admits the Avatar-owned generated motion provider line downstream
of typed runtime projection. It replaces physical `.vrma` files as the runtime
proof path for APML-driven Avatar motion support.

The public APML wire remains runtime-owned. Avatar must consume only typed
`runtime.agent.*` projection delivered through the SDK/runtime app surface.
Avatar must not subscribe to raw `apml.*` parser events or define APML syntax.

## 1. Authority Boundary

Runtime owns:

- APML parsing and validation in
  `.nimi/spec/runtime/agent-participation.authority.yaml`
- typed presentation and state projection in
  `.nimi/spec/runtime/agent-participation.authority.yaml`
- activity ids and categories in
  `.nimi/spec/runtime/agent-participation.authority.yaml`

Avatar owns:

- backend route ids in `tables/generated-motion-routes.yaml`
- backend capability profile schema in
  `tables/backend-capability-profile.schema.yaml`
- mapping sidecar schema and confidence semantics in
  `tables/mapping-sidecar.schema.yaml`
- provider execution semantics in this contract

Avatar-owned route ids are backend projection ids. They are not public APML tags
and are not runtime activity ontology ids.

`@nimiplatform/kit/features/avatar/vrm` may expose pure route/protocol types
for these ids so consuming code does not re-declare the provider surface.
Concrete VRM provider generation, Three.js mixer runtime, capability probing,
and model-instance execution remain launched Avatar backend implementation
unless a separate backend renderer seam is admitted.

## 2. Non-Admitted Public Syntax

This contract does not admit direct public APML tags for:

- `<motion>`
- `<expression>`
- `<lookat>`
- `<pose>`
- `<clear-pose>`

Those names may appear only as typed runtime projection event families or
Avatar-local backend concepts after runtime validation. Public model-facing APML
continues to use the syntax admitted by the runtime wire contract, including
`<activity>` and `<emotion>`.

## 3. Provider Input

The generated motion provider input is:

```ts
type GeneratedMotionProviderInput = {
  projection:
    | RuntimeAgentPresentationActivityRequested
    | RuntimeAgentPresentationMotionRequested
    | RuntimeAgentPresentationExpressionRequested
    | RuntimeAgentPresentationPoseRequested
    | RuntimeAgentPresentationLookatRequested
    | RuntimeAgentStateEmotionChanged
    | RuntimeAgentStatePostureChanged;
  avatarRouteId: string;
  backendKind: 'vrm' | 'live2d' | string;
  capabilityProfileRef: string;
  mappingSidecarRef: string | null;
};
```

Rules:

- `projection` must come from an admitted `runtime.agent.presentation.*` or
  `runtime.agent.state.*` event. Raw `apml.*` parser diagnostics are invalid
  provider input.
- `avatarRouteId` must resolve in `tables/generated-motion-routes.yaml`.
- `capabilityProfileRef` must validate against
  `tables/backend-capability-profile.schema.yaml`.
- `mappingSidecarRef`, when present, must validate against
  `tables/mapping-sidecar.schema.yaml`.

## 4. Provider Output

The provider returns either executable backend output or fail-closed evidence:

```ts
type GeneratedMotionProviderResult =
  | {
      status: 'ok';
      backendKind: 'vrm';
      clip: THREE.AnimationClip;
      routeId: string;
      evidence: GeneratedMotionEvidence;
    }
  | {
      status: 'fail_closed';
      routeId: string;
      reasonCode:
        | 'unsupported_capability'
        | 'unsafe_pose'
        | 'mapping_confidence_below_threshold'
        | 'mapping_unconfirmed'
        | 'missing_profile'
        | 'missing_route'
        | 'invalid_runtime_projection';
      evidence: GeneratedMotionEvidence;
    };
```

There is no neutral-success fallback. Returning idle output for an unsupported
non-idle route is a contract violation.

## 5. Capability Profile

Capability profiles describe what a loaded backend/model can safely execute.
They are model/backend facts, not semantic truth. The profile may name bones,
expressions, blendshapes, look-at support, pose limits, and route-level support,
but it must not introduce APML ids or runtime activity ids as owner truth.

The schema target is
`tables/backend-capability-profile.schema.yaml`. VRM is the first backend
implementation target; the envelope is backend-agnostic so Live2D and future
carriers can add backend sections without moving authority. Nimi2D live-action
lane support is governed by `nimi2d-backend-contract.md` and
`tables/nimi2d-backend-capability-profile.schema.yaml`; it must not be counted
as VRM deterministic `THREE.AnimationClip` provider support.

## 6. Mapping Confidence

LLM or heuristic mapping output is admitted only as sidecar evidence. It may
match model-specific names to Avatar backend routes, expressions, or bones. The
sidecar must carry `target_fields` for the backend/model-specific names it
claims. Avatar validates those fields against a matching capability profile
before they can support a route.

Avatar does not own direct LLM provider/model execution for mapping generation
under this contract. LLM-assisted mappings enter as mapping-only sidecar input through
an already-authorized external/runtime path; Avatar runtime code must not
hardcode a provider, model, prompt transport, or app-local REST call to produce
them.

The sidecar must not emit keyframe curves, rotations, durations, easing
functions, or other motion math.

Mapping confidence rules:

- `confidence` is a number from `0` to `1`.
- `threshold` is route-specific or defaults to the schema threshold.
- `confidence < threshold` fails closed.
- mappings produced by LLM require `manual_confirmation: confirmed` unless a
  later packet admits an automated evidence class for that backend.
- evidence must name the observed source fields used to justify the mapping.
- `target_fields` must match backend capability profile evidence; otherwise the
  route is unsupported for that model/profile and fails closed.

## 7. Deterministic Motion Math

Deterministic provider code owns all keyframe generation. A VRM provider must
apply route-specific duration bounds, easing, humanoid joint clamps, and blend
limits before returning an executable `THREE.AnimationClip`.

Generated clips must be reproducible from:

1. typed runtime projection
2. Avatar route id
3. validated capability profile
4. validated mapping sidecar
5. deterministic provider version

## 8. `.vrma` Position

`.vrma` is interchange/authoring evidence only. It is not required runtime
proof for APML auto-adapter support and must not be used as the closure gate for
generated motion support.

Avatar may later export generated clips to `.vrma` under a separate interchange
authority. That export path must not become a dual runtime dependency.

## 9. Initial Route Set

This contract admits the following Avatar backend route ids as provider
targets:

- `idle_subtle`
- `listen_lean`
- `nod_yes`
- `shake_no`
- `greet_wave`

Their source mapping is recorded in `tables/generated-motion-routes.yaml`.
These ids are Avatar backend route ids only.

## 10. Validation Gates

Implementation and release gates must prove:

- no Avatar product path consumes APML raw parser diagnostics
- no retired app-local Avatar authority root exists
- no public APML motion/expression/lookat/pose/clear-pose syntax is admitted
- no Avatar-local ontology shadows runtime activity ids
- no `.vrma` file presence is required as APML runtime support proof
- generated provider failure states remain fail-closed

## 11. Supersession

This contract supersedes the `.vrma` runtime asset close gate recorded by
`2026-04-30-avatar-vrm-backend-branch` for APML auto-adapter support. Existing
`.vrma` assets may remain as interchange-only evidence until the replacement
implementation is hard-cut, but they are not canonical runtime proof for this
contract.

---

<!-- source: .nimi/spec/avatar/kernel/kit-ui-consumption-contract.md -->

# Avatar Kit UI Consumption Contract

> Authority: Avatar-local consumption of `@nimiplatform/kit`.
> Upstream foundation: `.nimi/spec/platform/ui-design-system.authority.yaml`.

## K-NAV-KIT-UI-001 — Local Ownership

Avatar is a first-party app and consumes the shared Nimi design system as a downstream product surface. Concrete Avatar adoption rows, retained Avatar-owned compositions, and Avatar hard-cut exceptions live only in `config/avatar-nimi-kit-*.yaml`.

Platform design authority may define shared primitives, token taxonomy, material tiers, theme-pack schema, and generic app integration rules. It must not list Avatar renderer modules, Avatar component inventories, Avatar token exceptions, or Avatar consumption progress.

## K-NAV-KIT-UI-002 — Shared Theme Contract

Avatar shell entrypoints consume:

- `@nimiplatform/kit/ui/styles.css`
- `@nimiplatform/kit/ui/themes/light.css`
- `@nimiplatform/kit/ui/themes/dark.css`
- `@nimiplatform/kit/ui/themes/nimi-accent.css`

Avatar does not own an app-specific accent pack in this contract. It uses the shared `nimi-accent` pack unless a later Avatar-local spec change admits an Avatar accent pack under `.nimi/spec/platform/ui-design-system.authority.yaml`.

## K-NAV-KIT-UI-003 — Shell Surface Scope

Avatar governed shell surfaces are the React renderer entrypoint, top-level shell, embodiment stage, companion surface, and degraded surface. Backend rendering internals under `live2d/**`, `vrm/**`, audio, NAS, and runtime carrier code are not shared UI primitive surfaces unless they render shell-level controls.

Avatar-owned compositions may preserve product-form behavior specific to a transparent floating embodiment surface, but they must consume shared theme tokens and shared primitives for actions, fields, overlays, status, and glass material where the toolkit provides coverage.

## K-NAV-KIT-UI-004 — Token Hard Cut

Avatar renderer styles must not define a parallel root design token registry. Historical `app-shell/tokens.css` values are downstream drift once this contract is active; the hard cut is to replace them with `--nimi-*` semantic tokens and toolkit primitives, not to promote Avatar token values into platform truth.

## Fact Sources

- `tables/nimi-kit-adoption.yaml`
- `tables/nimi-kit-compositions.yaml`

---

<!-- source: .nimi/spec/avatar/kernel/live2d-render-contract.md -->

# Live2D Render Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: Active `kind: 'live2d'` BackendBranch implementation authority.
> **Sibling contracts**:
> - [Backend branch contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml) — multi-backend carrier abstraction
> - [VRM backend contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Embodiment projection contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Live2D asset compatibility contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [App shell contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Agent script contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Avatar event contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)

---

## Scope

This contract is the `kind: 'live2d'` BackendBranch implementation detail.
Multi-backend carrier abstraction, BackendProjection ontology surface,
BackendAudioConsumer wLipSync pipeline, BackendHitRegion, BackendNominalBounds,
and BackendSurface lifecycle live in
[`backend-branch-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml).

This contract **does not** define the carrier-public contract; it defines how
the Live2D branch implements `BackendBranch` using Cubism SDK for Web. Other
backend branches (VRM in `vrm-backend-contract.md`, future 3D / robot) implement
the same `BackendBranch` interface with their own contracts.

Cross-references:

- BackendProjection ontology methods (`applyActivity` / `applyEmotion` /
  `applyMotion` / `applyExpression`) → ontology naming admit by
  `embodiment-projection-contract.md` and `tables/activity-mapping.yaml`
- Live2D parameter-id direct write → carrier-owned
  `Live2DBackendExtension.setParameter` translation from admitted projection
  cue methods; NAS creator handlers must not call branch-local extensions.
- wLipSync audio pipeline → `audio-pipeline.ts` consumes
  `runtime.artifacts.readBytes` (S-RUNTIME-111); Live2D lipsync driver writes
  `ParamMouthOpenY` (+ optional `ParamMouthForm` per
  `live2d-asset-compatibility-contract.md` tier check)

---

## 0. 阅读指南

本 contract 定义 Nimi Avatar Live2D backend branch 的 Cubism SDK for Web 官方
集成边界、model loading、motion / expression / physics / parameter API、
backend command-state update、NAS continuous handler 帧调度、默认 Cubism 行为
（breath / blink / lipsync）与 NAS override 边界。

Current Avatar app evidence proves Live2D model/resource loading, command-state mutation, Cubism `model.update()`, and NAS continuous scheduling. It does **not** claim Avatar carrier WebGL canvas draw-loop proof. Desktop chat has a separate Cubism WebGL renderer; that implementation cannot be used as active proof for this Avatar app carrier branch.

**本 contract 不定义** embodiment projection canonical truth（见 `embodiment-projection-contract.md`）、NAS handler convention（见 `agent-script-contract.md`）或 shell / window 行为（见 `app-shell-contract.md`）。

---

## 1. SDK Integration Boundary

## K-NAV-L2D-001 Cubism SDK for Web 使用方式

- **不 fork** Cubism SDK
- 通过官方 `@live2d/cubism-framework` + native `Live2DCubismCore.js` 依赖接入
- Avatar-local code only wraps the SDK boundary for model management,
  parameter dispatch, and NAS API binding.

### 1.2 License & Distribution

- Live2D Cubism SDK 按 Live2D Inc. 官方 license 使用
- App bundle **仅包含** Cubism runtime binary（`Live2DCubismCore.js`）
- **不 redistribute** 任何 Live2D 官方 sample models
- Model creators 各自负责其 model 的分发授权

### 1.3 SDK Layer 组件

| Layer | 职责 | 位置 |
|---|---|---|
| Cubism Core (binary) | MOC3 binary runtime | Live2D 官方 |
| Cubism Framework | Motion / expression / physics / parameter runtime | 官方 npm |
| `Live2DBackendSession` (app) | Model lifecycle / Cubism model update / command-state execution | `src/shell/renderer/live2d/backend-session.ts` |
| `Live2DPluginAPI` (app) | current Live2D branch implementation of embodiment projection API + branch-owned default activity fallback | `src/shell/renderer/live2d/plugin-api.ts` |

---

## 2. Model Loading

## K-NAV-L2D-002 Loading Entry Point

Avatar app 接收 `model_path`（来自 `avatar.app.start.detail.model_path` 或 default config）：

```
1. 解析 <model>/runtime/ 目录（若 path 指向 package 顶层，locate runtime/ 子目录）
2. Glob runtime/*.model3.json，取第一个匹配（单 model per package 假设）
3. Parse model3.json，提取 references（moc3 / textures / motions / expressions / physics / pose / cdi）
4. 按官方 SDK API 加载 MOC3 / textures → create Cubism model instance
5. 若存在 physics3.json / pose3.json / cdi3.json → 自动 attach
6. 若存在 motions/*.motion3.json → 注册到 motion manager（group 名从 model3.json `Groups` / `FileReferences.Motions` 读）
7. 若存在 expressions/*.exp3.json → 注册到 expression manager
8. 若存在 `nas-package://runtime/nimi/` → 触发 NAS handler discovery（见 agent-script-contract §10）
9. 若存在 `nas-package://runtime/nimi/config.json` → 应用 feature flags
10. Compute model bounds → emit avatar.model.load + 通知 shell 调整 window
```

Existing-asset adaptation is governed by
[`live2d-asset-compatibility-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml).
The loader may consume an Avatar-owned adapter manifest only through that
contract's explicit manifest sources. It must not silently rewrite upstream
Cubism assets or treat arbitrary Live2D package loading as semantic companion
support.

## K-NAV-L2D-003 Model-ID 推断

`model_id` = `*.model3.json` 文件名去掉 `.model3.json` 后缀。

| File | model_id |
|---|---|
| `ren.model3.json` | `ren` |
| `cute-avatar.model3.json` | `cute-avatar` |

## K-NAV-L2D-004 Model Lifecycle

| Op | 条件 | 事件 |
|---|---|---|
| Load | App 启动 / user pick model | `avatar.model.load` |
| Switch | User 切换 model | 先 unload 旧 model → emit `avatar.model.switch` → load 新 model |
| Unload | App 关闭 / 切 model | 释放 Cubism resources + textures + WebGL buffers |

### 2.4 Loading Failure (Fail-Close)

| Failure | Action |
|---|---|
| `runtime/` 不存在 | 显示 error UI "Model runtime folder missing"；不启动 render loop |
| `*.model3.json` 不存在 / invalid | 显示 error UI "Invalid model package"；不启动 |
| MOC3 binary parse fail | 同上 |
| Texture load fail | Partial load（显示 fallback material + warn） |

无静默 fallback，不加载 placeholder model。

---

## 3. Backend Frame Loop

## K-NAV-L2D-005 Frame Cadence

- NAS continuous scheduler 运行于 `requestAnimationFrame`，目标 60fps（浏览器 vsync）
- Current Avatar app backend-session applies commands and calls Cubism `model.update()` when command-state changes.
- Avatar carrier WebGL `preDraw` / `draw` / `postDraw` proof is not admitted by the current Live2D branch evidence. A visual-render acceptance authority must add deterministic canvas proof before this contract may claim Avatar carrier draw-loop closure.

### 3.2 Delta Time

- 传给 Cubism 的 `deltaTime` 来自 `performance.now()` 差值
- Tab visibility: Tab hidden 时 rAF pause，resume 时 deltaTime 不堆积（clamp to 100ms）

---

## 4. NAS Continuous Handler Frame Sync

## K-NAV-L2D-006 调度规则

Continuous handler 在 Avatar app frame scheduler 内按声明 fps 调度：

```
For each continuous handler h:
  interval = 1000 / h.fps
  if (now - h.lastRunAt) >= interval:
    try { h.update(ctx, live2d) } catch (e) { log; skip }
    h.lastRunAt = now
```

- 所有 continuous handlers 在同一 scheduler tick 内按顺序调用；current backend command-state changes are applied through the projection API.
- 多 handler 并行：同帧内按 filename 字典序顺序调用
- Handler 写的 `setParameter` 立即更新 backend command-state and Cubism model update path.

### 4.2 Frame Budget

- 单个 continuous handler 预算：`1000 / fps * 0.5` ms
- 超预算 → `console.warn` + skip 下一帧（不禁用 handler）
- 连续 10 帧超预算 → emit `avatar.model.handler.throttled` event (not implemented by the current Live2D branch; this event remains blocked until frame-budget enforcement lands)

---

## K-NAV-L2D-007 Motion System

### 5.1 Motion Group 命名 Convention

Live2D branch 默认 activity fallback 查的 motion group 名：`Activity_<CamelCase>`（见 `tables/activity-mapping.yaml`），并按 intensity 追加 `_Weak` / `_Strong` 后缀。这是 branch-owned fallback，不属于 neutral NAS baseline。

| Activity id | Motion group | Scope |
|---|---|---|
| `happy` | `Activity_Happy` | core emotion |
| `ext:grateful` | `Activity_ExtGrateful` | extended |
| `ext:proud` | `Activity_ExtProud` | extended |

### 5.2 Motion Priority

三档：`low` / `normal` / `high`（映射到 Cubism `CubismMotionPriority`）：

| Priority | 语义 | Cubism |
|---|---|---|
| `low` | 可被 normal/high 打断 | `PRIORITY_IDLE` |
| `normal` (default) | 可被 high 打断 | `PRIORITY_NORMAL` |
| `high` | 覆盖一切（包括当前 high） | `PRIORITY_FORCE` |

### 5.3 Default Idle Motion

`nas-package://runtime/nimi/config.json` 的 `default_idle_motion`（default `"Idle"`）：

- 无 activity / event 驱动时，每 5 秒随机播一次 idle motion group 内的 motion
- 由 Cubism 官方 idle motion selector 实现（`CubismMotionManager.startMotion(..., priority=PRIORITY_IDLE)`）

---

## K-NAV-L2D-008 Expression System

### 6.1 Expression Stack v2

Cubism `exp3.json` expression files are parsed into an Avatar-owned expression
inventory during Live2D backend-session creation. The inventory is backend
evidence and debug/configuration metadata only; it is not Avatar Appearance UI,
Runtime emotion ontology, or raw LLM tool surface.

Each inventory entry admits only:

- model-local expression id from `FileReferences.Expressions[].Name`
- source ref path
- parameter ids
- normalized blend modes: `Add`, `Multiply`, `Overwrite`
- parameter counts and blend-mode counts

The raw `exp3.json` payload, model package path, and provider/NAS/runtime
payloads MUST NOT be exposed through metadata or debug evidence.

### 6.2 Parameter Overlay Semantics

The active expression is single-valued. `setExpression(id)` activates one
model-local expression id. `clearExpression()` deactivates it.

For each active expression frame, Avatar applies parsed `exp3.json`
parameters deterministically:

| Blend | Semantics |
|---|---|
| `Add` | add expression value to the current Cubism parameter value |
| `Multiply` | multiply the current Cubism parameter value by expression value |
| `Overwrite` | set the Cubism parameter value to expression value |

Unknown blend modes, malformed parameters, missing expression files, or
semantic mappings that point to expressions absent from the inventory are
fail-closed unsupported/failed backend evidence. They must not be counted as
idle fallback success.

### 6.3 Active-to-Inactive Reset

When an expression is cleared or replaced, parameters touched only by the
previous expression are reset to the loaded model default value before the next
active expression overlay is applied. Reset must use Cubism model default
parameter data; guessing defaults or leaving stale values is not admitted.

### 6.4 Parameter Lane Position

The admitted Live2D carrier frame applies Cubism and Avatar-local parameter
sources through a deterministic lane scheduler:

```
1. Cubism motion manager, including motion-owned eye blink/lip-sync effect ids
2. Avatar-owned expression stack v2 overlay
3. Cubism physics where present
4. Cubism pose where present
5. Cubism breath / blink where present
6. Avatar local look-at / idle-life lane for admitted avatar runtime behaviors
7. Avatar speech/lipsync parameter writes
8. Live2DBackendExtension direct parameter writes
```

Motion and expression lanes MUST NOT overwrite later mouth/lipsync writes in the
same frame. Direct parameter writes remain the final explicit escape hatch and
must not be projected through neutral `BackendProjection`.

The scheduler may emit bounded diagnostic summaries:

- lane order;
- applied lane ids;
- total lane elapsed milliseconds;
- unsupported parameter id count;
- speech/lipsync and direct parameter counts.

It must not expose raw backend commands, raw model payloads, or parameter values
as diagnostic truth.

---

## 7. Physics & Auto Behaviors

## K-NAV-L2D-009 Physics

- 若 `physics3.json` 存在 → Cubism 官方 physics 自动应用（breath, cloth, hair swing 等）
- Handler 不直接控制 physics（v1 scope out；future API）
- Avatar app 提供 `window drag` 时 emit `avatar.user.drag.move` → NAS continuous handler 可读 cursor velocity 驱动 body sway（通过 setParameter）

### 7.2 Auto Breath

- Cubism 默认 breath 算法启用（`CubismBreath`）
- 若 model 提供 `ParamBreath` → 默认 breath curve 作用
- NAS handler `setParameter("ParamBreath", v)` **覆盖**默认 breath（同帧后应用优先）

### 7.3 Auto Blink

- Cubism 默认 blink 启用（`CubismEyeBlink`），间隔 2-5 秒随机
- Model 需声明 `Eyes` group（`ParamEyeLOpen` / `ParamEyeROpen`）
- NAS handler setParameter 同样覆盖

### 7.4 Avatar Look-at / Idle Life

Avatar-local look-at and idle-life behavior is admitted only as presentation.
It must not create Runtime conversation turns, wake/listening truth, foreground
speaker arbitration, or Desktop calibration truth.

The Live2D carrier may write only the standard eye parameters it can prove are
present on the loaded model:

- gaze: `ParamEyeBallX` and `ParamEyeBallY` must both be present.
- blink: `ParamEyeLOpen` and `ParamEyeROpen` must both be present.

If the compatible parameter pair is absent, the look-at / idle-life lane is a
diagnostic no-op with a bounded reason code such as
`eye_parameters_missing` or `eye_parameters_partial`. It must not guess
parameter ids, expose raw model payloads, or record success evidence.

The admitted inputs are Avatar-local pointer/focus state and shell actions such
as `Look at me` / foreground-priority feedback. Cursor-to-surface mapping must
be bounded to the current Avatar carrier surface; transparent hit-region misses
must not drive look-at, click, drag, or radial actions.

The `look_at_idle` lane runs after Cubism breath/blink and before
speech/lipsync and direct `Live2DBackendExtension` writes, so explicit mouth or
direct parameter writes remain protected.

## K-NAV-L2D-013 Auto Lipsync

- Auto lipsync is admitted only through runtime-owned PresentationTimeline
  truth (`K-AGCORE-051`) plus Avatar-owned voice adapter / mouth parameter
  execution.
- Input must be provider-neutral voice timing or audio-level evidence bound to
  the same `agent_id`, `conversation_anchor_id`, `turn_id`, and `stream_id` as
  the runtime projection.
- The Live2D branch maps computed mouth openness to `ParamMouthOpenY` through
  Cubism parameter APIs.
- A successful lipsync proof must show non-placeholder computed frames and real
  `ParamMouthOpenY` mutation on the loaded model.
- Constant mouth-open values, event-name-only tests, fixture-only audio, or
  Desktop renderer evidence cannot close this branch.
- Interrupt/cancel must stop further mouth parameter writes for the interrupted
  stream and restore the branch to idle/default mouth behavior.

---

## 8. Parameter API

## K-NAV-L2D-010 Direct Parameter Access

The Live2D backend branch exposes only the Avatar-local direct parameter escape
hatch:

```typescript
Live2DBackendExtension.setParameter(id: string, value: number, durationSec?: number): void;
```

- `id` 用 Cubism 官方 parameter id（如 `ParamEyeBallX` / `ParamAngleX` / `ParamBreath`）
- The direct write is available only to admitted Avatar-local carrier code and
  sandbox projection translation, not creator-authored NAS handler source.
- Neutral `BackendProjection` must not contain backend-specific parameter ids.
- 未声明 / unsupported parameter id → `console.warn` + no-op; no success
  evidence may be created for that write.

### 8.2 Parameter Apply Order

同帧内多 source 改同 parameter 的 resolve 顺序：

```
1. Motion manager (current playing motion)
2. Avatar expression stack v2 overlay
3. Physics
4. Pose
5. Auto breath / blink
6. Avatar look-at / idle-life lane when admitted
7. Speech/lipsync parameter writes
8. Live2DBackendExtension direct parameter writes
```

最后生效的值写入 MOC3. NAS continuous/activity/event handlers may request
signal changes only through the authority-owned projection cue surface; the
sandbox/carrier translates admitted cue writes into the final direct parameter
lane before it receives the current Avatar-local command-state snapshot.

## K-NAV-L2D-011 Pose System

`setPose(group, loop)` 持续设置某 motion group 作为 "durable pose"：

- Pose 优先级高于 motion（pose active 时 motion 不覆盖 pose-controlled params）
- `clearPose()` 清除 pose，motion 恢复控制
- Pose motion 可 loop（default `false`）

---

## 9. Hit Testing (for Avatar Shell)

## K-NAV-L2D-012 Model Hit Region

Avatar shell 调用 renderer 获取当前帧 hit region：

```typescript
renderer.computeHitRegion(): {
  bounds: { x, y, width, height };
  mask: Uint8Array;    // alpha > threshold at each pixel
}
```

- `threshold` = 0.5（>0.5 视为 hit）
- Mask resolution = window resolution

### 9.2 Named Hit Areas

Cubism model3.json 可声明 `HitAreas`（如 `head` / `body` / `face`）。Renderer 提供：

```typescript
renderer.hitTestArea(x: number, y: number): string | null;
// returns "head" | "body" | "face" | null
```

Avatar shell 在 click 时 call `hitTestArea` 填入 `avatar.user.click.detail.region`。

---

## 10. Resource Management

### 10.1 Asset Loading

- Textures: 按 `<name>.<resolution>/` 子目录 load，选匹配当前 DPR 的 resolution
- Motions: lazy load on first play（缓存后重用）
- Expressions: eager load all（数量小）

### 10.2 Memory

- Model unload 时释放所有 GPU textures + Cubism instance
- WebGL context lost → attempt re-acquire + reload model；失败 → error UI

---

## 11. Boundary with Other Contracts

| Concern | This contract | Other |
|---|---|---|
| Cubism SDK 集成 / loading / rendering loop | ✅ | — |
| NAS handler 内部逻辑 / convention / sandbox | — | `agent-script-contract.md` |
| Window / drag / click-through / hit region apply | — | `app-shell-contract.md` |
| Mock data driving activity events | — | `mock-fixture-contract.md` |
| Activity → motion group 命名规则 | 消费 | `tables/activity-mapping.yaml` |

---

## 12. Evolution

- 新增 v2 API（physics / lipsync / drag / blend）→ `agent-script-contract.md` §6 同步 minor bump
- 改 rendering loop 时序 → major bump
- 支持 VRM / 3D backend → new contract `render-backend-contract.md`，本 contract 转为 Live2D-specific 分支

---

**Current Live2D branch scope**: Cubism SDK for Web 集成 + Plugin API v1，voice-driven lipsync 通过已 admit 的 voice/lipsync authority 接入；multi-backend 抽象已由 BackendBranch + VRM branch authority 接管。

---

<!-- source: .nimi/spec/avatar/kernel/live2d-asset-compatibility-contract.md -->

# Live2D Asset Compatibility Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: Active contract for existing Live2D asset adaptation
> **Sibling contracts**:
> - [Live2D render contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Carrier visual acceptance contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Agent script contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Embodiment projection contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)

---

## 0. Reading Guide

This contract defines how Nimi Avatar adapts existing Live2D Cubism packages
without claiming arbitrary model support. It governs compatibility tiers, the
Avatar-owned adapter manifest, semantic mapping, validation diagnostics, legal
fixtures, and Avatar carrier acceptance.

The markdown contract and its machine-readable tables are a single Avatar
authority surface. The tier requirements live in
[`tables/live2d-compatibility-tiers.yaml`](tables/live2d-compatibility-tiers.yaml),
the manifest schema lives in
[`tables/live2d-adapter-manifest.schema.yaml`](tables/live2d-adapter-manifest.schema.yaml),
and the diagnostic code registry lives in
[`tables/live2d-adapter-diagnostics.yaml`](tables/live2d-adapter-diagnostics.yaml).

This contract does not redefine Runtime/SDK agent semantics. Runtime and SDK
continue to own activity, emotion, posture, turn, and timeline truth. Avatar
owns only the Avatar-local mapping from those semantics into a model-local Live2D
package.

## 1. Non-Negotiable Rules

- Existing upstream asset packages are read-only unless a human explicitly
  chooses to create a new derivative package.
- No test or loader path may silently rewrite `model3.json`, motion files,
  expressions, textures, physics, pose, or hit-area declarations.
- No package is "supported" without a computed compatibility tier and explicit
  feature dispositions.
- Missing motions, expressions, pose, lip-sync ids, physics, or hit regions are
  not success states. They are either lower-tier explicit dispositions or
  fail-closed diagnostics.
- Unauthorized Live2D sample models or third-party assets must not be committed
  or redistributed.
- Desktop renderer evidence never closes Avatar carrier compatibility proof.

## 2. Compatibility Tiers

Compatibility is computed by Avatar validation. A manifest may request a tier,
but the validator must return the highest tier actually proven.

| Tier | Name | Meaning | Product claim |
| --- | --- | --- | --- |
| `unsupported` | Unsupported | The package or manifest violates mandatory layout, license, schema, or claimed-feature checks. | Must not load as success. |
| `render_only` | Render Only | Official Cubism runtime package loads and can render in the Avatar carrier, but no semantic activity/expression/pose/lipsync support is promised. | "Renders as a Live2D model only." |
| `semantic_basic` | Semantic Basic | Manifest maps required basic companion semantics and explicitly dispositions optional features. | "Works as a basic companion with bounded degraded features." |
| `companion_complete` | Companion Complete | Manifest maps the full current Avatar core activity set, expression/pose/lipsync/hit-region expectations, and optional physics without unsupported current-scope gaps. | "Complete current Live2D companion behavior for the active Avatar carrier." |

Tier requirements are listed in
[`tables/live2d-compatibility-tiers.yaml`](tables/live2d-compatibility-tiers.yaml).

## 3. Adapter Manifest

### 3.1 Manifest Identity

The manifest kind is:

```json
{
  "manifest_kind": "nimi.avatar.live2d.adapter",
  "schema_version": 1
}
```

The manifest is Avatar Avatar authority. It maps an existing Live2D package
to Avatar carrier expectations; it is not a Runtime, SDK, Desktop, NAS, or
platform event contract.

### 3.2 Manifest Locations

Avatar may load an adapter manifest from exactly one explicit source:

| Source | Path | Mutates upstream package | Use |
| --- | --- | --- | --- |
| embedded creator manifest | `<model-pkg>/runtime/nimi/live2d-adapter.json` | No, when shipped by the creator as part of the package | First-party or creator-authored Nimi-ready packages. |
| external sidecar manifest | Host-local Avatar adapter store, selected explicitly by import/launch context | No | Adapting existing packages without changing upstream files. |

If both are present, launch/import context must select one. Avatar must not merge
manifests or silently prefer one over the other.

### 3.3 Required Fields

The normative machine-readable v1 manifest schema is
[`tables/live2d-adapter-manifest.schema.yaml`](tables/live2d-adapter-manifest.schema.yaml).
The TypeScript shape below is an explanatory projection of that closed schema,
not a separate app-local manifest authority.

```typescript
type Live2DAdapterManifestV1 = {
  manifest_kind: 'nimi.avatar.live2d.adapter';
  schema_version: 1;
  adapter_id: string;
  target_model: {
    model_id: string;
    model3: string | 'auto';
    expected_runtime_digest?: string;
  };
  license: {
    redistribution: 'allowed' | 'forbidden' | 'unknown';
    evidence: string;
    fixture_use: 'committable' | 'operator_local_only' | 'not_allowed';
  };
  compatibility: {
    requested_tier: 'render_only' | 'semantic_basic' | 'companion_complete';
  };
  semantics: Live2DSemanticMapV1;
};
```

`adapter_id` is stable within the adapter store. `target_model.model_id` must
match the resolved `*.model3.json` filename unless the manifest is explicitly
declared as `model3: "auto"` and validation finds exactly one model entry.

### 3.4 Semantic Map

```typescript
type FeatureDisposition =
  | { status: 'supported'; reason?: string }
  | { status: 'unsupported'; reason: string }
  | { status: 'not_applicable'; reason: string };

type Live2DSemanticMapV1 = {
  motions: {
    idle: { group: string };
    activities?: Record<string, {
      group?: string;
      weak_group?: string;
      strong_group?: string;
      disposition?: FeatureDisposition;
    }>;
    missing_activity: 'diagnostic_no_success' | 'idle_degraded_with_diagnostic';
  };
  expressions: {
    map?: Record<string, string>;
    disposition: FeatureDisposition;
  };
  poses: {
    map?: Record<string, string>;
    disposition: FeatureDisposition;
  };
  lipsync: {
    mouth_open_y_parameter?: string;
    /** Whether the model declares ParamMouthForm. Driver writes both
     *  ParamMouthOpenY and ParamMouthForm when 'supported'; falls back to
     *  OpenY-only when 'absent'. */
    paramMouthForm?: 'supported' | 'absent';
    disposition: FeatureDisposition;
  };
  physics: {
    mode: 'model_physics' | 'absent' | 'unsupported';
    disposition: FeatureDisposition;
  };
  hit_regions: {
    map?: {
      head?: string[];
      face?: string[];
      body?: string[];
      accessory?: string[];
    };
    fallback: 'alpha_mask_only' | 'fail_closed';
    disposition: FeatureDisposition;
  };
  nas_fallback: {
    default_idle_motion: string;
    missing_handler: 'backend_default_with_diagnostic' | 'no_default';
  };
};
```

All activity keys use active Runtime activity ids consumed through Avatar
projection. They do not create new Runtime ontology truth.

## 4. Validation Rules

The validator must fail closed with structured diagnostics when:

- manifest JSON is missing, malformed, or has an unsupported
  `manifest_kind/schema_version`;
- `target_model.model_id` does not match the resolved package model id;
- `target_model.expected_runtime_digest` is present and does not match;
- license posture is `unknown` for committable fixtures;
- a `supported` motion group is not present in `FileReferences.Motions`;
- a `supported` expression id is not present in `FileReferences.Expressions`;
- a `supported` pose mapping is declared but `FileReferences.Pose` is absent;
- a `supported` lip-sync parameter id is absent from the model parameter set
  when parameter inspection is available;
- `model_physics` is declared but `FileReferences.Physics` is absent or rejected
  by Cubism;
- hit-region aliases declare `supported` regions not present in `HitAreas`;
- `missing_activity` would treat an unsupported activity as successful.

The closed diagnostic registry is
[`tables/live2d-adapter-diagnostics.yaml`](tables/live2d-adapter-diagnostics.yaml).
The diagnostic namespace is `AVATAR_LIVE2D_COMPAT_*`. Required codes:

| Code | Meaning |
| --- | --- |
| `AVATAR_LIVE2D_COMPAT_MANIFEST_MISSING` | Requested tier requires a manifest but none was selected. |
| `AVATAR_LIVE2D_COMPAT_MANIFEST_INVALID` | Manifest JSON or schema is invalid. |
| `AVATAR_LIVE2D_COMPAT_MODEL_ID_MISMATCH` | Manifest target does not match resolved model. |
| `AVATAR_LIVE2D_COMPAT_LICENSE_UNVERIFIED` | Fixture or package license evidence is insufficient for the requested use. |
| `AVATAR_LIVE2D_COMPAT_MOTION_MISSING` | A supported motion mapping points to a missing group. |
| `AVATAR_LIVE2D_COMPAT_EXPRESSION_MISSING` | A supported expression mapping points to a missing expression. |
| `AVATAR_LIVE2D_COMPAT_POSE_UNAVAILABLE` | Supported pose mapping was claimed but pose support is unavailable. |
| `AVATAR_LIVE2D_COMPAT_LIPSYNC_PARAMETER_MISSING` | Supported lipsync mapping lacks a valid mouth parameter. |
| `AVATAR_LIVE2D_COMPAT_PHYSICS_UNAVAILABLE` | Supported physics was claimed but physics is unavailable or invalid. |
| `AVATAR_LIVE2D_COMPAT_HIT_REGION_MISSING` | Supported hit-region mapping points to absent hit areas. |
| `AVATAR_LIVE2D_COMPAT_UNSUPPORTED_SEMANTIC` | A runtime semantic request has no supported model-local mapping. |

## 5. NAS Fallback Binding

NAS remains convention-based handler code under `<model>/runtime/nimi/`. The
adapter manifest does not replace NAS and does not create a declarative NAS DSL.

When a NAS activity handler is absent:

1. Avatar checks the adapter motion mapping if an adapter is active.
2. If no adapter mapping exists, Avatar may use the Live2D branch convention
   fallback (`Activity_<CamelCase>`) only when the computed tier allows it.
3. If neither path supports the semantic request, Avatar emits a diagnostic and
   must not count the request as successful activity playback.

## 6. Legal Fixtures

Fixture policy is mandatory:

- `fixture_use: "committable"` requires redistribution evidence in the manifest
  and must not rely on private or ambiguous third-party terms.
- `fixture_use: "operator_local_only"` may be used for local manual acceptance
  but cannot be committed as an asset fixture and cannot close automated CI by
  itself.
- `fixture_use: "not_allowed"` blocks the package from fixture use.

Current compatibility closure requires legal fixture evidence before claiming
closure. Synthetic fixtures are acceptable only when they are rights-owned and
exercise real Cubism package layout and Avatar carrier rendering.

## 7. Carrier Acceptance

`render_only` and higher tiers require Avatar carrier visual evidence, not just
loader success:

- model loads through Avatar Live2D branch;
- Avatar-owned canvas/WebGL path produces non-placeholder visible pixels;
- mapped semantic behavior changes model-local command state or pixels when the
  tier claims semantic support;
- invalid/missing package or manifest inputs fail closed with diagnostics.

Desktop chat Live2D renderer evidence and static fixture screenshots are not
accepted.

## 8. ParamMouthForm Winner-Key Mapping

`ParamMouthForm` is the Cubism standard mouth-shape parameter (range
`[-1, 1]`; -1 = round/closed, 0 = neutral, +1 = wide). When the wLipSync
driver selects a winner viseme, it writes the following standard mapping:

| Winner key | Viseme | ParamMouthForm value | 嘴型描述 |
| --- | --- | --- | --- |
| `A` | aa | **-0.6** | 圆张大（如 "啊"）；OpenY 较高 |
| `E` | ee | **+0.4** | 横向半开（如 "诶"） |
| `I` | ih | **+0.8** | 横向最窄（如 "易"） |
| `O` | oh | **-0.2** | 中性偏圆（如 "哦"） |
| `U` | ou | **-0.8** | 圆形收口（如 "乌"） |
| _silent / no winner_ | — | **0** | 中性；OpenY 同时归零 |

Driver constraints:

- When `runner` co-contributes, `ParamMouthForm` takes the **winner-only**
  value (no blending; avoids form jitter). `ParamMouthOpenY` may still take
  the winner+runner blend sum (because openness is continuous).
- `ParamMouthForm` tier check goes through `semantics.lipsync.paramMouthForm`
  (§3.4). When the manifest reports `'absent'`, the driver writes
  `ParamMouthOpenY` only and emits an evidence record
  `paramMouthForm: not_supported`.
- This mapping is reproduced verbatim as a `const` table in
  `apps/avatar/src/shell/renderer/live2d/live2d-lipsync-driver.ts`. Scattered
  hardcoded values across other files are forbidden (drift check).

## 9. Evolution

- New tiers require a minor contract bump and table update.
- Changing tier semantics or manifest required fields requires a major contract
  bump.
- Adding VRM/3D/Lottie support requires a separate backend compatibility
  contract, not widening this Live2D contract.
- Changing the ParamMouthForm winner-key mapping values requires a minor bump
  + sync to the lipsync driver `const` table + sync to evidence regression
  fixture.

---

<!-- source: .nimi/spec/avatar/kernel/vrm-backend-contract.md -->

# VRM Backend Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: Active `kind: 'vrm'` BackendBranch implementation authority
> **Sibling contracts**:
> - [Backend branch contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Live2D render contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Embodiment projection contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Carrier visual acceptance contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [App shell contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)

---

## 0. 阅读指南

本 contract 定义 Nimi Avatar **VRM backend branch** 的实现细节：模型加载
（GLTF + VRMLoaderPlugin）、MToon outline 策略、context-lost 恢复、Tauri
quirks、framing intent / nominal bounds 派生、expression preset 命名、
generated motion provider 接入、`.vrma` interchange support、audio consumer +
lipsync driver 接入。

VRM backend 实现 `BackendBranch` 抽象；carrier abstraction 公共契约见
[backend-branch-contract.md](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)。

VRM library 版本 pin：`@pixiv/three-vrm@^3.5.2` /
`@pixiv/three-vrm-animation@^3.5.2` / `@pixiv/three-vrm-core@^3.5.2` /
`three@^0.183.2` / `@react-three/fiber@^9.5.0`。

---

## 1. Authority Scope

VRM backend 是 `apps/avatar` 内独立实现：

- 文件骨架：`apps/avatar/src/shell/renderer/vrm/**`
- 0 行 import 自 `@nimiplatform/kit/features/avatar/*` /
  `apps/desktop/**` / `_external/**`（self-contained policy；详
  `apps/avatar/AGENTS.md`）
- airi 算法借鉴：MToon outline / instance cache /
  framing / hit-test / lipsync envelope；**仅算法/配比/envelope，0 行 import**

---

## 2. Lifecycle

## K-NAV-VRM-001 Model Load

加载流程：

```
1. Manifest resolver 探测 model_path → kind: 'vrm'（详 design-08 §"ModelManifest"）
2. suspend createImageBitmap（Tauri webview quirk；详 §6.1）
3. GLTFLoader + VRMLoaderPlugin + VRMAnimationLoaderPlugin singleton
4. loader.loadAsync(vrmFile URL)
5. 检查 gltf.userData.vrm；缺失 → fail-close
6. VRMUtils.rotateVRM0(vrm)（VRM 0.x → 1.0 朝向修正；幂等）
7. applyIdlePose(vrm)（中性站姿；避免 T-pose 闪现）
8. scene.traverse: object.frustumCulled = false（避免 close-up 时模型部分剔除）
9. 计算 nominalBounds（详 §4）
10. 初始化 generated motion provider capability profile（详 §3）
11. emit avatar.model.load { model_kind: 'vrm', backend_meta: {...} }
12. resume createImageBitmap
```

`VRMUtils.rotateVRM0 → applyIdlePose → traverse frustumCulled=false` 顺序
**强制**；调换顺序导致首帧错误朝向 / T-pose 闪烁 / 边缘剔除。

### 2.2 Load Failure (Fail-Close)

| Failure | Action |
|---|---|
| `vrmFile` 不存在 / 不可读 | fail-close；emit `avatar.carrier.lifecycle.failed_closed { reason: 'load_failed' }` |
| GLTFLoader parse fail | fail-close；error UI 显示 "Invalid VRM file" |
| `gltf.userData.vrm` undefined | fail-close（不假装是空 VRM） |
| `MToonMaterialLoaderPlugin` register fail | fail-close |
| `applyIdlePose` 抛错（model 缺少 humanoid bone） | fail-close（VRM 必须有完整 humanoid skeleton） |

无静默 fallback；任何 failure 进 degraded surface。

## K-NAV-VRM-002 Context Lost & Restore

WebGL context lost 处理：

```
webglcontextlost → emit avatar.carrier.lifecycle.context_lost
                → 等待 1500ms（airi baseline）
                → 尝试 1 次 createRendererContext()
                  ├── success → emit avatar.carrier.lifecycle.context_restored
                  │            → 重新加载 VRM scene（reload textures + animations）
                  └── 二次 fail → emit avatar.carrier.lifecycle.failed_closed
                                → carrier 进 degraded surface
```

**强制单次重试**（airi 工业基线）；多次重试导致 GPU stale → 真正不可用时仍假装活着。

### 2.4 Shutdown

```
1. emit avatar.app.unmount
2. mixer.stopAllAction()
3. dispose VRM scene (geometry / textures / materials)
4. wLipSyncNode disconnect + close
5. AudioContext close（per-session 单例；avatar 主动 release）
6. Three.js renderer.dispose()
7. R3F <Canvas> unmount
```

---

## 3. Generated Motion Provider

## K-NAV-VRM-003 Runtime Support Path

APML auto-adapter runtime support is proved by generated `THREE.AnimationClip`
execution downstream of typed runtime projection, not by the presence of
physical `.vrma` files.

The VRM branch consumes:

- typed `runtime.agent.presentation.*` / `runtime.agent.state.*` projection
- Avatar route ids from `tables/generated-motion-routes.yaml`
- backend capability profiles conforming to
  `tables/backend-capability-profile.schema.yaml`
- mapping sidecars conforming to `tables/mapping-sidecar.schema.yaml`

Provider output is defined by
[`generated-motion-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml):
an executable `THREE.AnimationClip` or fail-closed evidence. Missing capability,
unsafe pose, low-confidence mapping, or an unknown route must fail closed; idle
fallback is not support for a non-idle route.

### 3.2 `.vrma` Interchange Loading

- 通过 `VRMAnimationLoaderPlugin` + `GLTFLoader.loadAsync(.vrma URL)` 加载
- `gltf.userData.vrmAnimations[0]` → `clipFromVRMAnimation(vrmAnimation, vrm)`
  转 `THREE.AnimationClip`
- `THREE.AnimationMixer` 持有当前 + 上一 clip；切换走 `mixer.crossFadeFrom`
- 每帧 `mixer.update(delta)` + `vrm.update(delta)` 同节拍

This path is admitted only for interchange and authoring evidence. It
must not be required for APML auto-adapter runtime support.

## K-NAV-VRM-004 Interchange Preset Registry

Interchange registry见 `tables/vrm-motion-presets.yaml`。每 entry 必须有：

- `id`: stable ontology-anchored id
- `file`: `.vrma` 文件名（相对 `apps/avatar/assets/vrm-motion-presets/`）
- `loop`: bool
- `license`: SPDX id 或 `internal`
- `source`: URL 或 `internal` source description（不允许占位值）

Interchange loading strategy:

- `apps/avatar/assets/vrm-motion-presets/<id>.vrma` 是默认资产
- `model_path/motions/<id>.vrma` 是 per-model override（探测存在则优先）
- this registry must not be constructed or loaded on the APML auto-adapter
  runtime support path

### 3.4 Per-Model Override For Interchange

manifest 探测 `model_path/motions/` 子目录（详 design-08）：

- 存在 → 注册 override；同 id 时覆盖 builtin
- 不存在 → 仅用 builtin
- override resolution is interchange-only; generated provider failure must not
  fall back to per-model `.vrma` playback

### 3.5 Generated Runtime Play Semantics

```ts
generatedMotionRuntime.play({
  routeId: 'nod_yes',
  fade: 0.2,        // crossfade 秒数
  loop: false,
  intensity: 1,     // 0..1 影响 crossfade 速度上界
});
```

约束：

- 引用未在 generated motion route registry admit 的 `routeId` → fail-close
  （log warn，不假装在动）
- missing generated provider / missing capability profile / unsafe generated
  pose / low-confidence mapping → fail-close, no placeholder success
- `loop: true` 的 generated clip 在新 play 调用时必须显式被 stop（不允许累积多 loop clip）
- APML auto-adapter support must not depend on this registry; use generated
  provider route support instead.

---

## 4. Nominal Bounds

## K-NAV-VRM-005 Derivation

VRM `BackendNominalBounds.width/height` 派生顺序：

```
1. scene bbox 计算（new THREE.Box3().setFromObject(vrm.scene)）
2. apply framingIntent（默认 'bottom-companion'，见 §4.2）
3. clamp 到 vrm-backend default fallback (360 × 720)
4. bodyCenterX / bodyCenterY 来自 vrm.humanoid 中心 bone（HipsBone）的
   normalized projection
```

fallback 360 × 720 在 scene bbox 不可计算时（理论上不发生）使用。

### 4.2 Framing Intent

```ts
type VrmFramingIntent =
  | 'full-body'         // 全身可见，camera 远；适合 idle / motion preview
  | 'bottom-companion'  // 下半身切角，camera 较近，bodyCenterY 偏上；avatar 默认
  | 'head-shoulders'    // 半身肖像，camera 最近；speaking 强调
  ;
```

avatar 默认 `bottom-companion`，aspect 0.45（高瘦窗口）。framing intent
可由 NAS handler 通过 `BackendProjection.applyMotion` extension hint 传递
（implementation may consume the namespace only after this contract admits it）。

---

## 5. Expression System

## K-NAV-VRM-006 Preset Names

VRM expression preset 标准命名：

- **Viseme**：`aa`、`ih`、`ou`、`ee`、`oh`（lipsync driver 写）
- **Emotion**：`happy`、`sad`、`angry`、`relaxed`、`surprised`、`neutral`
- **Extended**：可选；model 自定义 preset name 由 emote-states.yaml 引用时
  在 model 加载时探测，缺则 skip + log warn（partial degrade）

### 5.2 Expression Manager API

通过 `vrm.expressionManager.setValue(name, weight)` 写入；统一在 useFrame
末端 flush。

约束：

- viseme preset 写入由 lipsync driver 独占（`vrm-lipsync-driver.ts`）
- emotion preset 写入由 emote state 独占（`vrm-emote-state.ts`）
- 两者**互斥**：lipsync active 时 emote state 不写 viseme

---

## 6. Tauri WebView Quirks

## K-NAV-VRM-007 createImageBitmap Suspend

Tauri webview（macOS WKWebView）在 GLTF texture 加载阶段触发
`createImageBitmap` 时偶发 hang。VRM loader 必须在 `loadAsync` 调用
**之前** suspend 全局 `createImageBitmap`，之后 restore：

```ts
const restore = suspendCreateImageBitmapForTauriVrmLoad();
try {
  const gltf = await loader.loadAsync(url);
  // ...
} finally {
  restore();
}
```

实现细节：把 `window.createImageBitmap` 临时替换为 throw（强制 GLTFLoader
走 `<img>` fallback 路径）；`finally` 恢复原引用。

### 6.2 secure context

Tauri webview 默认是 secure context（`tauri://localhost`），满足 audio
worklet（wLipSync）+ WebGL2 + offscreen canvas 要求。

---

## 7. MToon Outline Policy

## K-NAV-VRM-008 Outline Algorithm

VRM 标准 MToon material 支持 outline（描边）。avatar 使用 airi 工业级
outline fallback 算法：

- 默认尝试 MToonMaterialLoaderPlugin outline
- outline 不可渲染（如 GPU 不支持几何 shader fallback）→ skip outline，
  渲染 base material
- 失败不算 fail-close（outline 是装饰，缺也能 ship）

### 7.2 Plugin Wiring

```ts
loader.register((parser) => new VRMLoaderPlugin(parser, {
  mtoonMaterialPlugin: createMToonMaterialLoaderPlugin(parser),
  // airi AiriMToonMaterialLoaderPlugin 算法 ref；apps/avatar 内独立写
}));
```

---

## 8. Audio Consumer & Lipsync Driver

VRM backend 提供 `BackendAudioConsumer` 实现：

- `vrm/vrm-audio-consumer.ts`：内部 lazy create wLipSyncNode；attach 到当前
  AudioBufferSource；snapshot 暴露 weights + volume
- `vrm/vrm-lipsync-driver.ts`：6-dim weights → `aa/ih/ou/ee/oh` 5 viseme
  preset；envelope + winner+runner blend

约束：

- `attachAudioSource` 是 async（包内首次 worklet/WASM 加载）
- silent 路径必须把 5 个 viseme expression preset weight 全部设 0
- VRM model 缺全部 5 个 viseme preset → log warn at load；driver tick 内
  `setValue` 安全（preset 缺失 throw → catch 后跳过）

---

## 9. Scene Hierarchy

R3F `<Canvas>` 内 scene 结构：

```
<Canvas>
  <ambientLight intensity={0.6} />
  <directionalLight position={[1, 1, 1]} intensity={0.8} />
  <primitive object={vrm.scene} />     ← VRM model
  <camera frustumCulled={false} />
</Canvas>
```

约束：

- `frustumCulled=false` 应用于 `<Canvas>` camera 与 scene.traverse 整树
- 不允许在 useFrame 内修改 light intensity / position（避免 stutter）
- postprocess 极轻量；新增 pass 必须先由本 contract 或子表承认

---

## 10. Hit Region

VRM hit region 实现：

- `kit/features/avatar/src/vrm-hit-region.ts`：alpha-mask via offscreen render-target
  + bbox snapshot（详 `app-shell-contract.md` §"Hit Region 双层结构"）
- `vrm/vrm-render-target.ts`：airi render-target 算法 ref；offscreen FBO +
  readPixels（1/2 res，per-frame query budget 1ms）

bbox 计算：从 scene bbox 投影到 normalized client coord；snapshot 100ms
throttled 上报到 carrier（详 design-07）。

---

## 11. Drift Check

- VRM 文件加载顺序违反 `rotateVRM0 → applyIdlePose → frustumCulled=false`
  → fail-close（unit test 强制断言）
- `BackendBranch.kind === 'vrm'` 时不允许暴露 `live2dExtension` 字段
  （discriminated union typecheck 强制）
- generated motion route lacks capability profile support → fail-close
- `vrm-motion-presets.yaml` 引用 `.vrma` 文件不存在 → interchange validator
  fail; this is not APML runtime support proof
- `model_path/motions/<id>.vrma` 同名 override 必须与 builtin 同 ontology
  semantics（不允许语义偏移；human review at admit）
- `createImageBitmap` 不被 suspend 直接调用 `loader.loadAsync` → typecheck
  pass 但 e2e Tauri 加载随机 hang（必须 lint 强制 wrap）

---

## 12. Evolution

- 新 VRM expression preset 命名 → minor bump + 同步 `vrm-emote-states.yaml`
- 新 generated motion route → update `generated-motion-routes.yaml`,
  capability profile schema expectations, and provider tests in the same packet
- 新 framing intent → minor bump
- 改 context-lost recovery 策略（如多次重试）→ major bump（与 fail-close
  posture 强相关）
- VRM 1.x → 2.x library 升级 → 评估 `rotateVRMx` 等 API breakage；可能
  major bump

---

<!-- source: .nimi/spec/avatar/kernel/nimi2d-backend-contract.md -->

# Nimi2D Backend Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: Active Avatar-local `kind: 'nimi2d'` BackendBranch boundary.
>   Default generated asset admission remains Nimi2D Generation Bench-gated.
> **Sibling contracts**:
> - [Backend branch contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Embodiment projection contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Generated motion provider contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Carrier visual acceptance contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - Nimi2D Live Action Bench contract (retired)
> - [Nimi2D package authority](https://github.com/nimiplatform/nimi/blob/main/docs/spec/nimi2d-domain-index.md)

---

## 0. Reading Guide

This contract admits the Avatar-side Nimi2D backend branch as a runtime
consumer of admitted Nimi2D packages. It does not admit Nimi2D as the default
generated avatar layer.

Nimi2D Generation Bench remains the gate for default generated tier-1 asset
viability. A `nimi2d` Avatar backend can consume hand-authored,
semi-automatic, or otherwise admitted Nimi2D packages, but it must not treat
runtime playback success, visual smoke success, or Live Action Bench success as
Generation Bench closure.

Implementation evidence belongs in Avatar evidence records, Live Action Bench
results, release review packets, or local reports. It must not be promoted into
this contract as a second source of product-readiness truth.

Canonical teaching model:

`Nimi2D package evidence -> Avatar Nimi2D capability profile -> Avatar backend live-action lanes`

## 1. Authority Boundary

Nimi2D owns:

- layer input contract
- package manifest contract
- base body / wardrobe / slot topology
- package capability tier claims
- package validator and Generation Bench result

Avatar owns:

- `BackendKind = 'nimi2d'` launch branch
- Nimi2D backend capability profile
- mapping from runtime typed projection to Nimi2D live-action lanes
- backend-local composer, lane arbitration, hit region, audio consumer, and
  visual proof
- fail-closed evidence when a package lacks required capability

Avatar-owned runtime helpers may reuse renderer-agnostic code from
`@nimiplatform/nimi2d/runtime` when consumed by the Avatar backend adapter.
This is code reuse only; authority remains this Avatar contract, not
`.nimi/spec/nimi2d/**`. Release-facing package proof remains owned by the
Nimi2D reference-player boundary.

Runtime owns:

- public APML / presentation wire truth
- typed `runtime.agent.*` projection
- PresentationTimeline and voice playback state

Forbidden ownership:

- Avatar must not parse raw APML for Nimi2D.
- Avatar must not infer package capability from requested tier.
- Avatar must not promote package-local layer ids, anchors, or slots into
  runtime semantic truth.
- Avatar must not count Nimi2D runtime playback as Generation Bench success.

## 2. Backend Kind Admission

The launched Avatar carrier backend union admits:

```ts
export type BackendKind = 'live2d' | 'vrm' | 'nimi2d';
```

`kind: 'nimi2d'` is an Avatar-local backend branch. It is not a Runtime/SDK
public backend enum expansion under this contract. Runtime/SDK public
admission requires a separate Runtime/SDK authority packet.

Backend branch requirements:

- Avatar may parse and recognize a Nimi2D model manifest.
- `createBackendBranch` may admit `kind: 'nimi2d'` only when both the Nimi2D
  package manifest and Avatar Nimi2D capability profile validate.
- A PixiJS renderer path may implement static layer, idle, expression, motion
  state, and tier-1 amplitude mouth lanes when package/profile validation
  succeeds.
- The renderer must consume package `canvas` and `render_layers`
  placement/bounds geometry, including rectangular `texture_bounds_px`
  cropping and optional `render_layers[].mask` alpha-mask asset binding. It
  must not recover geometry or masks by reading upstream layer-input manifests
  or renderer-local mask tables.
- The renderer may consume Avatar capability profile
  `renderer.bindings.motion_routes.<route_id>` bindings for route-specific
  sprite translate/scale/opacity transforms. Route ids come from the profile;
  the renderer must not hardcode a route such as `lean_in`.
- The Nimi2D surface may expose a BackendHitRegion alpha query backed by
  decoded package render-layer alpha and optional package alpha-mask assets. It
  must return `null` until the alpha probe is ready or when the selected
  default outfit layer is absent, allowing bbox fallback.
- The Nimi2D BackendHitRegion `body` / `drag` bbox is computed from
  the package render plan's visible layer geometry: union of
  `render_layers[].visible_bounds_px` mapped through `texture_bounds_px` and
  `placement_px` into package canvas coordinates, normalized against
  `sourceCanvas`. A full-window bbox is allowed only as conservative fail-closed
  fallback when no valid layer geometry is available.
- Nimi2D renderer readiness and alpha-hit-probe readiness must use
  `avatar.carrier.visual` records. They must not create a new OS window-shape
  authority and must not be treated as unadmitted lifecycle violations by
  `EmbodimentStage`.
- Nimi2D mounted Pixi canvas visual capture may write a human-visible artifact
  through Avatar evidence storage when the mounted canvas is readable and has
  non-zero visible pixels. Capture failure or blank frames must record
  `avatar.carrier.visual { status: 'error' }`; canvas existence, Pixi
  readiness, and offscreen package proof must not masquerade as mounted visual
  artifact success.
- The composer scheduler may advance renderer-agnostic frame time, expression
  fade weight, motion fade-in/fade-out, queued motion handoff, interrupt
  replacement, motion recovery to idle, and idle-life clock snapshots.
- Renderer-agnostic package loading, render-plan validation, composer state, and
  bounded bench scoring may be imported from `@nimiplatform/nimi2d/runtime`;
  Avatar remains responsible for BackendBranch, PixiJS surface, Tauri file
  reads, audio consumer, hit region, lifecycle evidence, and acceptance
  integration.
- Missing package, missing profile, missing default outfit, invalid layer asset,
  or invalid renderer binding fails closed.
- Placeholder surfaces, blank canvases, static screenshots, tier-0-only packages,
  or runtime playback success must not be reported as Generation Bench closure.

## 3. Package Intake

A Nimi2D Avatar model manifest must carry an opaque ref to an admitted Nimi2D
package manifest:

```ts
type Nimi2DAvatarModelManifest = {
  kind: 'nimi2d';
  modelId: string;
  runtimeDir: string;
  nimiDir: string | null;
  posterPath: string | null;
  nimi2d: {
    packageManifestPath: string;
    packageDigestSha256: string | null;
    capabilityProfileRef: string | null;
  };
};
```

Runtime rendering is admitted only when all of the following are true:

- package manifest validates against `.nimi/spec/nimi2d/**`
- Avatar model manifest provides `nimi2d.packageDigestSha256`
- raw package manifest bytes match `nimi2d.packageDigestSha256`
- package manifest carries a validator evidence ref and content admission ref
- package governance requires `base_body_renderable: false`
- package has a default outfit
- package `proven_tier` is sufficient for the requested lane
- Avatar Nimi2D capability profile validates against
  `tables/nimi2d-backend-capability-profile.schema.yaml`
- capability profile supplies Avatar-owned renderer canvas and layer bindings
  for any claimed live-action lane

Missing, unreadable, digest-mismatched, evidence-missing, invalid, or
overclaiming packages fail closed. The backend must not fall back to a naked
base body, a placeholder body, a static poster, or another backend kind.

Runtime package hardening boundary:

- Avatar verifies it is consuming the expected raw package manifest via
  SHA-256 digest.
- Avatar requires package admission lineage refs that point back to offline
  Nimi2D validation and upstream content admission.
- Avatar runtime loading is still not a replacement for offline Nimi2D package
  validation. It must not duplicate or fork the full Node-side validator.

## 4. Live Action Lanes

Nimi2D backend live action is a local Avatar composer over package evidence and
runtime typed projection. It is not LLM frame control.

Admitted lanes:

| Lane | Input | Minimum package capability | Failure |
| --- | --- | --- | --- |
| static_layer | package draw order + selected outfit | `tier-0_static_layered` | fail closed if no outfit |
| idle_life | local clock / presence | `tier-1_agent_basic` | remain visually static; no success event |
| expression | runtime emotion / expression cue | `tier-1_agent_basic` | unsupported cue evidence |
| speech_mouth | BackendAudioConsumer amplitude snapshot | `tier-1_agent_basic` | silent mouth |
| gesture_motion | runtime activity / motion cue | `tier-1_agent_basic` | `avatar.motion.preset.fail_close` |
| true_viseme | audio viseme classifier | `tier-2_viseme_gesture` | unsupported; tier-1 cannot claim it |
| semantic_full_body | semantic full-body action | `tier-3_full_body_semantic` | unsupported |

Lane arbitration rules:

- Lanes read package `capability.proven_tier`, never `requested_tier`.
- A higher lane may be absent while lower lanes remain valid.
- Unsupported non-idle lanes fail closed and emit bounded evidence; they must
  not degrade into idle and count as success.
- Speech mouth at tier-1 is jaw/amplitude only. AEIOU true viseme is tier-2+.
- Outfit switching is atomic; there is no base-body-only intermediate frame.

Scheduler contract boundary:

- The scheduler may operate over discrete activity, expression, motion, and
  mouth lanes.
- It may expose local time advancement, fade/recovery semantics, motion queue
  length, completed-motion count, and interrupted-motion count as Avatar-local
  observable state.
- It may apply route-specific sprite transforms only when the Avatar capability
  profile declares `motion_routes`.
- It does not admit release-grade route-specific gesture transform quality,
  gesture queue policy, full priority conflict matrix, gaze, physics, or mesh
  deformation.

## 5. Projection Consumption

The Nimi2D backend consumes only Avatar `BackendProjection` and
`BackendAudioConsumer` surfaces:

- `applyActivity` routes to live-action route families admitted by
  `tables/nimi2d-live-action-routes.yaml`
- `applyEmotion` routes to expression lane if package capability allows
- `applyMotion` routes to motion primitive lane if package capability allows
- `applyExpression` routes to expression lane if package capability allows
- `reset` returns to package-defined neutral outfit-visible posture

It must not consume:

- raw APML
- LLM-streamed numeric transform params
- Runtime internal timeline structs
- Nimi2D Generation Bench result as a runtime control stream

## 6. Audio Consumer

Nimi2D backend implements the same `BackendAudioConsumer` surface as Live2D and
VRM:

- `attachAudioSource` remains async
- `detachAudioSource` disconnects source state
- `silent` immediately zeros speech mouth output
- `snapshot` feeds local mouth lane

Tier-1 packages may consume amplitude/jaw-open envelopes only. True viseme
weights from wLipSync or another classifier are ignored unless the package and
capability profile prove tier-2+ true viseme support.

## 7. Hit Region And Bounds

Nimi2D hit region must be derived from rendered outfit-visible package layers,
not from hidden base body layers. Alpha-mask probing may use rendered layer
alpha; bbox fallback is allowed only with explicit `avatar.hit_region.degraded`
evidence.

Nominal bounds derive from package canvas and body anchors:

1. package canvas
2. selected outfit visible bounds
3. base body non-renderable anchors for framing only
4. fallback bounds only after fail-closed evidence

## 8. Visual Proof

Nimi2D Avatar visual proof must establish:

- Avatar loads a valid Nimi2D package/profile pair.
- Avatar instantiates the renderer path, loads package layer textures in
  package render-layer draw order, applies package render-layer
  placement/bounds geometry and package alpha-mask asset bindings, and renders
  package base-body visual layers only together with the selected default
  outfit.
- Avatar wires `BackendProjection` into local composer state.
- Avatar advances a renderer-agnostic composer scheduler on the carrier frame
  loop, including bounded motion queue/interrupt state, without asking the LLM
  for numeric frame control.
- Avatar applies route-specific sprite transforms only when declared by the
  Avatar Nimi2D capability profile.
- Avatar wires `BackendAudioConsumer` amplitude into the tier-1 mouth lane.
- Avatar records mounted visual evidence only when readable mounted pixels are
  present.
- Invalid package/profile input fails closed.
- Package digest mismatch or missing admission/content evidence fails closed.

Offscreen package proof may support package readability and render-plan
diagnostics, but it does not close release-grade mounted-surface recording
acceptance or Nimi2D Generation Bench.

Nimi2D carrier visual proof requires:

- real Avatar carrier surface, not Desktop preview
- package validator evidence
- default outfit visible pixels
- no visible base-body-only frame
- non-placeholder pixel evidence
- fail-closed evidence for invalid package, missing outfit, unsupported lane,
  and context loss

`kind: 'nimi2d'` launch must not be used as release-renderer approval or
default generated avatar success without the separate evidence required by the
owning release gates.

## 9. Generation Bench Boundary

Avatar Nimi2D backend proof and Live Action Bench proof are value-ceiling
evidence. They do not admit default generated asset viability.

Default generated Nimi2D requires Nimi2D Generation Bench `go` or explicitly
accepted `conditional_go` on the certified-good tier-1 corpus.

## 10. Not Admitted

This contract does not admit:

- mesh/deformer renderer behavior beyond PixiJS sprite foundation
- slot-following deformation
- clip-path masks, deformation masks, mesh masks, or renderer-local mask tables
  beyond package `alpha_mask_asset` binding
- release-grade OS/window-shape acceptance beyond the existing
  EmbodimentStage click-through path
- release-grade blend tree, gesture queue policy, conflict arbitration, or gaze
  runtime
- release-grade route-specific motion transform quality beyond profile-declared
  sprite transforms
- Desktop launch UI for selecting Nimi2D packages
- Runtime/SDK public backend enum expansion
- default PersonaCharacter image-to-Nimi2D generation admission
- adult outfit distribution or age-gated asset loading
- raw APML, raw APML expansion, or LLM numeric frame control

## 11. Evolution

- Release-grade recording acceptance requires human-visible mounted artifact
  evidence and an acceptance matrix row for a real launched Nimi2D package.
- Default generated Nimi2D requires Generation Bench `go` or accepted
  `conditional_go`.
- Public Runtime/SDK `nimi2d` backend enum admission requires a separate
  Runtime/SDK authority packet and generated client update.

---

<!-- source: .nimi/spec/avatar/kernel/embodiment-projection-contract.md -->

# Embodiment Projection Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: Active multi-backend embodiment projection authority. Earlier
>   Live2D-only framing is superseded.
> **Sibling contracts**:
> - [Backend branch contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [VRM backend contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Live2D render contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Nimi2D backend contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [App shell contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Agent script contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Avatar event contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)

---

## 0. 阅读指南

本 contract 定义 Nimi Avatar 的 **backend-agnostic embodiment projection layer**。

canonical teaching model 固定为：

`agent semantics -> embodiment projection -> backend-specific execution`

其中：

- runtime / SDK 继续拥有 agent semantic truth
- avatar app 负责把这些语义投影成 embodiment-local cues
- Live2D / VRM / Nimi2D / 3D / robot / game-character 等 renderer 只是不同行为后端分支

本 contract 不重定义 runtime presentation semantics，也不把 backend-local state 提升为
platform truth。

---

## 1. Purpose

Embodiment projection layer 的职责是把 runtime/SDK 提供的 agent data bundle 映射到一组
avatar-local、backend-neutral 的投影意图：

- `activity`
- `expression`
- `pose`
- `lookat`
- `status_text`
- `speak`
- `user input`
- `visibility / focus / shell bounds`

backend branch 再把这些投影意图翻译成具体 renderer 指令。

---

## 2. Inputs

Projection layer 的 canonical inputs 只有两类：

### 2.1 Runtime / SDK bundle

来自 `AgentDataDriver` 的 bundle / event stream，承载：

- activity / posture / execution_state / status_text
- active user / world / session context
- conversation-anchor scoped event continuity

### 2.2 App shell context

来自 avatar app shell 的 local context，承载：

- window bounds / visibility / focus
- pointer / drag / click / hover
- launch context 已选定的 `agent_id` / `avatar_instance_id` / anchor targeting

---

## 3. Outputs

Projection layer 只产出 backend-neutral embodiment cues：

| Cue | Meaning |
|---|---|
| `motion` | 身体动作或序列触发 |
| `expression` | affect / face layer 变化 |
| `pose` | 姿态族切换 |
| `lookat` | 注视目标或方向 |
| `speak` | 语音驱动的说话状态 |
| `parameter_delta` | backend-specific fine-grained control hook |
| `surface_bounds` | 当前 embodiment 可交互边界 |

`parameter_delta` 明确属于 backend-extensible branch。它可以被当前 Live2D branch 消费，
但不是 runtime semantic truth。

`speak` is admitted only as an embodiment-local cue downstream of runtime-owned
PresentationTimeline truth (`K-AGCORE-051`). The projection layer may carry
voice timing and lipsync intent into backend branches, but it must not own
canonical voice timing, synthesize lipsync frames, or report speak success
without Avatar backend proof.

---

## 4. Backend Split

### 4.1 Canonical protocol truth

以下内容属于 backend-agnostic projection truth：

- bundle/event 如何进入 avatar app
- 哪些 projection cues 可以被 backend 消费
- NAS handlers 在什么上下文里执行
- shell 如何依赖 projection-produced surface bounds / hit mask

### 4.2 Backend-specific branches

以下内容必须留在 backend-specific branch：

- Cubism SDK / VRM runtime / Nimi2D compositor / robot runtime 的接入细节
- motion group / expression file / parameter id 的具体命名
- physics / lipsync / drag sway 的 renderer implementation
- backend binary / asset layout / licensing

当前 shipped branch 是 [Live2D render contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)。

---

## 5. NAS Boundary

NAS 运行时消费的是 `AgentDataBundle + EmbodimentProjectionApi`，而不是 platform truth 或
desktop truth。

这意味着：

- handler 可以读取 agent bundle / app context
- handler 可以发出 embodiment-local cues / signals / optional branch fallback hooks
- handler 不能写回 runtime semantic truth
- handler 不能绕过 app carrier boundary 直接拥有 desktop / runtime authority

---

## 6. Current Live2D Branch

Multi-backend authority 不移除 Live2D branch；它只把 Live2D 收回到 backend-specific authority。

当前 Live2D branch 继续拥有：

- Cubism SDK for Web integration
- `<model>/runtime/*.model3.json` loading
- `Activity_<CamelCase>` default activity fallback mapping
- Cubism parameter / expression / pose / physics details

这些都由 [Live2D render contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml) 约束，而不是本 contract。

---

## 7. BackendProjection Ontology Surface

> Re-anchored from earlier Live2D-coupled parameter-id model. Canonical
> structure now lives in [`backend-branch-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml).

The projection layer is delivered to NAS handlers and the carrier as a
backend-agnostic ontology surface:

```ts
type BackendProjection = {
  applyActivity(input: { name: string; intensity: number | null }): void;
  applyEmotion(input: { current: string; previous: string | null }): void;
  applyMotion(input: { routeId: string; fade?: number; loop?: boolean }): void;
  applyExpression(input: { name: string; weight?: number; fade?: number }): void;
  reset(): void;
};
```

Rules:

- `name` / `routeId` / `current` / `previous` 必须来自 platform
  `agent-activity-ontology.yaml` (K-AGCORE-049) 或 Avatar-local
  `generated-motion-routes.yaml` / `vrm-emote-states.yaml` admit registry。
- `routeId` is Avatar backend projection authority. It is not public APML
  syntax and must not create an Avatar-local shadow activity ontology.
- BackendProjection method **不携带** Live2D parameter id（`ParamMouthOpenY`
  等）；parameter id 路径降级为 `Live2DBackendExtension.setParameter`
  escape hatch（详 `backend-branch-contract.md` §2.6）。
- Activity-mapping resolution（ontology id → backend-specific route）由
  `tables/activity-mapping.yaml` v2 admit for Live2D and VRM. Nimi2D
  live-action route families are governed by
  `tables/nimi2d-live-action-routes.yaml` and package capability profile
  evidence; they must not be inferred from the Live2D/VRM mapping table.
- emote 名称由 `tables/vrm-emote-states.yaml` admit；name 不一定与 ontology
  emotion id 同名（如 ontology `embarrassed` → emote state `shy` 复用）。

## 8. Live2D Parameter-Id Escape Hatch

Parameter-id direct write 是 Live2D-only backend-internal 路径。NAS creator
handlers express it through authority-owned projection cue methods such as
`setSignal` and `addSignal`; the carrier/sandbox translator owns
`BackendBranch.live2dExtension` kind narrowing:

```ts
export type Live2DBackendExtension = {
  setParameter(id: string, value: number, durationSec?: number): void;
};
```

约束：

- handler-registry rejects any creator source that declares retired or
  unsupported backend extension capabilities.
- handler source that references `extension.live2d` or branch-local extension
  shortcuts must be rejected during static policy validation.
- Runtime signal writes must go through `projection.setSignal` /
  `projection.addSignal` and fail closed if the active backend cannot provide
  the internal Live2D signal surface.

## 9. NAS Handler `requires` Field

NAS handler 的 manifest 必须能声明所需 BackendBranch extension：

```ts
export interface NasActivityHandler {
  activity: string;
  handle(input: {
    bundle: AgentDataBundle;
    projection: EmbodimentProjectionApi;
  }): void;
}
```

详 [`agent-script-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml) §"NAS handler `requires`"。

## 10. Not Admitted In This Contract

本 contract 不拥有以下范围：

- local trust posture / model permission model
- runtime presentation semantic redesign
- desktop bridge / handoff redesign
- 新 backend branch（除 Live2D / VRM 外）的具体实现

---

## 11. Evolution

- 新 backend branch 接入：本 contract 不变；新增 backend-specific contract
  （如 `vrm-backend-contract.md` / `nimi2d-backend-contract.md`）+ 同步 `backend-branch-contract.md`
  `BackendKind` union
- 新增 BackendProjection method：minor bump
- 改 BackendProjection method 语义 / 改 ontology naming：major bump
- 新 generated motion route：update `generated-motion-routes.yaml` and provider
  contract evidence in the same packet
- 新 Live2DBackendExtension capability：minor bump + 同步 `agent-script-contract.md`
  允许的 `requires` 集合

---

<!-- source: .nimi/spec/avatar/kernel/avatar-event-contract.md -->

# Avatar Event Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: Baseline updated 2026-04-21 (consumer-aligned to mounted runtime substrate)
> **Upstream platform refs**:
> - [Runtime HookIntent contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
> - [Runtime presentation/activity projection seam](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
> - [Runtime transient presentation seam](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
> - [Conversation anchor contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
> **Sibling kernel contracts**:
> - [Agent script contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Embodiment projection contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [App shell contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Live2D render contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)

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
Avatar-local event contract。平台级 runtime projection 以 `.nimi/spec/runtime/**`
为准。

---

<!-- source: .nimi/spec/avatar/kernel/agent-script-contract.md -->

# Agent Script Contract — NimiAgentScript (NAS) 1.0
> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: Active NAS 1.0 authority
> **Upstream platform refs**:
> - [APML model-facing wire authority](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
> - [Runtime presentation/activity projection seam](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
> - [Runtime HookIntent contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
> - [Runtime transient presentation seam](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
> **Sibling kernel contracts**:
> - [Avatar event contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Embodiment projection contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Live2D render contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [App shell contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - Mock fixture contract (retired)
---
## 0. 阅读指南
本 contract 定义 **NimiAgentScript (NAS) 1.0** —— 由 embodiment package creator 编写的 **convention-based JavaScript handlers**，为自己的 backend package 实现具体动作 / 表情 / 交互逻辑。当前 shipped backend branch 仍然是 Live2D，但 NAS 不再把 Live2D 当 semantic home。
**核心 framing**：NAS 不是 declarative DSL / mapping config。它是一套 **file-system convention**：model creator 在 `<model>/runtime/nimi/` 目录下放 JS 文件，文件路径对应 agent data 或 event，avatar app 的 runtime 自动发现并执行。**6 个分叉点**（44-49）均已按推荐锁定。
**关键价值**：让第三方 package creator 通过写 JS 代码把 runtime semantic bundle 投影成 embodiment-local 行为。当前 shipped branch 提供完整 Live2D 执行能力（motion / signal-to-parameter mapping / expression / sequence / state machine / eye tracking / drag physics），但这属于 backend-specific execution，而不是 NAS canonical truth。
---
## 1. Purpose & Scope
### 1.1 Why NAS
Runtime presentation activity / expression / pose projection 是**语义意图**。每个 backend package 要把意图转成具体 embodiment 行为；当前 shipped branch 只是把它们落到 Live2D。单纯 declarative mapping（"happy → motion X"）**不够**，因为:
- 复杂动作需要 **sequence**（挥手 → 鞠躬 → 微笑）
- 动态响应需要 **signal/channel direct control**（眼神跟随 cursor）
- 交互需要 **state machine**（连续点击 3 次触发特殊反应）
- backend-specific fine-grained control（physics / drag / lipsync 等）需要 **调用当前 backend API**
这些都需要 **JS 编程能力**。NAS 就是"以 convention 的方式组织这些 JS handler"。
### 1.2 Target User
**Embodiment package creator / 第三方 Avatar 开发者**：
- 做 backend asset + 动作 + JS 代码
- **不是** app developer（app dev 用 SDK API code）
- **不是** Nimi 内部（runtime / SDK 由 Nimi 团队实现）
- **不是** end user（UI-level 自定义由 app 自己处理）
### 1.3 Scope
**In-scope**:
- 目录 convention（`<model>/runtime/nimi/` 下 handler 文件的路径规则）
- Handler interface（3 种类型：activity / event / continuous）
- Agent data bundle context 形态
- Embodiment projection API v1 scope（当前 shipped branch 由 Live2D 实现）
- Default fallback 机制
- Worker-backed capability-RPC sandbox mechanism
- Hot reload 语义
- File name normalization 规则（activity id / event name → 文件名）
**Out-of-scope**:
- 具体 pub/sub broker 实现（属 runtime implementation）
- VRM / 3D / robot backend 具体 API（future）
- End-user customization UI（app 自己实现，不在本 spec）
---
## 2. Core Design
### 2.1 Convention over Configuration
**没有 YAML，没有 manifest，没有 schema validator，没有 CEL**。只有:
1. **目录结构**：`<model>/runtime/nimi/activity/` / `nimi/event/` / `nimi/continuous/` / `nimi/lib/`
2. **文件命名**：`happy.js` / `avatar_user_click.js` / `eye_tracker.js`
3. **Handler 接口**：每个 JS 文件 `export default` 一个对象，按固定形态
Avatar runtime 扫描目录 → 发现文件 → 注册 handler → 自动按 convention 调用。
### 2.2 三种 Handler 类型
| Type | 触发时机 | 目录 | 文件名 |
|---|---|---|---|
| **Activity Handler** | `runtime.agent.presentation.activity_requested` 发生时 | `nimi/activity/` | `<activity-id>.js` (e.g. `happy.js`, `ext_grateful.js`) |
| **Event Handler** | 其他 event 发生时 | `nimi/event/` | `<normalized-event-name>.js` (e.g. `avatar_user_click.js`) |
| **Continuous Handler** | 每帧运行 | `nimi/continuous/` | 任意 `.js` 名字 |
### 2.3 Default Fallback
Handler 不存在 → neutral NAS layer 走 app-owned default path：
- **Activity**: 若 backend branch 注册了 `runDefaultActivity`，则委托给 branch-owned fallback
- **Event**: 大多数 event 无 default（silently skip）
Model creator 只为想**自定义**的 activity / event 写 handler。零 handler 也能跑，但具体 activity default 由当前 backend branch 自己定义。
### 2.3.1 NAS handler `requires` 字段

NAS handler manifest 必须能声明所需 `BackendBranch` extension：

```ts
export interface NasActivityHandler {
  activity: string;
  handle(input: {
    bundle: AgentDataBundle;
    projection: EmbodimentProjectionApi;    // authority-owned cue surface
  }): void;
}

export interface NasContinuousHandler {
  intervalMs: number;
  tick(input: {
    bundle: AgentDataBundle;
    projection: EmbodimentProjectionApi;
    deltaSec: number;
  }): void;
}
```

handler-registry 行为：

- Creator-facing NAS handler source **不得声明 backend extension capability**；
  `requires` 中出现任何 retired/unsupported capability 必须 reject。
- Creator-facing NAS handler source **不得引用** `extension.live2d` 或其他
  branch-local escape hatch；Live2D parameter writes are expressed through
  authority-owned `projection.setSignal` / `projection.addSignal`.
- Live2D `BackendBranch.live2dExtension` is an internal sandbox translation
  channel only; it is supplied by the carrier/executor and not exposed to
  creator-authored source.
- 静态扫描器在 handler-registry 加载阶段对 handler source 做 AST scan；
  扫描失败的 handler 不注册（fail-close）

### 2.4 运行位置
NAS handler 在 **avatar app process 内**运行，由 SDK 提供 handler runtime + embodiment backend API。当前 shipped branch 对应 Live2D:
```
Runtime (Nimi daemon)
    │ typed agent data via gRPC
    ▼
Avatar App (Tauri)
  ┌───────────────────────────┐
  │ SDK (TS + Rust)           │
  │  ├ Handler discoverer     │  ← scan <model>/runtime/nimi/
  │  ├ Handler runtime (sandbox) │
  │  └ Embodiment Backend API │
  └───────────┬───────────────┘
              │ backend commands
              ▼
  ┌───────────────────────────┐
  │ Current backend branch    │
  │ (Live2D Cubism Web SDK)   │
  └───────────────────────────┘
```
---
## 3. Directory Structure
### 3.1 Current Live2D Cubism 官方结构（backend-specific reference）
Nimi model package 的组织 **尊重 Live2D Cubism 官方目录结构**。官方结构（从 Cubism Modeler / 下载的 model package）:
```
<model-pkg>/                          # 顶层 package（creator 分发单位）
  ReadMe.txt                          # Model 说明
  <name>.cmo3                         # Cubism Modeler 源文件（creator 用,不 runtime 加载）
  <name>.can3                         # Cubism Animator 源文件（同上）
  runtime/                            # ← 实际 runtime 使用的目录
    <name>.model3.json                # 主入口（Cubism SDK 从这里加载）
    <name>.moc3                       # MOC3 binary（model 数据）
    <name>.physics3.json              # 可选：physics 参数
    <name>.cdi3.json                  # 可选：Cubism Display Info
    <name>.pose3.json                 # 可选：pose 定义
    <name>.<resolution>/              # texture 子目录（按分辨率，如 ren.4096/）
      texture_00.png
      ...
    motions/                          # Motion group 文件
      *.motion3.json
    expressions/                      # Expression 文件
      *.exp3.json
```
**关键**：
- **`runtime/` 子目录** 是 end-user runtime 使用的，source files（`.cmo3` / `.can3`）不分发
- 文件名带 `<name>` prefix（非 simple `model3.json`），`<name>` 来自 Cubism Modeler 项目命名
- **Model-id 推断规则**：Avatar app 扫 `runtime/*.model3.json`，取 filename 去掉 `.model3.json` 后缀作为 `model_id`（如 `ren.model3.json` → `model_id = "ren"`）
### 3.2 Nimi 扩展：`runtime/nimi/`
**Nimi handlers 放在 `runtime/nimi/`**，与官方的 `motions/` / `expressions/` 同级。
```
<model-pkg>/
  <name>.cmo3                         # Creator source files（不 runtime 加载）
  <name>.can3
  ReadMe.txt
  runtime/
    <name>.model3.json                # Cubism SDK 主入口
    <name>.moc3
    <name>.physics3.json              # optional
    <name>.cdi3.json                  # optional
    <name>.pose3.json                 # optional
    <name>.4096/                      # texture
      texture_00.png
    motions/
      *.motion3.json
    expressions/
      *.exp3.json
    nimi/                             # ← Nimi 扩展，和上述官方目录同级
      activity/                       # Activity handlers
        happy.js                      # core: activity.name == "happy"
        sad.js
        shy.js
        angry.js
        surprised.js
        confused.js
        excited.js
        worried.js
        embarrassed.js
        neutral.js
        greet.js                      # interaction
        farewell.js
        agree.js
        disagree.js
        listening.js
        thinking.js
        idle.js                       # state
        celebrating.js
        sleeping.js
        focused.js
        ext_grateful.js               # extended: "ext:grateful"
        ext_proud.js
        ext_proud.js                   # extended: "ext:proud"
      event/                          # Non-activity event handlers
        avatar_user_click.js          # avatar.user.click
        avatar_user_drag_end.js
        avatar_user_hover.js
        desktop_chat_message_send.js  # cross-app
        desktop_chat_message_receive.js
        runtime_agent_state_posture_changed.js
        runtime_agent_hook_running.js
        system_focus_gained.js
      continuous/                     # Per-frame handlers
        eye_tracker.js
        breath_modulator.js
        idle_variation.js
      lib/                            # (optional) shared utilities
        wave_sequence.js
        bow_sequence.js
        clamp.js
      config.json                     # (optional) opt-in features (see §11)
```
### 3.2.1 VRM Model Package Integrity

VRM backend 的 model_path 也是目录形态（不是单 `.vrm` 文件直接 ship）：

```
my-vrm-character/
├── character.vrm                        # required；VRM 1.0 / VRM 0.x glTF binary
├── poster.png                           # optional；degraded surface fallback
├── motions/                             # optional；per-model .vrma 覆盖内置同名 preset
│   ├── greet_wave.vrma
│   ├── idle_subtle.vrma
│   └── ...
└── nimi/                                # optional；NAS handler（与 Live2D 同 layout）
    ├── activity/
    ├── event/
    ├── continuous/
    ├── lib/
    └── config.json
```

VRM 资产规则：

- **必需**：恰好 1 个 `*.vrm` 文件（同时存在 `*.model3.json` + `*.vrm` →
  显式 `avatar-model.json` 才允许；否则 fail-close）
- **可选 `motions/<preset_id>.vrma`**：覆盖 builtin preset；preset id 必须
  在 `config/avatar-vrm-motion-presets.yaml` registry 中
  admit；引用未 admit preset 的 override → registry reject 并 fall back
  到 builtin
- **可选 `poster.png`** / `poster.jpg`：degraded surface fallback；不影响
  carrier visual proof
- **可选 `nimi/`**：与 Live2D 同 NAS handler 目录 layout；handler must use
  the cue projection API and must not declare or call branch-local extension
  escape hatches.

manifest resolver（`apps/avatar/src/shell/renderer/carrier/model-resolver.ts`）
按 `kind: 'vrm'` 探测 `*.vrm` + 可选 `motions/` + `nimi/` + `poster.*`，
返回 `ModelManifest`（详 design-08）。

### 3.3 理由：为什么放 `runtime/nimi/`
1. **和 Live2D 官方结构一致** —— 不破坏 model creator 熟悉的 layout
2. **runtime/ 是分发单位** —— Model creator zip `runtime/` 就能 ship 完整 model（含 nimi handlers + Live2D assets）
3. **与 `motions/` / `expressions/` 同级** —— Handlers 是 runtime 行为，与 motions/expressions 性质一致
4. **Avatar app discovery 简单** —— 加载 `runtime/` 时自然发现 `nimi/` 子目录
5. **Source files 不污染** —— `.cmo3` / `.can3` 等 creator-only 文件保留在顶层，runtime 目录只含分发所需
### 3.4 Loading Flow
Avatar app 加载 model 流程：
```
1. Avatar app 收到 model path (e.g. /path/to/ren_pro_zh/runtime/ 或 /path/to/ren_pro_zh/)
2. 定位 runtime/ 目录（若指向 package 顶层，找 runtime/ 子目录）
3. 扫描 runtime/*.model3.json，取 filename prefix 作为 model_id
4. 通过 Cubism Web SDK 加载 <name>.model3.json
5. 扫描 runtime/nimi/（若存在），发现并注册 handlers (§10)
6. 读取 `nas-package://runtime/nimi/config.json`（若存在）应用 feature flags
7. Emit avatar.app.ready
```
若 `runtime/nimi/` 不存在 → 所有 activity 走 default fallback（convention-based motion group naming，见 §7）。Model 仍可用，只是没有自定义行为。
### 3.5 File Name Normalization ⚠️ [分叉 44 — Option A]
**规则**: 替换所有非 `[a-z0-9_]` 为 `_`。
| Identifier | 文件名 |
|---|---|
| `happy` | `happy.js` |
| `ext:grateful` | `ext_grateful.js` |
| `ext:proud` | `ext_proud.js` |
| `avatar.user.click` | `avatar_user_click.js` |
| `avatar.user.drag.end` | `avatar_user_drag_end.js` |
| `runtime.agent.state.posture_changed` | `runtime_agent_state_posture_changed.js` |
**理由**: 文件名简单（不需要 URL encode），扁平结构便于 glob / scan，单一规则 reviewable。
### 3.6 Normalization Edge Cases
- **连续 `_`**: 保留（如 `ext_grateful` 本身没有）
- **大小写**: 保持小写（ontology 保证 activity id 本来小写）
- **结尾字符**: 忽略末尾的 `_`（理论上不会发生）
---
## 4. Handler Interface
### 4.1 Activity & Event Handler
```js
// nas-package://nimi/activity/happy.js
export default {
  // 可选：元数据（纯信息用途）
  meta: {
    description: "Handle happy activity — play joy motion with expression",
    author: "Model Creator Name"
  },
  /**
   * @param {AgentDataBundle} ctx — 当前 agent data（见 §5）
   * @param {EmbodimentProjectionAPI} projection — current backend control API（见 §6）
   * @param {AbortSignal} signal — 抢占信号（§12.1）
   * @returns {Promise<void>}
   */
  async execute(ctx, projection, { signal }) {
    if (ctx.activity.intensity === "strong" && ctx.posture.action_family === "engage") {
      await projection.triggerMotion("celebration.extreme", { priority: "high" });
      await projection.setExpression("smile.bright");
    } else if (ctx.activity.intensity === "weak") {
      await projection.triggerMotion("joy.small");
    } else {
      await projection.triggerMotion("joy.default");
      await projection.setExpression("smile.default");
    }
  }
};
```
### 4.2 Continuous Handler ⚠️ [分叉 45 — Option B]
**规则**: Handler 声明 `fps` 字段，runtime 按声明频率调度。
```js
// nas-package://nimi/continuous/eye_tracker.js
export default {
  fps: 60,                              // 目标频率（default 60 if omitted）
  enabled: true,                        // 可选，默认 true
  meta: {
    description: "Eye tracking follows mouse cursor"
  },
  /**
   * @param {AgentDataBundle} ctx
   * @param {EmbodimentProjectionAPI} projection
   */
  update(ctx, projection) {
    const x = clamp(ctx.app.cursor_x / ctx.app.window.width - 0.5, -1, 1);
    const y = clamp(ctx.app.cursor_y / ctx.app.window.height - 0.5, -1, 1);
    projection.setSignal("gaze.x", x);
    projection.setSignal("gaze.y", -y);
    projection.setSignal("head.yaw", x * 30);
    projection.setSignal("head.pitch", -y * 30);
  }
};
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
```
**理由**: Runtime 按声明 fps 调度，降低 CPU 浪费；简单 config 不复杂。
### 4.3 共享 Utilities
`nimi/lib/` 里的 `.js` **不被 runtime 自动加载**，只供其他 handlers import:
```js
// nas-package://nimi/lib/wave_sequence.js
export async function waveSequence(projection, { hand = "right", duration_ms = 3000 }) {
  const motion = hand === "right" ? "wave.right" : "wave.left";
  await projection.triggerMotion(motion, { priority: "high" });
  await projection.wait(duration_ms);
  await projection.triggerMotion("idle.default");
}
// nas-package://nimi/activity/greet.js
import { waveSequence } from "../lib/wave_sequence.js";
export default {
  async execute(ctx, projection) {
    await waveSequence(projection, { hand: "right", duration_ms: 3000 });
  }
};
```
以 `_` 开头的 lib 文件（如 `_internal.js`）也不加载（保留给 creator 做内部组织）。
---
## 5. Agent Data Bundle (`ctx`)
Handler 接收的 `ctx`（TypeScript interface）:
```typescript
interface AgentDataBundle {
  // Activity context (仅 activity handler 或
  // runtime.agent.presentation.activity_requested event 时存在)
  activity?: {
    name: string;                       // "happy", "ext:grateful", "ext:proud"
    category: "emotion" | "interaction" | "state";
    intensity: "weak" | "moderate" | "strong" | null;
    source: "apml_output" | "direct_api" | "mock";
  };
  // Posture (always from runtime.agent.state)
  posture: {
    posture_class: string;
    action_family: "observe" | "engage" | "support" | "assist" | "reflect" | "rest";
    interrupt_mode: "welcome" | "cautious" | "focused";
    transition_reason: string;
    truth_basis_ids: string[];
  };
  // Status (always)
  status_text: string;
  execution_state: "IDLE" | "CHAT_ACTIVE" | "LIFE_PENDING" | "LIFE_RUNNING" | "SUSPENDED";
  active_world_id: string;
  active_user_id: string;
  // History (opt-in via config.json)
  history?: {
    last_activity: { name: string; at: string } | null;
    last_motion: { group: string; at: string } | null;
    last_expression: { name: string; at: string } | null;
  };
  // Event context (event handler 收到的触发事件)
  event?: {
    event_name: string;                 // canonical event name
    event_id: string;
    timestamp: string;                  // ISO8601
    detail: Record<string, any>;
  };
  // App context (always)
  app: {
    namespace: string;                  // "avatar"
    surface_id: string;
    visible: boolean;
    focused: boolean;
    window: { x: number; y: number; width: number; height: number };
    cursor_x: number;                   // relative to window
    cursor_y: number;
  };
  // Runtime meta (always)
  runtime: {
    now: string;                        // ISO8601
    session_id: string;
    locale: string;
  };
  // Custom extensions (future)
  custom?: Record<string, any>;
}
```
Runtime 在每次触发 handler 前打包最新 bundle。
### 5.1 History Opt-in
`history` 字段默认关闭（性能考量）。Package 通过 `nas-package://nimi/config.json` 启用:
```json
{
  "history_context": {
    "enabled": true,
    "window_seconds": 60,
    "track": ["activity", "motion", "expression"]
  }
}
```
---
## 6. Embodiment Backend API v1 ⚠️ [分叉 46 — Option B]
v1 covers subset: motion cue + signal channel + expression + pose + wait。Physics / lipsync / drag 由 avatar app 内置，handler 不直接碰。当前 shipped branch 由 Live2D 实现该 API。
### 6.1 v1 API Surface
```typescript
interface EmbodimentProjectionAPI {
  // ========== Motion cue ==========
  triggerMotion(motionId: string, opts?: {
    priority?: "low" | "normal" | "high";
    loop?: boolean;
    fadeIn?: number;
    fadeOut?: number;
  }): Promise<void>;
  stopMotion(): void;
  // ========== Signal / control channels ==========
  setSignal(signalId: string, value: number, weight?: number): void;
  getSignal(signalId: string): number;
  addSignal(signalId: string, delta: number): void;
  // ========== Expression ==========
  setExpression(expressionId: string): Promise<void>;
  clearExpression(): void;
  // ========== Pose (durable) ==========
  setPose(poseId: string, loop?: boolean): void;
  clearPose(): void;
  // ========== Utility ==========
  wait(ms: number): Promise<void>;
  getSurfaceBounds(): { x: number; y: number; width: number; height: number };
  // ========== Optional backend-owned fallback ==========
  runDefaultActivity?(activityId: string, options: {
    signal: AbortSignal;
    bundle: AgentDataBundle;
  }): Promise<void>;
}
```
### 6.2 v2+ 扩展 (future)
未来版本加入（不在本 baseline）:
- Physics: `applyForce(point, vector)`
- Lipsync: `startLipsync(audio)` / `setMouthOpenValue(v)`
- Drag: `setDragOrigin(x, y)`
- Blend: `blendMotion(from, to, duration)`
先由 avatar app 内置机制处理，handler 不直接控制。
---
## 7. Default Fallback Mechanism ⚠️ [分叉 47 — Option B]
Activity handler 缺失 → neutral NAS layer 委托给 backend-owned default fallback hook（若 backend 未提供则 skip + warn）；event handler 缺失 → silent skip。
### 7.1 Activity Fallback
```js
async function defaultActivityHandler(ctx, projection, { signal }) {
  const id = ctx.activity.name;
  if (!projection.runDefaultActivity) {
    console.warn(`No backend default activity fallback for ${id}`);
    return;
  }
  await projection.runDefaultActivity(id, { signal, bundle: ctx });
}
```
当前 Live2D branch 的 `runDefaultActivity` 规则是 `activityIdToMotionGroup`：
split by `-` / `:` → CamelCase 每段 → prefix `Activity_`:
| Activity id | Fallback motion group |
|---|---|
| `happy` | `Activity_Happy` |
| `ext:grateful` | `Activity_ExtGrateful` |
| `ext:proud` | `Activity_ExtProud` |
### 7.2 Event Fallback
Default = silent skip。大多数 event 没有有意义的 default 行为。
### 7.3 Lifecycle Events 的 Default
部分 lifecycle event（如 `avatar.app.ready`）由 avatar app 自己处理（加载默认 backend package / 播放 welcome cue 等），不通过 handler。
---
## 8. Hot Reload ⚠️ [分叉 48 — Option B]
Dev + production 都支持。
### 8.1 Reload Triggering
Avatar app 启动 Tauri `notify` file watcher 监听 `<model>/runtime/nimi/` 目录。任意 JS 文件变更 → 触发 reload。Watcher event 只作为 reload trigger；canonical handler truth 仍来自重新扫描目录与重新加载 handler source，不来自 watcher payload 推断。
### 8.2 Reload Flow
```
File change detected (e.g. nas-package://nimi/activity/happy.js)
  ↓
Parse new module
      ├── Syntax error → reject, log, keep old handler
      └── Valid → proceed
      ↓
Atomic swap in handler registry
      ↓
In-flight execute() continues to completion with old handler
      ↓
Next invocation uses new handler
      ↓
Emit avatar.model.script.reloaded event
```
### 8.3 Continuous Handler Reload
Continuous handler 的 `update` 被重载后，**下一帧**开始用新 handler。Reload 失败不得改变 active continuous handler set。
### 8.4 Reload Event Payload
```yaml
avatar.model.script.reloaded:
  detail:
    model_id: string
    changed_files: [string]          # e.g. ["nas-package://activity/happy.js"]
    reload_mode: "add" | "update" | "remove"
    applied: bool                    # false means old registry remains active
    validation_errors: [string]      # if any
```
---
## 9. Sandbox & Security
Handler 是第三方 JS，必须 sandbox。NAS 1.0 runtime **硬切为
Worker-backed capability-RPC sandbox**，不再把 sandbox 机制留作未来议题。

### 9.1 Worker-backed capability boundary
- 每个 discovered handler 在 dedicated module Worker 中加载和执行。
- Renderer main thread 不再通过 `Blob` URL 直接 `import()` 第三方 handler。
- Handler 与外界的唯一交互面是启动时传入的 `ctx`、`projection` capability
  object、`AbortSignal`，以及安全工具（`Math` / `Date` / `console` subset）。
- Worker 内禁用 ambient network/storage globals：`fetch` / `XMLHttpRequest` /
  `WebSocket` / `EventSource` / `localStorage` / `sessionStorage` /
  `indexedDB` / `caches` / `importScripts`。
- Source policy fail-close 拒绝引用 `window` / `document` / `globalThis` /
  `self` / `postMessage` / 上述 network/storage globals、package import、dynamic
  import、out-of-tree relative import、non-default handler export、`eval`、
  `Function`、`constructor`。唯一 admitted import 是 handler 对同一
  `<model>/runtime/nimi/lib/*.js` 下 helper 的 static relative named import；
  lib helper 仍受同一 ambient API 禁令约束，且不得 import package、
  dynamic import、或越过 `runtime/nimi/lib/` 边界。
- Handler source policy violation、module load failure、malformed default export,
  or worker boot failure **must not register** a handler.

### 9.2 Capability RPC projection
Worker handler cannot receive renderer/backend objects. `projection` is a
capability-RPC proxy with an explicit allow-list:
`triggerMotion`, `stopMotion`, `setSignal`, `addSignal`, `setExpression`,
`clearExpression`, `setPose`, `clearPose`, and optional `runDefaultActivity`.
Unknown capability methods are rejected fail-closed.

`projection.wait(ms)` is local to the Worker. `projection.getSurfaceBounds()`
returns the invocation-start surface snapshot. `projection.getSignal(id)` reads
the handler-local signal mirror seeded for the invocation and updated by
`setSignal` / `addSignal`; it is not a live synchronous renderer read because
the Worker boundary cannot support synchronous main-thread RPC.

### 9.3 Execution budget and shutdown
- Activity/event `execute()` budget: 5000 ms.
- Continuous `update()` budget: 1000 ms.
- Timeout terminates the handler Worker and rejects the invocation; no
  placeholder success is allowed.
- Carrier shutdown cancels in-flight handlers, stops continuous scheduling, and
  terminates registered handler Workers.
Handler 异常不影响 avatar app 主流程（runtime catch + log），但必须 surface 为
error/warn evidence, never as success.
---
## 10. Handler Discovery & Registration
### 10.1 Discovery
Avatar app 加载 model 时：
```
1. Scan <model>/runtime/nimi/activity/*.js
   → Register as activity handler, key = filename without .js
2. Scan <model>/runtime/nimi/event/*.js
   → Register as event handler, key = denormalized event name (§10.2)
3. Scan <model>/runtime/nimi/continuous/*.js
   → Register as continuous handler
4. (nimi/lib/ 不自动加载；只被其他 handler import)
5. (`nas-package://nimi/config.json` 读取 feature flags)
```
### 10.2 Denormalization (File → Event Name)
反向映射 file name to event name:
| File | Event Name |
|---|---|
| `avatar_user_click.js` | `avatar.user.click` |
| `avatar_user_drag_end.js` | `avatar.user.drag.end` |
| `desktop_chat_message_send.js` | `desktop.chat.message.send` |
| `runtime_agent_state_posture_changed.js` | `runtime.agent.state.posture_changed` |
**规则**: `_` 替换为 `.`，但某些 event name 本身含 `_`（如 `focus_change`、`posture_changed`）—— 以 **event contract 注册表**为准。Avatar app 维护 known event names 表，file-to-event 解析走这张表。
**冲突处理**：若 denormalized event name 不在 registry 中 → log warn + ignore handler。
### 10.3 Handler 冲突
一个 activity / event 同时有多个 handler（如同时有 `nas-package://nimi/activity/happy.js` 和重复模型 handler）：
**v1 规则**：Model-provided handler 优先，不允许其他 handler 覆盖。额外扩展机制需要单独 authority admission。
---
## 11. config.json (Optional Feature Flags)
仅当 model 需要 opt-in feature 时存在:
```json
{
  "nas_version": "1.0",
  "model_id": "cute-avatar-v1",
  "history_context": {
    "enabled": true,
    "window_seconds": 60,
    "track": ["activity", "motion", "expression"]
  },
  "features": {
    "drag_physics": true,
    "lipsync_auto": true
  },
  "default_idle_motion": "Idle",
  "default_fallback_motion": "Idle"
}
```
**所有字段可选**。不存在 config.json → 全部走 default。

`nas-package://runtime/nimi/live2d-adapter.json`, when present, is not NAS configuration and
does not change NAS 1.0 into a declarative DSL. It is governed by
`live2d-asset-compatibility-contract.md` and only maps an existing Live2D
package to Avatar carrier compatibility tiers.
---
## 12. Handler Execution Model ⚠️ [分叉 49 — Option B]
### 12.1 Activity / Event Handler Execution
事件触发 → 找 handler → 调用 `execute(ctx, projection, { signal })` → 等 `Promise` resolve。新事件抢占旧执行：runtime 给旧的 `execute` 发 abort signal，handler 应 respect。
```js
export default {
  async execute(ctx, projection, { signal }) {
    await projection.triggerMotion("sequence.a", { priority: "high" });
    if (signal.aborted) return;
    await projection.wait(1000);
    if (signal.aborted) return;
    await projection.triggerMotion("sequence.b");
  }
};
```
`signal` 是标准 `AbortSignal`。不 respect 会导致 race condition，但 runtime 不硬性强制（handler 责任）。
### 12.2 Continuous Handler Execution
按 handler 声明的 `fps` 调度。每帧一次 `update(ctx, projection)`。
- Execute 是 **synchronous**（不 return Promise），防止帧间堆积
- 超过 frame budget（建议 `1000/fps * 0.5` ms）→ warn + skip 下一帧
- Handler 抛异常 → log + skip 本帧（不禁用 handler）
### 12.3 跨 Handler 协调
- Continuous 和 activity/event handler **并行执行**
- 多个 continuous handler **并行调用 update**（同帧内顺序由 filename 字典序决定）
- 如果 activity handler 改了某个 signal，continuous handler 同帧可能覆盖 — **model creator 自己协调**
---
## 13. Examples
### 13.1 最简 model: 只自定义 happy
```
my-model/
  my-model.cmo3                # source (not runtime-loaded)
  runtime/
    my-model.model3.json
    my-model.moc3
    motions/
    expressions/
    nimi/
      activity/
        happy.js               # 只有这个
```
```js
// nas-package://nimi/activity/happy.js
export default {
  async execute(ctx, projection) {
    await projection.triggerMotion("joy.custom");
    await projection.setExpression("smile.default");
  }
};
```
其他 19 个 core activity → current backend branch default fallback（当前 Live2D branch 使用 convention `Activity_<Name>`）。
### 13.2 Rich Model: Sequence + Continuous + Cross-app
```js
// nas-package://nimi/activity/greet.js
import { waveSequence } from "../lib/wave_sequence.js";
export default {
  async execute(ctx, projection, { signal }) {
    if (ctx.history?.last_activity?.name === "greet") {
      await projection.triggerMotion("bow.default");
      return;
    }
    await waveSequence(projection, { hand: "right", duration_ms: 2000 });
    if (signal.aborted) return;
    await projection.wait(500);
    await projection.setExpression("smile.bright");
  }
};
```
```js
// nas-package://nimi/event/avatar_user_click.js — 连续点击 state machine
let clickCount = 0;
let resetTimer = null;
export default {
  async execute(ctx, projection) {
    clickCount++;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { clickCount = 0; }, 2000);
    if (clickCount === 3 && ctx.event.detail.region === "head") {
      await projection.triggerMotion("tickled.special");
      clickCount = 0;
    } else if (ctx.event.detail.region === "head") {
      await projection.triggerMotion("shy.default");
      await projection.setExpression("blush.soft");
    }
  }
};
```
```js
// nas-package://nimi/continuous/eye_tracker.js
export default {
  fps: 60,
  update(ctx, projection) {
    const normX = (ctx.app.cursor_x / ctx.app.window.width - 0.5) * 2;
    const normY = (ctx.app.cursor_y / ctx.app.window.height - 0.5) * 2;
    const x = Math.max(-1, Math.min(1, normX));
    const y = Math.max(-1, Math.min(1, normY));
    projection.setSignal("gaze.x", x);
    projection.setSignal("gaze.y", -y);
    projection.setSignal("head.yaw", x * 30);
    projection.setSignal("head.pitch", -y * 20);
  }
};
```
---
## 14. Versioning & Evolution
- Major (1.x → 2.x): Break handler interface / API / convention
- Minor (1.0 → 1.1): Add ctx fields / API methods / feature flags
- Patch: Doc / validation fix
- 新增 activity id（ontology minor bump）→ handler file convention 自动扩展
- 改 file name normalization 规则 → NAS major bump
---
## 15. Decisions Summary
| # | 议题 | 决议 | 理由摘要 |
|---|---|---|---|
| **44** | File name normalization | ✅ Option A (非字母数字下划线 → `_`) | 扁平结构 + 单一规则 + filesystem-safe |
| **45** | Continuous handler frame rate | ✅ Option B (handler 声明 `fps`) | 灵活可控，runtime 按需调度 |
| **46** | Embodiment backend API v1 scope | ✅ Option B (motion cue + signal + expression + pose + wait) | 覆盖 90% 场景，physics/lipsync/drag 延后；当前 shipped branch 由 Live2D 实现 |
| **47** | Default fallback | ✅ Option B (branch-owned activity fallback hook) | Neutral NAS baseline 不编码单一 backend 语义；当前 Live2D branch 继续提供 convention fallback |
| **48** | Hot reload | ✅ Option B (dev + prod 都支持) | Model 调试 + 用户装新 model |
| **49** | Handler execution model | ✅ Option B (新事件抢占旧执行) | 符合 activity transient 语义 |
| **50** | Sandbox mechanism | ✅ Option B (Worker-backed capability RPC + source policy) | Third-party JS 不进入 renderer global scope；能力调用显式 allow-list；DOM/network/storage fail-close |
**NAS 1.0 baseline locked 2026-04-21; sandbox hard cut admitted 2026-04-25**。
---
## 附录 A: Activity Id → File Name Normalization
```
<activity-id> → <filename>.js
Rule: replace every char not in [a-z0-9_] with '_'
Examples:
  happy                          → happy.js
  ext:grateful                   → ext_grateful.js
  ext:proud                      → ext_proud.js
  ext:proud                      → ext_proud.js
```
## 附录 B: Event Name → File Name Normalization
```
<event-name> → <filename>.js
Rule: replace '.' with '_', keep existing '_'
Examples:
  avatar.user.click                        → avatar_user_click.js
  avatar.user.drag.end                     → avatar_user_drag_end.js
  desktop.chat.message.send                → desktop_chat_message_send.js
  runtime.agent.state.posture_changed      → runtime_agent_state_posture_changed.js
  runtime.agent.hook.completed             → runtime_agent_hook_completed.js
  system.focus.gained                      → system_focus_gained.js
```

## Reference Appendices

API cheatsheet and ctx quick reference moved to [`agent-script-reference.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml) in the same kernel authority root, so this contract stays focused on handler convention, sandbox, discovery, and execution model.

---

<!-- source: .nimi/spec/avatar/kernel/avatar-debug-session-contract.md -->

# Avatar Debug Session Contract

> Authority: Avatar Kernel

## Purpose

This contract admits Avatar-owned debug session intake and backend evidence for
Desktop Avatar configuration/debug workbench flows. Avatar consumes typed
Runtime probe envelopes and emits backend evidence. Avatar does not own Runtime
probe semantics, Desktop configuration UX, SDK method shape, APML public wire,
or delegated provider access.

## Avatar Debug Session Boundary

Avatar MAY accept typed debug sessions that reference:

- Runtime probe id
- authorized agent id
- optional avatar instance id
- typed package/profile refs
- backend kind
- probe kind

Avatar MUST NOT accept:

- package descriptors supplied in Desktop launch payload
- package paths supplied by Desktop launch payload
- scoped Desktop binding truth
- raw APML parser events
- raw MCP/A2A/delegated provider output
- raw app/business data
- tokens, account ids, user ids, Realm URLs, or auth material
- backend command strings from Desktop

## Backend Evidence

Avatar owns backend evidence for:

- package descriptor resolver execution
- backend load outcome
- backend capability profile validation
- generated motion route support
- emotion/expression support
- speech/lipsync support
- carrier diagnostics and hit region evidence
- Avatar-owned carrier visual readiness refs, including official-SDK Live2D
  preview artifact refs where the backend provides them
- Avatar-owned Live2D expression inventory refs where emotion/expression
  support is claimed by the loaded Live2D backend
- Avatar-owned Live2D backend evidence pack refs for backend load,
  compatibility/capability profile, route support, speech/lipsync,
  hit-region readiness, and parameter-lane diagnostics
- opaque Live2D calibration refs projected by the Avatar local asset resolver
  as read-only, effect-blocked evidence

Evidence shape is pinned by `tables/avatar-debug-session.schema.yaml`.

## Resolver Execution

Avatar performs package descriptor and backend capability profile resolver
execution after authorized Runtime/SDK projection. Current Agent Center resolver
plumbing may materialize local files, but it is not package lifecycle,
inventory, or activation authority.

Desktop stores opaque refs only. Runtime owns authorization and probe semantics.
SDK carries typed refs and methods only. No owner may create a second resolver
for Avatar backend files in this debug-session boundary.

`live2d_calibration_ref`, when present, is resolver evidence only. It is not a
calibration payload, not model digest truth, not render/framing policy, and not
carrier effect authority.

## Result Semantics

Avatar backend evidence can support a Runtime probe result, but Avatar does not
own public Runtime probe semantics. Avatar may submit an evidence-backed probe
result only through Runtime's typed submit path. Runtime validates the agent,
anchor, probe kind, result status, permission scope, scoped binding attachment,
and evidence refs before accepting the public probe result envelope.

Runtime owns replay semantics and final public diagnostic projection. Avatar
owns the local backend debug session evidence that it submits by ref.

Unsupported backend capability is fail-closed evidence. It must not be reported
as success through idle fallback, `.vrma` playback, static image fallback, or
placeholder profile data.

## `.vrma` Position

`.vrma` remains interchange/authoring evidence only. It may appear in existing
VRM loader or asset evidence, but it is not debug success proof and not required
runtime support proof.

## Implementation Availability Boundary

This contract admits Avatar debug session authority and schema only. Avatar
debug session runtime code, SDK methods, Desktop UI, and product support
require their own implementation and test evidence before support is claimed.

---

<!-- source: .nimi/spec/avatar/kernel/agent-script-reference.md -->

# Agent Script Contract Reference Appendices

This file carries the reference appendices for [`agent-script-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml). It remains under `.nimi/spec/avatar/**` authority and does not introduce parallel semantic truth.

## Appendix C: Embodiment Backend API v1 Cheatsheet

```typescript
// Motion
await projection.triggerMotion(id, { priority, loop, fadeIn, fadeOut });
projection.stopMotion();
// Signals / control channels
projection.setSignal(id, value, weight?);
const v = projection.getSignal(id);
projection.addSignal(id, delta);
// Expression
await projection.setExpression(id);
projection.clearExpression();
// Pose (durable)
projection.setPose(id, loop?);
projection.clearPose();
// Utility
await projection.wait(ms);
const bounds = projection.getSurfaceBounds();
```

## Appendix D: ctx quick reference

```typescript
ctx.activity?.{name, category, intensity, source}
ctx.posture.{posture_class, action_family, interrupt_mode, transition_reason, truth_basis_ids}
ctx.status_text
ctx.execution_state
ctx.active_world_id / active_user_id
ctx.history?.{last_activity, last_motion, last_expression}   // opt-in
ctx.event?.{event_name, event_id, timestamp, detail}
ctx.app.{namespace, surface_id, visible, focused, window, cursor_x, cursor_y}
ctx.runtime.{now, session_id, locale}
```

---
