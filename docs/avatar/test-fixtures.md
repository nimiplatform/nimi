# Test Fixtures

> Status: Running today. The mock fixture contract is shipped; mock
> scenarios run today in dev and CI for fixture regression evidence.

Test fixtures in Avatar exist for one reason: **deterministic
regression evidence without silent fallback into the production
runtime path**. Mock scenarios are explicit dev / test fixtures;
they are not the canonical carrier path and they cannot close
carrier visual proof.

## Fixture vs. Real Runtime Path

| Aspect | Real runtime path | Mock fixture path |
| --- | --- | --- |
| Driver | `SdkDriver` consuming `@nimiplatform/sdk` | `MockDriver` injecting scenario events |
| Activation | Default | Explicit `VITE_AVATAR_DRIVER=mock` |
| Use | Product behavior | Bounded local testing, fixture-driven UI / NAS regression |
| Evidence value | Closes carrier visual proof | Regression evidence only |

The factory enforces the boundary:

```ts
export function createDriver(): AgentDataDriver {
  if (import.meta.env.VITE_AVATAR_DRIVER === "mock") {
    return new MockDriver(loadScenario());
  }
  return new SdkDriver(sdkConfig);
}
```

App-level code only depends on `AgentDataDriver`. The default factory
returns `SdkDriver`. Mock activates only when explicitly requested.

## Module Boundary

```
src/shell/renderer/
├── mock/                      # Dev/test fixture data source
│   ├── MockDriver.ts          # Event injection engine
│   ├── scenario-loader.ts     # Load + validate *.mock.json
│   ├── scenarios/             # Scenario files
│   │   ├── default.mock.json
│   │   ├── basic-emotion.mock.json
│   │   └── …
│   └── index.ts
│
└── sdk/                       # Real runtime/SDK adapter
    ├── SdkDriver.ts           # @nimiplatform/sdk consume wrapper
    └── index.ts
```

Both `MockDriver` and `SdkDriver` implement the same
`AgentDataDriver` interface. The mock module never leaks into the
SDK module path.

## `AgentDataDriver` Interface

```ts
interface AgentDataDriver {
  start(): Promise<void>;
  stop(): Promise<void>;
  onEvent(handler: (event: AgentEvent) => void): Unsubscribe;
  onAgentDataChange(handler: (bundle: AgentDataBundle) => void): Unsubscribe;
  emit(event: { name: string; detail: Record<string, any> }): void;
}
```

Both drivers honor the same shape so the rest of the app does not
know which is mounted.

## Scenario File Format

Mock scenario JSON describes a sequence of events to inject and the
admitted bundle context the app sees. The scenario shape is
admitted by the mock fixture contract; the loader validates against
the schema before injection.

| Field | Purpose |
| --- | --- |
| `bundle` | Initial `AgentDataBundle` snapshot |
| `events` | Ordered event injection list (`name`, `detail`, timing) |
| `triggers` | Trigger-based injection points (e.g., on `avatar.user.click`) |
| `meta` | Scenario id, description, intended use |

Time-based scheduling and trigger-based scheduling are both supported.
A scenario with neither is a static bundle snapshot.

## Validation Rules

| Rule | Why |
| --- | --- |
| Schema validation on load | A malformed scenario fails closed; it does not silently no-op |
| Required fields enforced | Scenarios cannot omit the bundle snapshot |
| Event name allowlist | Mock cannot inject events outside the admitted event surface |
| No silent fallback to live data | If the mock fails, the app does not silently switch to `SdkDriver` |

The boundary is hard because a fixture path that quietly behaves
like the real path produces fake passing evidence.

## Reader Scenario: Run a Mock Scenario in Dev

1. **Author scenario.** `scenarios/onboarding.mock.json` declares the
   bundle snapshot and a sequence of activity / emotion events.
2. **Activate.** `VITE_AVATAR_DRIVER=mock pnpm dev` in the Avatar
   app workspace.
3. **Driver factory returns `MockDriver`.** Loads the scenario;
   validates schema; starts injection.
4. **App runs.** Embodiment renders the scenario; NAS handlers fire
   on the injected events.
5. **Stop.** Stopping the dev server stops the driver. No state
   leaks.

The author saw their NAS handler exercise without needing the full
runtime / SDK stack live.

## Reader Scenario: A Scenario Cannot Close Carrier Proof

1. **Contributor proposes:** "the mock scenario produces visible
   pixels — that's our visual acceptance evidence."
2. **Reject.** Per
   [Visual Acceptance](/avatar/visual-acceptance.md), fixture / mock
   path is regression evidence only.
3. **Reason code.** "Mock fixture path does not exercise the real
   runtime / SDK / carrier draw chain."
4. **Re-route.** Contributor authors a deterministic Avatar carrier
   harness exercising the real path.

The mock is bounded so the audit boundary stays honest.

## What Test Fixtures Do Not Do

- They do not become the default driver. Default is always `SdkDriver`.
- They do not silently fall back from `SdkDriver` to mock on error.
- They do not close carrier visual acceptance.
- They do not invent semantic event types outside the admitted
  event surface.
- They do not reach into Cubism / three-vrm directly. Backend access
  goes through projection, even in mock mode.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Mock activation rule | Mock fixture contract (`VITE_AVATAR_DRIVER=mock`) |
| Driver interface | `src/shell/renderer/driver/types.ts` (admitted) |
| Real runtime adapter | `src/shell/renderer/sdk/SdkDriver.ts` |
| Fixture event injection | `src/shell/renderer/mock/MockDriver.ts` |
| Scenario file schema | Mock fixture contract |

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
