# Live2D Render Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: App-local kernel contract
> **Status**: Phase 1 baseline draft
> **Sibling contracts**:
> - [Embodiment projection contract](embodiment-projection-contract.md)
> - [App shell contract](app-shell-contract.md)
> - [Agent script contract](agent-script-contract.md)
> - [Avatar event contract](avatar-event-contract.md)

---

## 0. 阅读指南

本 contract 定义 Nimi Avatar 当前 shipped backend branch 的 Live2D backend execution pipeline：Cubism SDK for Web 官方集成边界、model loading、motion / expression / physics / parameter API、backend command-state update、NAS continuous handler 帧调度、默认 Cubism 行为（breath / blink / lipsync）与 NAS override 边界。

Wave 4 hard cut: current Avatar app evidence proves Live2D model/resource loading, command-state mutation, Cubism `model.update()`, and NAS continuous scheduling. It does **not** claim Avatar carrier WebGL canvas draw-loop proof. Desktop chat has a separate Cubism WebGL renderer; that implementation cannot be used as active proof for this Avatar app carrier branch.

**本 contract 不定义** embodiment projection canonical truth（见 `embodiment-projection-contract.md`）、NAS handler convention（见 `agent-script-contract.md`）或 shell / window 行为（见 `app-shell-contract.md`）。

---

## 1. SDK Integration Boundary

### 1.1 Cubism SDK for Web 使用方式 (NAV-L2D-001)

- **不 fork** Cubism SDK
- 通过官方 `@live2d/cubism-framework` + native `Live2DCubismCore.js` 依赖接入
- App-local 代码只在 SDK 外层做 wrap（model 管理、参数派发、NAS API 绑定）

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

### 2.1 Loading Entry Point (NAV-L2D-002)

Avatar app 接收 `model_path`（来自 `avatar.app.start.detail.model_path` 或 default config）：

```
1. 解析 <model>/runtime/ 目录（若 path 指向 package 顶层，locate runtime/ 子目录）
2. Glob runtime/*.model3.json，取第一个匹配（单 model per package 假设）
3. Parse model3.json，提取 references（moc3 / textures / motions / expressions / physics / pose / cdi）
4. 按官方 SDK API 加载 MOC3 / textures → create Cubism model instance
5. 若存在 physics3.json / pose3.json / cdi3.json → 自动 attach
6. 若存在 motions/*.motion3.json → 注册到 motion manager（group 名从 model3.json `Groups` / `FileReferences.Motions` 读）
7. 若存在 expressions/*.exp3.json → 注册到 expression manager
8. 若存在 runtime/nimi/ → 触发 NAS handler discovery（见 agent-script-contract §10）
9. 若存在 runtime/nimi/config.json → 应用 feature flags
10. Compute model bounds → emit avatar.model.load + 通知 shell 调整 window
```

Existing-asset adaptation is governed by
[`live2d-asset-compatibility-contract.md`](live2d-asset-compatibility-contract.md).
The loader may consume an Avatar-owned adapter manifest only through that
contract's explicit manifest sources. It must not silently rewrite upstream
Cubism assets or treat arbitrary Live2D package loading as semantic companion
support.

### 2.2 Model-ID 推断 (NAV-L2D-003)

`model_id` = `*.model3.json` 文件名去掉 `.model3.json` 后缀。

| File | model_id |
|---|---|
| `ren.model3.json` | `ren` |
| `cute-avatar.model3.json` | `cute-avatar` |

### 2.3 Model Lifecycle (NAV-L2D-004)

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

### 3.1 Frame Cadence (NAV-L2D-005)

- NAS continuous scheduler 运行于 `requestAnimationFrame`，目标 60fps（浏览器 vsync）
- Current Avatar app backend-session applies commands and calls Cubism `model.update()` when command-state changes.
- Avatar carrier WebGL `preDraw` / `draw` / `postDraw` proof is not admitted in Phase 1. A later visual-render wave must add deterministic canvas proof before this contract may claim Avatar carrier draw-loop closure.

### 3.2 Delta Time

- 传给 Cubism 的 `deltaTime` 来自 `performance.now()` 差值
- Tab visibility: Tab hidden 时 rAF pause，resume 时 deltaTime 不堆积（clamp to 100ms）

---

## 4. NAS Continuous Handler Frame Sync

### 4.1 调度规则 (NAV-L2D-006)

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
- 连续 10 帧超预算 → emit `avatar.model.handler.throttled` event (not implemented in current Phase 1; this event remains blocked until frame-budget enforcement lands)

---

## 5. Motion System (NAV-L2D-007)

### 5.1 Motion Group 命名 Convention

Live2D branch 默认 activity fallback 查的 motion group 名：`Activity_<CamelCase>`（见 `tables/activity-mapping.yaml`），并按 intensity 追加 `_Weak` / `_Strong` 后缀。这是 branch-owned fallback，不属于 neutral NAS baseline。

| Activity id | Motion group | Scope |
|---|---|---|
| `happy` | `Activity_Happy` | core emotion |
| `ext:grateful` | `Activity_ExtGrateful` | extended |
| `mod-weather:storm-watching` | `Activity_ModWeatherStormWatching` | mod custom |

### 5.2 Motion Priority

三档：`low` / `normal` / `high`（映射到 Cubism `CubismMotionPriority`）：

| Priority | 语义 | Cubism |
|---|---|---|
| `low` | 可被 normal/high 打断 | `PRIORITY_IDLE` |
| `normal` (default) | 可被 high 打断 | `PRIORITY_NORMAL` |
| `high` | 覆盖一切（包括当前 high） | `PRIORITY_FORCE` |

### 5.3 Default Idle Motion

`runtime/nimi/config.json` 的 `default_idle_motion`（default `"Idle"`）：

- 无 activity / event 驱动时，每 5 秒随机播一次 idle motion group 内的 motion
- 由 Cubism 官方 idle motion selector 实现（`CubismMotionManager.startMotion(..., priority=PRIORITY_IDLE)`）

---

## 6. Expression System (NAV-L2D-008)

### 6.1 Expression Stack

Cubism 支持 expression overlay。Nimi Avatar 只维护**单一 active expression**：

- `setExpression(id)` → blend out 旧，blend in 新（300ms fade）
- `clearExpression()` → blend out 当前，归位 default params

### 6.2 Blend Time

- Default: 300ms fadeIn / 300ms fadeOut
- 不暴露 handler 控制（简化 API v1）

---

## 7. Physics & Auto Behaviors

### 7.1 Physics (NAV-L2D-009)

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

### 7.4 Auto Lipsync (NAV-L2D-013)

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

### 8.1 Direct Parameter Access (NAV-L2D-010)

当前 Live2D backend branch 提供 parameter read/write/add：

```typescript
live2d.setParameter(id: string, value: number, weight?: number): void;
live2d.getParameter(id: string): number;
live2d.addParameter(id: string, delta: number): void;
```

- `id` 用 Cubism 官方 parameter id（如 `ParamEyeBallX` / `ParamAngleX` / `ParamBreath`）
- `weight` 0-1，default 1（完全覆盖）
- 值 clamp 到 parameter 声明的 `[min, max]` 范围
- 未声明的 parameter id → `console.warn` + no-op

### 8.2 Parameter Apply Order

同帧内多 source 改同 parameter 的 resolve 顺序：

```
1. Motion manager (current playing motion)
2. Expression manager (current expression, with weight)
3. Physics (auto physics)
4. Auto breath / blink
5. NAS continuous handlers (filename 字典序)
6. NAS activity / event handlers (后调用覆盖前)
```

最后生效的值写入 MOC3。

### 8.3 Pose System (NAV-L2D-011)

`setPose(group, loop)` 持续设置某 motion group 作为 "durable pose"：

- Pose 优先级高于 motion（pose active 时 motion 不覆盖 pose-controlled params）
- `clearPose()` 清除 pose，motion 恢复控制
- Pose motion 可 loop（default `false`）

---

## 9. Hit Testing (for Avatar Shell)

### 9.1 Model Hit Region (NAV-L2D-012)

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

**Phase 1 scope**: Cubism SDK for Web 集成 + Plugin API v1。Phase 2+ 加入 voice-driven lipsync 和 advanced physics；Phase 3 考虑多 backend 抽象（VRM / 3D）。
