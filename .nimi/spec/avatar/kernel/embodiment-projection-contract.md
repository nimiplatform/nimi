# Embodiment Projection Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: Active multi-backend embodiment projection authority. Earlier
>   Live2D-only framing is superseded.
> **Sibling contracts**:
> - [Backend branch contract](backend-branch-contract.md)
> - [VRM backend contract](vrm-backend-contract.md)
> - [Live2D render contract](live2d-render-contract.md)
> - [Nimi2D backend contract](nimi2d-backend-contract.md)
> - [App shell contract](app-shell-contract.md)
> - [Agent script contract](agent-script-contract.md)
> - [Avatar event contract](avatar-event-contract.md)

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

当前 shipped branch 是 [Live2D render contract](live2d-render-contract.md)。

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

这些都由 [Live2D render contract](live2d-render-contract.md) 约束，而不是本 contract。

---

## 7. BackendProjection Ontology Surface

> Re-anchored from earlier Live2D-coupled parameter-id model. Canonical
> structure now lives in [`backend-branch-contract.md`](backend-branch-contract.md).

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

详 [`agent-script-contract.md`](agent-script-contract.md) §"NAS handler `requires`"。

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
