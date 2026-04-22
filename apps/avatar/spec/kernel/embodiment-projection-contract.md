# Embodiment Projection Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: App-local kernel contract
> **Status**: Wave 6B embodiment-first baseline
> **Sibling contracts**:
> - [App shell contract](app-shell-contract.md)
> - [Agent script contract](agent-script-contract.md)
> - [Avatar event contract](avatar-event-contract.md)
> - [Live2D render contract](live2d-render-contract.md)

---

## 0. 阅读指南

本 contract 定义 Nimi Avatar 的 **backend-agnostic embodiment projection layer**。

canonical teaching model 固定为：

`agent semantics -> embodiment projection -> backend-specific execution`

其中：

- runtime / SDK 继续拥有 agent semantic truth
- avatar app 负责把这些语义投影成 embodiment-local cues
- Live2D / VRM / 3D / robot / game-character 等 renderer 只是不同行为后端分支

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

- Cubism SDK / VRM runtime / robot runtime 的接入细节
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

Wave 6B 不移除 Live2D branch；它只把 Live2D 收回到 backend-specific authority。

当前 Live2D branch 继续拥有：

- Cubism SDK for Web integration
- `<model>/runtime/*.model3.json` loading
- `Activity_<CamelCase>` default activity fallback mapping
- Cubism parameter / expression / pose / physics details

这些都由 [Live2D render contract](live2d-render-contract.md) 约束，而不是本 contract。

---

## 7. Deferred

本 contract 明确不在 Wave 6B 内解决：

- local trust posture / model permission model
- runtime presentation semantic redesign
- desktop bridge / handoff redesign
- 新 backend branch 的具体实现

---

## 8. Evolution

- 新 backend branch 接入：在本 contract 不变的前提下新增 backend-specific contract
- 新增 projection cue：minor bump
- 改 projection cue 语义 / owner cut：major bump
