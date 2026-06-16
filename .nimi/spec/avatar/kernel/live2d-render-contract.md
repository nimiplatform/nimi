# Live2D Render Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: Active `kind: 'live2d'` BackendBranch implementation authority.
> **Sibling contracts**:
> - [Backend branch contract](backend-branch-contract.md) — multi-backend carrier abstraction
> - [VRM backend contract](vrm-backend-contract.md)
> - [Embodiment projection contract](embodiment-projection-contract.md)
> - [Live2D asset compatibility contract](live2d-asset-compatibility-contract.md)
> - [App shell contract](app-shell-contract.md)
> - [Agent script contract](agent-script-contract.md)
> - [Avatar event contract](avatar-event-contract.md)

---

## Scope

This contract is the `kind: 'live2d'` BackendBranch implementation detail.
Multi-backend carrier abstraction, BackendProjection ontology surface,
BackendAudioConsumer wLipSync pipeline, BackendHitRegion, BackendNominalBounds,
and BackendSurface lifecycle live in
[`backend-branch-contract.md`](backend-branch-contract.md).

This contract **does not** define the carrier-public contract; it defines how
the Live2D branch implements `BackendBranch` using Cubism SDK for Web. Other
backend branches (VRM in `vrm-backend-contract.md`, future 3D / robot) implement
the same `BackendBranch` interface with their own contracts.

Cross-references:

- BackendProjection ontology methods (`applyActivity` / `applyEmotion` /
  `applyMotion` / `applyExpression`) → ontology naming admit by
  `embodiment-projection-contract.md` and `tables/activity-mapping.yaml`
- Live2D parameter-id direct write → `Live2DBackendExtension.setParameter`
  escape hatch (kind-narrowed; NAS handler must declare
  `requires: ['live2d-extension']`)
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
[`live2d-asset-compatibility-contract.md`](live2d-asset-compatibility-contract.md).
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
6. Avatar local look-at / idle-life lane where admitted by later waves
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
- The direct write is available only to admitted Avatar-local callers that hold
  the `live2d-extension` capability or Avatar voice/lipsync carrier code.
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
direct writes only through `Live2DBackendExtension`; their filename/call-order
arbitration happens before the final direct parameter lane receives the current
Avatar-local command-state snapshot.

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
