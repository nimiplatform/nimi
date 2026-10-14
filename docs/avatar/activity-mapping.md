# Activity Mapping

Avatar's built-in mapping translates admitted Runtime activity and emotion updates into presentation on the active graphics backend. Model creators declare supported backend facts and name mappings through configuration files; placing JavaScript files in a model directory does not register a creator handler.

## Current Input Path

1. The protected App session reads the authorized Agent and Conversation.
2. The SDK driver converts admitted embodiment updates into Avatar-local inputs, including `runtime.agent.presentation.activity_requested` and `runtime.agent.state.emotion_changed`.
3. Avatar validates the target and maps it through its built-in adapter.
4. The active backend executes the supported output or returns a failure. Avatar never masks unsupported behavior with an idle animation or reports it as a success.

Runtime owns activity identity and semantic meaning. Avatar-owned route IDs come from the generated-motion route catalog and do not introduce new Runtime activity IDs or public APML tags.

## Model Configuration

Use a validated capability profile to declare a model's supported routes, unsupported routes, and physical limits. When model-specific asset names need mapping, use a closed mapping sidecar; see [Model Capabilities](/avatar/model-capabilities) and [Generated Motion Provider](/avatar/generated-motion-provider).

Live2D parameter extensions are restricted to Avatar-owned translation after backend-kind narrowing—they are not a creator scripting API. Current Avatar provides no NAS creator loader, script sandbox, `ctx` injection, or filesystem hot reload.

## Local Observations

Avatar emits local events such as `avatar.activity.start`, `avatar.activity.end`, and cancellation events to report local handling outcomes. These observations do not commit a Conversation turn or alter Runtime semantics. See [Avatar Events](/avatar/avatar-events).

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/carrier/avatar-carrier.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/carrier/avatar-carrier.ts)
- [`apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts)
- [`config/avatar-generated-motion-routes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-generated-motion-routes.yaml)
