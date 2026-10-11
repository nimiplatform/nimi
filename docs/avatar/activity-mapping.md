# Activity Mapping

Avatar's built-in mapping translates admitted Runtime activity and emotion into the selected backend's presentation. Model creators configure supported backend facts and mappings; placing JavaScript in a model directory does not register a creator handler.

## Current Input Path

1. The protected App session reads the authorized Agent and Conversation.
2. The SDK driver converts admitted embodiment updates into Avatar-local inputs, including `runtime.agent.presentation.activity_requested` and `runtime.agent.state.emotion_changed`.
3. Avatar validates the target and maps it through its built-in adapter.
4. The active backend applies supported output or returns a failure. Unsupported behavior is not replaced with an idle animation and reported as success.

Runtime owns the activity identity and semantic meaning. Avatar-owned route IDs come from the generated-motion route catalog and do not add Runtime activity IDs or public APML tags.

## Model Configuration

Use a validated capability profile to declare the model's supported and unsupported routes and physical limits. When model-specific names need mapping, use a closed mapping sidecar; see [Model Capabilities](/avatar/model-capabilities) and [Generated Motion Provider](/avatar/generated-motion-provider).

Live2D parameter extensions are used only by Avatar-owned translation after backend-kind narrowing. They are not a creator script API. Current Avatar provides no NAS creator loader, sandbox, ctx injection, or filesystem hot reload.

## Local Observations

Avatar reports local outcomes such as `avatar.activity.start`, `avatar.activity.end`, and cancellation. These observations do not commit a Conversation turn or change Runtime semantics. See [Avatar Events](/avatar/avatar-events).

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/carrier/avatar-carrier.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/carrier/avatar-carrier.ts)
- [`apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts)
- [`config/avatar-generated-motion-routes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-generated-motion-routes.yaml)
