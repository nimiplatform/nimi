# Agent Script Contract — NimiAgentScript (NAS) 1.0

> **App**: `@nimiplatform/nimi-avatar`
> **Authority**: App-local kernel contract
> **Status**: Baseline locked 2026-04-21 (migrated from topic proposal 议题 4b)
> **Upstream platform refs**:
> - [APML 1.0 wire format](../../../../.nimi/local/report/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/apml-design.md)
> - [Activity ontology](../../../../.nimi/local/report/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/activity-ontology.md)
> - [Platform event contract](../../../../.nimi/local/report/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/event-hook-contract.md)
> - [Runtime transient presentation seam](../../../../.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
> **Sibling kernel contracts**:
> - [Avatar event contract](avatar-event-contract.md)
> - [Live2D render contract](live2d-render-contract.md)
> - [App shell contract](app-shell-contract.md)
> - [Mock fixture contract](mock-fixture-contract.md)

---

## 0. 阅读指南

本 contract 定义 **NimiAgentScript (NAS) 1.0** —— 由 Live2D（未来扩展到 VRM / 3D / Lottie 等）model 创作者编写的 **convention-based JavaScript handlers**，为自己的 model 实现具体动作 / 表情 / 交互逻辑。

**核心 framing**：NAS 不是 declarative DSL / mapping config。它是一套 **file-system convention**：model creator 在 `<model>/runtime/nimi/` 目录下放 JS 文件，文件路径对应 agent data 或 event，avatar app 的 runtime 自动发现并执行。**6 个分叉点**（44-49）均已按推荐锁定。

**关键价值**：让第三方 model 开发者通过写 JS 代码获得**完整 Live2D 控制能力**（motion / parameter / expression / sequence / state machine / eye tracking / drag physics），实现真正的交互亮点。

---

## 1. Purpose & Scope

### 1.1 Why NAS

APML `<activity>` / `<expression>` / `<pose>` 是**语义意图**。每个 model 要把意图转成具体 Live2D 行为 —— 单纯 declarative mapping（"happy → motion X"）**不够**，因为:

- 复杂动作需要 **sequence**（挥手 → 鞠躬 → 微笑）
- 动态响应需要 **parameter direct control**（眼神跟随 cursor）
- 交互需要 **state machine**（连续点击 3 次触发特殊反应）
- Physics / drag / lipsync 需要 **调用 Live2D SDK**

这些都需要 **JS 编程能力**。NAS 就是"以 convention 的方式组织这些 JS handler"。

### 1.2 Target User

**Model creator / 第三方 Avatar model 开发者**：

- 做 Live2D 美术 + 动作 + JS 代码
- **不是** app developer（app dev 用 SDK API code）
- **不是** Nimi 内部（runtime / SDK 由 Nimi 团队实现）
- **不是** end user（UI-level 自定义由 app 自己处理）

### 1.3 Scope

**In-scope**:
- 目录 convention（`<model>/runtime/nimi/` 下 handler 文件的路径规则）
- Handler interface（3 种类型：activity / event / continuous）
- Agent data bundle context 形态
- Live2D Plugin API v1 scope
- Default fallback 机制
- Hot reload 语义
- File name normalization 规则（activity id / event name → 文件名）

**Out-of-scope**:
- 具体 sandbox 机制（下个 session 讨论）
- 具体 pub/sub broker 实现（属 runtime implementation）
- JS 运行时选型（QuickJS / iframe / Web Worker 等，属 implementation）
- VRM / 3D backend 具体 API（future）
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

Handler 不存在 → avatar runtime 用 built-in default：

- **Activity**: 按 `Activity_<CamelCase>` convention 查 Live2D motion group 播放
- **Event**: 大多数 event 无 default（silently skip）

Model creator 只为想**自定义**的 activity / event 写 handler。零 handler 就能跑（走所有 default）。

### 2.4 运行位置

NAS handler 在 **avatar app process 内**运行，由 SDK 提供 handler runtime + Live2D API:

```
Runtime (Nimi daemon)
    │ typed agent data via gRPC
    ▼
Avatar App (Tauri)
  ┌───────────────────────────┐
  │ SDK (TS + Rust)           │
  │  ├ Handler discoverer     │  ← scan <model>/runtime/nimi/
  │  ├ Handler runtime (sandbox) │
  │  └ Live2D Plugin API      │
  └───────────┬───────────────┘
              │ Live2D commands
              ▼
  ┌───────────────────────────┐
  │ Live2D Cubism Web SDK     │
  └───────────────────────────┘
```

---

## 3. Directory Structure

### 3.1 Live2D Cubism 官方结构（Reference）

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
        mod_weather_storm_watching.js # mod custom: "mod-weather:storm-watching"

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
6. 读取 runtime/nimi/config.json（若存在）应用 feature flags
7. Emit avatar.app.ready
```

若 `runtime/nimi/` 不存在 → 所有 activity 走 default fallback（convention-based motion group naming，见 §7）。Model 仍可用，只是没有自定义行为。

### 3.5 File Name Normalization ⚠️ [分叉 44 — Option A]

**规则**: 替换所有非 `[a-z0-9_]` 为 `_`。

| Identifier | 文件名 |
|---|---|
| `happy` | `happy.js` |
| `ext:grateful` | `ext_grateful.js` |
| `mod-weather:storm-watching` | `mod_weather_storm_watching.js` |
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
// nimi/activity/happy.js
export default {
  // 可选：元数据（纯信息用途）
  meta: {
    description: "Handle happy activity — play joy motion with expression",
    author: "Model Creator Name"
  },

  /**
   * @param {AgentDataBundle} ctx — 当前 agent data（见 §5）
   * @param {Live2DAPI} live2d — Live2D control API（见 §6）
   * @param {AbortSignal} signal — 抢占信号（§12.1）
   * @returns {Promise<void>}
   */
  async execute(ctx, live2d, { signal }) {
    if (ctx.activity.intensity === "strong" && ctx.posture.action_family === "engage") {
      await live2d.playMotion("Emotion_ExtremeJoy", { priority: "high" });
      live2d.setExpression("bright_smile");
    } else if (ctx.activity.intensity === "weak") {
      await live2d.playMotion("Emotion_SmallJoy");
    } else {
      await live2d.playMotion("Emotion_Joy");
      live2d.setExpression("smile");
    }
  }
};
```

### 4.2 Continuous Handler ⚠️ [分叉 45 — Option B]

**规则**: Handler 声明 `fps` 字段，runtime 按声明频率调度。

```js
// nimi/continuous/eye_tracker.js
export default {
  fps: 60,                              // 目标频率（default 60 if omitted）
  enabled: true,                        // 可选，默认 true

  meta: {
    description: "Eye tracking follows mouse cursor"
  },

  /**
   * @param {AgentDataBundle} ctx
   * @param {Live2DAPI} live2d
   */
  update(ctx, live2d) {
    const x = clamp(ctx.app.cursor_x / ctx.app.window.width - 0.5, -1, 1);
    const y = clamp(ctx.app.cursor_y / ctx.app.window.height - 0.5, -1, 1);
    live2d.setParameter("ParamEyeBallX", x);
    live2d.setParameter("ParamEyeBallY", -y);
    live2d.setParameter("ParamAngleX", x * 30);
    live2d.setParameter("ParamAngleY", -y * 30);
  }
};

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
```

**理由**: Runtime 按声明 fps 调度，降低 CPU 浪费；简单 config 不复杂。

### 4.3 共享 Utilities

`nimi/lib/` 里的 `.js` **不被 runtime 自动加载**，只供其他 handlers import:

```js
// nimi/lib/wave_sequence.js
export async function waveSequence(live2d, { hand = "right", duration_ms = 3000 }) {
  const motion = hand === "right" ? "Motion_WaveRight" : "Motion_WaveLeft";
  await live2d.playMotion(motion, { priority: "high" });
  await live2d.wait(duration_ms);
  await live2d.playMotion("Idle");
}

// nimi/activity/greet.js
import { waveSequence } from "../lib/wave_sequence.js";

export default {
  async execute(ctx, live2d) {
    await waveSequence(live2d, { hand: "right", duration_ms: 3000 });
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
    name: string;                       // "happy", "ext:grateful", "mod-weather:storm-watching"
    category: "emotion" | "interaction" | "state";
    intensity: "weak" | "moderate" | "strong" | null;
    source: "runtime_projection" | "direct_api";
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

`history` 字段默认关闭（性能考量）。Model 通过 `nimi/config.json` 启用:

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

## 6. Live2D Plugin API v1 ⚠️ [分叉 46 — Option B]

v1 covers subset: motion + parameter + expression + pose + wait。Physics / lipsync / drag 由 avatar app 内置，handler 不直接碰。

### 6.1 v1 API Surface

```typescript
interface Live2DAPI {
  // ========== Motion ==========
  playMotion(group: string, opts?: {
    priority?: "low" | "normal" | "high";
    loop?: boolean;
    fadeIn?: number;
    fadeOut?: number;
  }): Promise<void>;

  stopMotion(): void;

  // ========== Parameter (核心) ==========
  setParameter(id: string, value: number, weight?: number): void;
  getParameter(id: string): number;
  addParameter(id: string, delta: number): void;

  // ========== Expression ==========
  setExpression(id: string): Promise<void>;
  clearExpression(): void;

  // ========== Pose (durable) ==========
  setPose(group: string, loop?: boolean): void;
  clearPose(): void;

  // ========== Utility ==========
  wait(ms: number): Promise<void>;
  getModelBounds(): { x: number; y: number; width: number; height: number };
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

Activity handler 缺失 → built-in convention fallback；event handler 缺失 → silent skip。

### 7.1 Activity Fallback

```js
async function defaultActivityHandler(ctx, live2d) {
  const id = ctx.activity.name;
  const motionGroup = activityIdToMotionGroup(id);  // "happy" → "Activity_Happy"

  try {
    await live2d.playMotion(motionGroup, { priority: "normal" });
  } catch (e) {
    await live2d.playMotion("Idle", { priority: "low" });
  }
}
```

`activityIdToMotionGroup` 规则：split by `-` / `:` → CamelCase 每段 → prefix `Activity_`:

| Activity id | Fallback motion group |
|---|---|
| `happy` | `Activity_Happy` |
| `ext:grateful` | `Activity_ExtGrateful` |
| `mod-weather:storm-watching` | `Activity_ModWeatherStormWatching` |

### 7.2 Event Fallback

Default = silent skip。大多数 event 没有有意义的 default 行为。

### 7.3 Lifecycle Events 的 Default

部分 lifecycle event（如 `avatar.app.ready`）由 avatar app 自己处理（加载默认 model / 播放 welcome motion 等），不通过 handler。

---

## 8. Hot Reload ⚠️ [分叉 48 — Option B]

Dev + production 都支持。

### 8.1 Reload Triggering

Avatar app 启动 file watcher 监听 `<model>/runtime/nimi/` 目录。任意 JS 文件变更 → 触发 reload。

### 8.2 Reload Flow

```
File change detected (e.g. nimi/activity/happy.js)
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

Continuous handler 的 `update` 被重载后，**下一帧**开始用新 handler。

### 8.4 Reload Event Payload

```yaml
avatar.model.script.reloaded:
  detail:
    model_id: string
    changed_files: [string]          # e.g. ["activity/happy.js"]
    reload_mode: "add" | "update" | "remove"
    validation_errors: [string]      # if any
```

---

## 9. Sandbox & Security

Handler 是第三方 JS，必须 sandbox。**具体 sandbox 机制本 baseline 不决定**。占位要求：

- Handler 不能 access `window` / `document` / `fetch` / `localStorage` / network
- Handler 只能通过 `live2d` 和 `ctx` 两个 API 与外界交互
- 安全工具（`Math` / `Date` / `console` subset）可用
- Handler 异常不影响 avatar app 主流程（runtime catch + log）
- Continuous handler 每次 `update` 有 CPU budget（超时 → warn + skip 当帧）

具体选型（iframe / Web Worker / embedded QuickJS / SES）在后续议题讨论。

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
5. (nimi/config.json 读取 feature flags)
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

一个 activity / event 同时有多个 handler（如同时有 `nimi/activity/happy.js` 和 mod 注入）：

**v1 规则**：Model-provided handler 优先，不允许其他 handler 覆盖。Mod 扩展机制等 mod 体系 re-land 后定义。

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

---

## 12. Handler Execution Model ⚠️ [分叉 49 — Option B]

### 12.1 Activity / Event Handler Execution

事件触发 → 找 handler → 调用 `execute(ctx, live2d, { signal })` → 等 `Promise` resolve。新事件抢占旧执行：runtime 给旧的 `execute` 发 abort signal，handler 应 respect。

```js
export default {
  async execute(ctx, live2d, { signal }) {
    await live2d.playMotion("Motion_A", { priority: "high" });
    if (signal.aborted) return;
    await live2d.wait(1000);
    if (signal.aborted) return;
    await live2d.playMotion("Motion_B");
  }
};
```

`signal` 是标准 `AbortSignal`。不 respect 会导致 race condition，但 runtime 不硬性强制（handler 责任）。

### 12.2 Continuous Handler Execution

按 handler 声明的 `fps` 调度。每帧一次 `update(ctx, live2d)`。

- Execute 是 **synchronous**（不 return Promise），防止帧间堆积
- 超过 frame budget（建议 `1000/fps * 0.5` ms）→ warn + skip 下一帧
- Handler 抛异常 → log + skip 本帧（不禁用 handler）

### 12.3 跨 Handler 协调

- Continuous 和 activity/event handler **并行执行**
- 多个 continuous handler **并行调用 update**（同帧内顺序由 filename 字典序决定）
- 如果 activity handler 改了某参数，continuous handler 同帧可能覆盖 — **model creator 自己协调**

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
// nimi/activity/happy.js
export default {
  async execute(ctx, live2d) {
    await live2d.playMotion("MyCustomJoyMotion");
    live2d.setExpression("smile");
  }
};
```

其他 19 个 core activity → default fallback (convention `Activity_<Name>`)。

### 13.2 Rich Model: Sequence + Continuous + Cross-app

```js
// nimi/activity/greet.js
import { waveSequence } from "../lib/wave_sequence.js";

export default {
  async execute(ctx, live2d, { signal }) {
    if (ctx.history?.last_activity?.name === "greet") {
      await live2d.playMotion("Motion_Bow");
      return;
    }
    await waveSequence(live2d, { hand: "right", duration_ms: 2000 });
    if (signal.aborted) return;
    await live2d.wait(500);
    live2d.setExpression("bright_smile");
  }
};
```

```js
// nimi/event/avatar_user_click.js — 连续点击 state machine
let clickCount = 0;
let resetTimer = null;

export default {
  async execute(ctx, live2d) {
    clickCount++;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { clickCount = 0; }, 2000);

    if (clickCount === 3 && ctx.event.detail.region === "head") {
      await live2d.playMotion("SpecialMotion_Tickled");
      clickCount = 0;
    } else if (ctx.event.detail.region === "head") {
      await live2d.playMotion("Activity_Shy");
      live2d.setExpression("blush");
    }
  }
};
```

```js
// nimi/continuous/eye_tracker.js
export default {
  fps: 60,
  update(ctx, live2d) {
    const normX = (ctx.app.cursor_x / ctx.app.window.width - 0.5) * 2;
    const normY = (ctx.app.cursor_y / ctx.app.window.height - 0.5) * 2;
    const x = Math.max(-1, Math.min(1, normX));
    const y = Math.max(-1, Math.min(1, normY));
    live2d.setParameter("ParamEyeBallX", x);
    live2d.setParameter("ParamEyeBallY", -y);
    live2d.setParameter("ParamAngleX", x * 30);
    live2d.setParameter("ParamAngleY", -y * 20);
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
| **46** | Live2D API v1 scope | ✅ Option B (motion + parameter + expression + pose + wait) | 覆盖 90% 场景，physics/lipsync/drag 延后 |
| **47** | Default fallback | ✅ Option B (convention-based activity fallback) | Zero-config 可用，与 ontology §8.1 对齐 |
| **48** | Hot reload | ✅ Option B (dev + prod 都支持) | Model 调试 + 用户装新 model |
| **49** | Handler execution model | ✅ Option B (新事件抢占旧执行) | 符合 activity transient 语义 |

**NAS 1.0 baseline locked 2026-04-21**。Sandbox 机制单独议题后续讨论。

---

## 附录 A: Activity Id → File Name Normalization

```
<activity-id> → <filename>.js

Rule: replace every char not in [a-z0-9_] with '_'

Examples:
  happy                          → happy.js
  ext:grateful                   → ext_grateful.js
  mod-weather:storm-watching     → mod_weather_storm_watching.js
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

## 附录 C: Live2D API v1 Cheatsheet

```typescript
// Motion
await live2d.playMotion(group, { priority, loop, fadeIn, fadeOut });
live2d.stopMotion();

// Parameter (核心)
live2d.setParameter(id, value, weight?);
const v = live2d.getParameter(id);
live2d.addParameter(id, delta);

// Expression
await live2d.setExpression(id);
live2d.clearExpression();

// Pose (durable)
live2d.setPose(group, loop?);
live2d.clearPose();

// Utility
await live2d.wait(ms);
const bounds = live2d.getModelBounds();
```

## 附录 D: ctx 快速参考

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
