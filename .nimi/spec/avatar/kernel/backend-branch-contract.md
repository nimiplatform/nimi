# Backend Branch Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: Active multi-backend carrier authority
> **Sibling contracts**:
> - [VRM backend contract](vrm-backend-contract.md)
> - [Live2D render contract](live2d-render-contract.md)
> - [Nimi2D backend contract](nimi2d-backend-contract.md)
> - [Embodiment projection contract](embodiment-projection-contract.md)
> - [App shell contract](app-shell-contract.md)
> - [Avatar event contract](avatar-event-contract.md)
> - [Carrier visual acceptance contract](carrier-visual-acceptance-contract.md)

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

- 在 `.nimi/spec/avatar/kernel/` 内 admit；不导出到 `kit/**`
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
