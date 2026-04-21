# Mock Fixture Contract

> **App**: `@nimiplatform/nimi-avatar`
> **Authority**: App-local kernel contract (Phase 1 only)
> **Status**: Phase 1 baseline draft
> **Sibling contracts**:
> - [App shell contract](app-shell-contract.md)
> - [Live2D render contract](live2d-render-contract.md)
> - [Agent script contract](agent-script-contract.md)
> - [Avatar event contract](avatar-event-contract.md)

---

## 0. 阅读指南

Nimi Avatar Phase 1 采用 **mock-driven development**：runtime agent 正在独立 session 重构，avatar app 先行落地，通过 scripted scenario 文件模拟 runtime events 驱动 NAS handler 执行。

本 contract 定义：
- Mock scenario 文件格式
- Event injection API（`MockDriver` 类）
- Scheduling（time-based / trigger-based）
- Validation rules
- Module boundary（`src/shell/renderer/mock/` 与 `src/shell/renderer/sdk/` 隔离）
- Phase 2 swap path（mock → real SDK）

**Phase 2 时本 contract 会从主流程移除**（mock driver 变成 dev-only 工具），只保留 scenario 文件作为 integration test corpus。

---

## 1. Module Boundary (NAV-MOCK-001)

### 1.1 模块布局

```
src/shell/renderer/
├── mock/                      # Phase 1 主数据源
│   ├── MockDriver.ts          # Event injection engine
│   ├── scenario-loader.ts     # Load + validate *.mock.json
│   ├── scenarios/             # Scenario files
│   │   ├── default.mock.json
│   │   ├── basic-emotion.mock.json
│   │   └── ...
│   └── index.ts               # Export MockDriver
│
└── sdk/                       # Phase 2 real SDK adapter (stub in Phase 1)
    ├── SdkDriver.ts           # @nimiplatform/sdk wrapper
    └── index.ts               # Export SdkDriver
```

### 1.2 共享 Interface (NAV-MOCK-002)

`MockDriver` 和 `SdkDriver` 都实现同一 `AgentDataDriver` interface：

```typescript
// src/shell/renderer/driver/types.ts
interface AgentDataDriver {
  start(): Promise<void>;
  stop(): Promise<void>;
  onEvent(handler: (event: AgentEvent) => void): Unsubscribe;
  onAgentDataChange(handler: (bundle: AgentDataBundle) => void): Unsubscribe;
  emit(event: { name: string; detail: Record<string, any> }): void;  // 上行 app → runtime
}
```

App-level 代码只依赖 `AgentDataDriver`。Phase 2 swap 时只换 factory：

```typescript
// src/shell/renderer/driver/factory.ts
export function createDriver(): AgentDataDriver {
  // Phase 1:
  return new MockDriver(loadScenario());
  // Phase 2:
  // return new SdkDriver(sdkConfig);
}
```

**Boundary rule**: `src/shell/renderer/app-shell/` / `nas/` / `live2d/` **只 import `driver/types.ts` + `driver/factory.ts`**，不直接 import `mock/` 或 `sdk/`。

---

## 2. Scenario File Format

### 2.1 顶层 Schema (NAV-MOCK-003)

```typescript
interface MockScenario {
  scenario_id: string;              // ULID or slug (unique in catalog)
  version: "1";                     // Scenario schema version
  description: string;              // Human-readable
  duration_ms: number | null;       // Total scenario length; null = indefinite loop
  loop: boolean;                    // Replay after duration? default false

  agent_bootstrap: {
    active_world_id: string;
    active_user_id: string;
    locale: string;                 // e.g. "zh-CN"
    initial_posture: {
      posture_class: string;
      action_family: "observe" | "engage" | "support" | "assist" | "reflect" | "rest";
      interrupt_mode: "welcome" | "cautious" | "focused";
      transition_reason: string;
      truth_basis_ids: string[];
    };
    initial_status_text: string;
    initial_execution_state: "IDLE" | "CHAT_ACTIVE" | "LIFE_PENDING" | "LIFE_RUNNING" | "SUSPENDED";
  };

  events: MockEvent[];              // Timeline
  triggers?: MockTrigger[];         // Reactive events (§3.2)
}
```

### 2.2 MockEvent

```typescript
type MockEvent =
  | TimeBasedEvent
  | SequencedEvent;

interface TimeBasedEvent {
  kind: "time";
  at_ms: number;                    // Absolute offset from scenario start
  type: string;                     // e.g. "runtime.agent.presentation.activity_requested"
  detail: Record<string, any>;
}

interface SequencedEvent {
  kind: "after";
  after_event_id: string;           // Emit N ms after referenced event
  delay_ms: number;
  event_id?: string;                // Optional self-id for chaining
  type: string;
  detail: Record<string, any>;
}
```

### 2.3 MockTrigger (Reactive)

```typescript
interface MockTrigger {
  trigger_id: string;
  on: string;                       // Event name to subscribe, e.g. "avatar.user.click"
  filter?: {                        // Optional detail match
    [key: string]: any | { eq?: any; in?: any[] };
  };
  emit: {
    type: string;
    detail: Record<string, any>;
    delay_ms?: number;              // default 0
  };
}
```

### 2.4 Representative Example

```json
{
  "scenario_id": "basic-emotion-cycle",
  "version": "1",
  "description": "Cycles neutral → happy → greet → thinking to validate fallback motion groups",
  "duration_ms": 15000,
  "loop": true,

  "agent_bootstrap": {
    "active_world_id": "world-mock",
    "active_user_id": "user-mock",
    "locale": "zh-CN",
    "initial_posture": {
      "posture_class": "baseline_observer",
      "action_family": "observe",
      "interrupt_mode": "welcome",
      "transition_reason": "scenario_start",
      "truth_basis_ids": []
    },
    "initial_status_text": "idle",
    "initial_execution_state": "IDLE"
  },

  "events": [
    {
      "kind": "time",
      "at_ms": 0,
      "type": "runtime.agent.presentation.activity_requested",
      "detail": {
        "activity_name": "neutral",
        "category": "state",
        "intensity": null,
        "source": "mock"
      }
    },
    {
      "kind": "time",
      "at_ms": 3000,
      "type": "runtime.agent.presentation.activity_requested",
      "detail": {
        "activity_name": "happy",
        "category": "emotion",
        "intensity": "moderate",
        "source": "mock"
      }
    }
  ],

  "triggers": [
    {
      "trigger_id": "on-head-click-shy",
      "on": "avatar.user.click",
      "filter": { "region": "head" },
      "emit": {
        "type": "runtime.agent.presentation.activity_requested",
        "detail": {
          "activity_name": "shy",
          "category": "emotion",
          "intensity": "strong",
          "source": "mock"
        }
      }
    }
  ]
}
```

---

## 3. Event Injection

### 3.1 Time-Based Scheduling (NAV-MOCK-004)

```typescript
class MockDriver implements AgentDataDriver {
  private scenarioStartAt = 0;
  private timers: Set<number> = new Set();

  start() {
    this.scenarioStartAt = performance.now();
    // Schedule all TimeBasedEvent
    for (const ev of this.scenario.events.filter(e => e.kind === "time")) {
      const timer = window.setTimeout(() => this.injectEvent(ev), ev.at_ms);
      this.timers.add(timer);
    }
    // Emit initial agent data bundle from agent_bootstrap
    this.emitBundleFromBootstrap();
  }
}
```

- `at_ms` 相对 `start()` 调用时间
- `loop: true` 时 scenario 完成后 reset + reschedule

### 3.2 Trigger-Based (Reactive)

```typescript
private handleUpstreamEvent(event: AgentEvent) {
  // Events emitted by app via driver.emit() — e.g. avatar.user.click from shell
  for (const trigger of this.scenario.triggers ?? []) {
    if (trigger.on === event.name && matchesFilter(event.detail, trigger.filter)) {
      const delay = trigger.emit.delay_ms ?? 0;
      const timer = window.setTimeout(() => this.injectEvent(trigger.emit), delay);
      this.timers.add(timer);
    }
  }
}
```

- User 交互（`avatar.user.click` 等）通过 `driver.emit()` 到 MockDriver → 匹配 trigger → 注入 reactive event

### 3.3 Event Injection → NAS Runtime

MockDriver 注入的 event 走同一路径进 NAS runtime：

```
MockDriver.injectEvent(event)
  ↓ emit via onEvent handler
App event dispatcher
  ↓ lookup NAS handler
NAS Handler.execute(ctx, live2d, { signal })
```

Ctx 由 app 组装（app 调 driver.onAgentDataChange 拿 bundle 的 base + 触发 event 的 detail + app-side 数据）。

---

## 4. Validation Rules (NAV-MOCK-005)

### 4.1 Scenario Load-Time Validation

Load scenario 时 hard-validate（fail-close）：

| Check | On failure |
|---|---|
| Parse as JSON | App does not start, error UI |
| `scenario_id` matches filename slug | Error + reject |
| `version === "1"` | Reject unsupported version |
| All events have required fields per `kind` | Reject |
| `at_ms >= 0` for TimeBasedEvent | Reject |
| `after_event_id` refers to existing event_id | Reject |
| Event `type` is known APML/app event name | Warn + accept（允许 custom events，但 log） |
| `detail` schema matches known event (if registered) | Warn |
| `triggers[].on` matches known subscribable event | Warn |
| `agent_bootstrap.initial_posture.action_family` in enum | Reject |
| `duration_ms` > 0 or null | Reject |
| `loop: true` requires finite `duration_ms` | Reject |

### 4.2 Runtime Validation

- 发 event 前再次 validate event shape（防御性）
- Invalid → log error + skip（不 crash driver）

---

## 5. Scenario Catalog (NAV-MOCK-006)

- 所有 scenarios registered 在 `spec/kernel/tables/scenario-catalog.yaml`
- Catalog 提供 id / file path / description / tags / duration
- App 启动时默认 load `mock.json`（repo 根的 default scenario）
- Dev UI（未来）可切换 scenario

---

## 6. Mock vs Real Boundary (NAV-MOCK-007)

### 6.1 Phase 1 (current)

- App bootstraps `MockDriver`
- 所有 agent data / events 源自 scenario files
- 用户交互 events 通过 shell → driver.emit() → trigger reactive mocks

### 6.2 Phase 2 (post runtime refactor)

- Factory 换 `SdkDriver`
- `SdkDriver` 用 `@nimiplatform/sdk` 连 real gRPC
- App 代码**零改动**（`driver/types.ts` 不变）
- Scenario 文件转为 integration test fixtures（用 mock runtime 跑相同 scenarios 验证行为一致性）

### 6.3 Dev Mode Override

即使 Phase 2 之后，dev build 可通过环境变量切回 Mock：

```
VITE_AVATAR_DRIVER=mock    # force mock driver
VITE_AVATAR_DRIVER=sdk     # force SDK (default in Phase 2)
VITE_AVATAR_MOCK_SCENARIO=basic-emotion-cycle
```

---

## 7. Phase 1 Starting Scenarios

Five seed scenarios 定义在 `tables/scenario-catalog.yaml`，驱动 Phase 1 开发：

| Scenario id | 用途 |
|---|---|
| `basic-emotion-cycle` | 验证 fallback motion group + expression blending |
| `user-click-interaction` | 验证 trigger-based reactive events + NAS event handlers |
| `continuous-eye-tracking` | 验证 continuous handler 帧调度 + parameter API |
| `sequence-greet` | 验证 handler sequencing + abort signal |
| `posture-sync` | 验证 posture → agent data bundle → handler |

每个 scenario 有独立 `.mock.json` 文件在 `src/shell/renderer/mock/scenarios/`。

---

## 8. Boundary with Other Contracts

| Concern | This contract | Other |
|---|---|---|
| Mock scenario file schema / injection engine | ✅ | — |
| Event format semantics (apml.* / avatar.*) | 消费 | Upstream event contract / avatar-event-contract |
| Ctx bundle shape | 消费 | `agent-script-contract.md` §5 |
| Real SDK wiring | — | `@nimiplatform/sdk` (Phase 2) |
| App lifecycle hooks for driver start/stop | 消费 | `app-shell-contract.md` §7 |

---

## 9. Evolution

- Schema version bump：`version: "2"` 时新建 `v2 scenario loader`，v1 向前兼容一个 phase 后废弃
- 新增 scenario → 更新 `tables/scenario-catalog.yaml`
- 删除 scenario → 同上，且 integration test 对应 case 移除
- Phase 2 完成后，本 contract status 更新为 "dev-only tooling"

---

**Phase 1 scope only**. Phase 2 swap 完成后，mock driver 降级为 dev/test 工具；scenario files 保留作 integration test corpus 永久留存于 `src/shell/renderer/mock/scenarios/`。
