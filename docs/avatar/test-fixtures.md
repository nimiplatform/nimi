# Avatar Development Fixtures

Fixtures provide repeatable local regression input without a live Runtime session. Explicitly selecting `VITE_AVATAR_DRIVER=mock` makes the current driver factory use MockDriver. The default is SdkDriver and requires real SDK bootstrap input.

Fixtures cover parsing, scheduling, and local mapping. Rendering a development model additionally requires a valid model manifest in the fixture configuration; event JSON alone does not guarantee visible output. The preview remains fixture_not_verified and cannot close product acceptance.

## Current Driver Interface

Avatar maintainers use AgentDataDriver's actual methods: start, stop, getBundle, onEvent, onBundleChange, onStatusChange, and emit. emitCancelable is optional. kind and status are read-only.

`onBundleChange` reports bundle updates; there is no onAgentDataChange. A mock factory input requires scenarioJson and may include scenarioSource. An SDK input requires SdkDriverOptions rather than a no-argument constructor.

## Scenario Format

| Field | Requirement |
| --- | --- |
| `scenario_id` | Non-empty string; must match a known fixture filename when loaded from it |
| `version` | String "1" |
| `description` | String |
| `duration_ms` | Optional or null; a supplied value must be positive, and loop=true requires a finite value |
| `loop` | Required boolean |
| `agent_bootstrap` | Initial fixture world, user, locale, posture, status text, and execution state |
| `events` | Required array; use [] for a static scenario |
| `triggers` | Optional interactive triggers |

The format has no bundle/meta structure. Time events use kind=time, at_ms, type, and detail. Sequenced events use kind=after, after_event_id, delay_ms, type, and detail; the referenced event_id must exist.

Fixture activity uses `avatar.fixture.presentation.activity_requested` with source=mock. Synthetic input is not a Runtime-authorized event.

## Static Input Example

Save with the filename static-preview.mock.json:

```json
{
  "scenario_id": "static-preview",
  "version": "1",
  "description": "Static development preview",
  "duration_ms": null,
  "loop": false,
  "agent_bootstrap": {
    "active_world_id": "fixture-world",
    "active_user_id": "fixture-user",
    "locale": "en-US",
    "initial_posture": {
      "posture_class": "baseline_observer",
      "action_family": "observe",
      "interrupt_mode": "welcome",
      "transition_reason": "scenario_start",
      "truth_basis_ids": []
    },
    "initial_status_text": "Development preview",
    "initial_execution_state": "IDLE"
  },
  "events": []
}
```

These identity fields belong only to the fixture. They do not create a real account, App session, or Conversation continuity. Validate the format through the current loadScenarioFromJson/parseScenario implementation; default.mock.json provides another real reference. Model presentation and the live product path still require their own checks.

## Related Documentation

- [Local Diagnostics and Readiness](/avatar/instance-lifecycle)
- [Visual Acceptance](/avatar/visual-acceptance)

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/driver/types.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/driver/types.ts)
- [`apps/avatar/src/shell/renderer/driver/factory.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/driver/factory.ts)
- [`apps/avatar/src/shell/renderer/mock/scenario-types.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/mock/scenario-types.ts)
- [`apps/avatar/src/shell/renderer/mock/scenario-loader.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/mock/scenario-loader.ts)
- [`apps/avatar/src/shell/renderer/mock/scenarios/default.mock.json`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/mock/scenarios/default.mock.json)
- [`apps/avatar/src/shell/renderer/app-shell/app-bootstrap.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/app-bootstrap.ts)
