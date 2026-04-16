# Agent Chat Behavior Contract

> Authority: Desktop Kernel

## Scope

定义 Desktop agent chat 的产品行为 authority。此契约只拥有三类核心语义：

- single-message semantics
- turn-mode semantics
- experience-policy / settings semantics

本契约不拥有 capability route truth、runtime route truth、state persistence mechanics、stream transport mechanics，也不把 execution helper / prompt engine 升格为语义 owner。
message-action envelope、follow-up-turn action、以及 model-generated modality prompt
semantics 固定由 `agent-chat-message-action-contract.md`
（`D-LLM-027` ~ `D-LLM-033`）拥有；本文件只保留 single-message / turn-mode /
experience-policy truth。avatar transient surface semantics 固定由
`agent-avatar-surface-contract.md`（`D-LLM-053` ~ `D-LLM-058`）拥有。

## D-LLM-022 — Canonical Behavior Authority Home

Desktop agent chat 的 canonical behavior owner 固定为本文件。

本 authority 只定义并固化以下 behavior outputs：

- `resolvedTurnMode`
- `resolvedExperiencePolicy`
- `resolvedMessagePolicy`

adjacent authority 边界固定为：

- `agent-chat-message-action-contract.md`（`D-LLM-027` ~ `D-LLM-033`）继续拥有
  message-action envelope、follow-up-turn action、以及 model-generated modality prompt
  payload truth
- `conversation-capability-contract.md`（`D-LLM-015` ~ `D-LLM-021`）继续拥有 capability selection / projection / execution snapshot truth
- `agent-avatar-surface-contract.md`（`D-LLM-053` ~ `D-LLM-058`）继续拥有 avatar transient surface / interaction-state truth
- `ai-profile-config-contract.md` 继续拥有 `AIConfig` / `AISnapshot` authority
- `state-contract.md` 继续拥有 persistence/store ownership
- `streaming-consumption-contract.md` 继续拥有 stream lifecycle / cancel / retry semantics

execution engine helpers、submit orchestration、prompt assembly、context packing、diagnostics 与 invocation shaping 只能消费 resolved behavior outputs；不得重新拥有、重算、覆盖或静默修正 turn mode、experience policy、single-message truth。

## D-LLM-023 — Experience Settings And Resolved Policy Boundary

Desktop agent chat 的 experience semantics 固定拆分为两层：

1. `AgentChatExperienceSettings`：用户可编辑、可持久化的 product-facing behavior preferences
2. `ResolvedExperiencePolicy`：每次 turn 启动前解析出的 execution-time policy snapshot

固定边界：

- product-facing settings 只表达用户 intent，不表达 route health、runtime readiness、provider/model truth、diagnostics transport truth
- capability/model/connector/inspector settings 不属于本 contract 的 canonical settings surface
- current desktop settings surface does not admit manual `deliveryStyle`
  (`compact` / `natural`) or `allowMultiReply` toggles
- single-message semantics is fixed product behavior, not a user-facing toggle
- compact / natural style bias must not be represented as a thread-local manual
  switch; if such texture exists, it belongs to agent characteristic / profile /
  planner inputs rather than a canonical user setting
- `ResolvedExperiencePolicy` 是 derived snapshot，不是持久化 product setting
- internal strategy outputs 例如 `relationshipBoundaryPreset`、`contentBoundary`
  只能存在于 resolved policy，不得伪装成用户设置
- submit / engine / planner 必须消费同一份 resolved policy snapshot，不得各自从 local UI state、prompt helper state、thread metadata 或 runtime fields 再派生一份平行 policy truth

`ResolvedExperiencePolicy` 必须至少能表达：

- content boundary policy
- modality bias / autonomy policy
- inspect-only flags 与 product policy 的边界

若任一 required policy field 无法被合法解析，execution path 必须 fail-close；不得用 guessed defaults 合成 pseudo-success policy。

## D-LLM-024 — Turn-Mode Semantics

`resolvedTurnMode` 是每个 user-authored turn 在 behavior resolution 后得到的单值分类。其 stable surface 固定为封闭枚举：

- `information`
- `emotional`
- `playful`
- `intimate`
- `checkin`
- `explicit-media`
- `explicit-voice`

约束：

- 每个 submitted turn 恰有一个 resolved turn mode；不得并列落入多个 mode
- turn mode resolution 必须发生在 beat planning 之前；后续 helper 只能消费结果，不得重判
- `checkin` 只表达对当前 turn 的对话姿态；它本身不得被解释为 host-owned proactive-contact authorization
- `explicit-media` 是用户 turn 对 media-oriented behavior 的分类，不自动授予任何 deferred media product admission
- turn mode 是 behavior truth，不是 transport flag、stream flag、provider flag、或 runtime mode selector

## D-LLM-025 — Single-Message Semantics

Desktop agent chat 的 canonical text behavior 固定为：每个 assistant turn 恰有一个 resolved
assistant message。

固定约束：

- text reply 不得在同一 assistant turn 内拆成第二条 message、tail beat、delayed beat、或任何
  等价多段文本 delivery
- user-facing desktop settings must not hard-toggle whether single-message planning
  is allowed；single-message planning 属于 behavior resolution 与 message-action contract，
  不是 manual thread-local switch
- 一旦 assistant message 被 resolve，execution / streaming / store projection 只能记录
  lifecycle，不得静默增删 message、重排 text delivery、或把 action-driven follow-up
  降格成同一 turn 的第二条文本 pseudo-success
- text reply intent 属于 behavior truth；具体 message-action envelope、follow-up-turn
  action、artifact transport、voice playback、media job lifecycle 是 adjacent consumer
  semantics，不得在本 contract 外重新定义 text reply ownership

本 landing 明确承认 single-message 是 desktop product behavior surface；当前或历史实现若仍停留在
multi-beat / tail text path，不构成 authority，后续 alignment 必须向本 contract 收敛。

## D-LLM-026 — Deferred Scope And Non-Owners

以下内容在本次 landing 中保持显式 deferred，不能被本 contract 或其 consumers 隐式吸收：

- proactive contact semantics
- video-generation product admission

具体约束：

- Desktop agent chat 在本 landing 中不得把 scheduler、heartbeat、notification、automation、orchestration helpers、prompt runtime internals、或 mod implementation evidence 升格为 proactive-contact owner
- `explicit-media`、beat planning、experience policy、或 helper diagnostics 不得借道重新引入 video-generation admission
 - `explicit-media`、single-message planning、experience policy、或 helper diagnostics
   不得借道重新引入 video-generation admission
- 若 downstream consumer 需要 proactive contact 或 video-generation 语义，必须先由新的 admitted desktop kernel authority 显式落地，而不是扩写本 contract 的现有 rules

## D-LLM-026a — Runtime Agent Core Consumer Boundary

Desktop agent chat may consume `runtime.agentCore` state and memory projections, but it does not own canonical agent identity, canonical agent memory, life scheduling, or autonomy truth.

固定约束：

- renderer / desktop store 不得再拥有第二套 canonical agent memory truth
- desktop 对 agent 状态的改变必须通过 admitted runtime command surface 提交
- thread-local `follow-up-turn` continuity 不得被扩写为 runtime-owned life scheduling truth
- desktop notification / UI orchestration / chat continuity 只能消费 Runtime Agent Core outputs，不得回写为独立 agent owner
- `data-api.core.agent.memory.*` 若继续保留，只能作为 runtime-backed compatibility projection；
  不得再经由 Realm helper、desktop-local index、或 app-owned cache 形成平行 memory truth
- legacy `profiles` / `stats` / offset-style pagination 等若无 admitted runtime 等价面，
  必须 fail-close；不得拼凑近似值、伪分页、或 provider-derived pseudo-success

## D-LLM-026b — Group Execution Boundary

Desktop agent execution in GROUP context must use a group-safe execution path that enforces the following isolation boundaries.

Memory isolation:

- Group execution must NOT write DYADIC memory (user-turn or assistant-turn).
- Group execution must NOT read DYADIC memory or inject continuity digest.
- Group execution must NOT dispatch sidecar inputs.
- Rationale: DYADIC memory is isolated by `(agentId, userId)` per R-MEM-003. Group context is multi-party; injecting DYADIC memory risks cross-user leakage in group-visible responses. Memory admission in group context is deferred and requires explicit future admission with addressed-user attribution, anti-leak guards, and provenance.

Private resource isolation:

- Group execution must NOT auto-inject outputs from owner-private MCP connectors, owner-private knowledge bases, or owner-local file system access.
- Any such extension requires separate admission with explicit per-group or per-invocation user consent.

AI scope isolation:

- Group dispatcher and group execution must NOT create thread-scoped, group-scoped, or per-message `AIScopeRef` instances. Group execution consumes the existing desktop feature/app scope per P-AISC-002.

Truth boundary:

- Group participant presence, dispatcher diagnostics, group context preamble, and agent availability status are runtime/projection evidence. They must NOT write back to Agent truth (`AgentRule`) per R-TRUTH-003.

Failure semantics:

- All group execution failures default to agent silence. No retry storm, no auto-substitution, no deferred reply queue.
- Dispatcher process crash, evaluation timeout, LLM routing failure, agent execution failure, and post-to-Realm failure all result in the affected agent staying silent.

Relationship to D-LLM-025:

- D-LLM-025 single-message semantics is preserved in group context. Each agent response in a group turn is exactly one message.
- A single incoming group message may trigger zero, one, or multiple agent responses (fan-out across different agents), but each individual agent response remains a single message.

## Fact Sources

- `.nimi/spec/desktop/kernel/agent-chat-message-action-contract.md` — D-LLM-027 ~ D-LLM-033 message/action authority boundary
- `.nimi/spec/desktop/kernel/conversation-capability-contract.md` — capability projection / execution snapshot boundary
- `.nimi/spec/desktop/kernel/ai-profile-config-contract.md` — `AIConfig` / `AISnapshot` umbrella authority
- `.nimi/spec/desktop/kernel/state-contract.md` — runtimeFields and persistence boundary
- `.nimi/spec/desktop/kernel/streaming-consumption-contract.md` — stream lifecycle boundary
- `.nimi/spec/realm/chat.md` — Realm Chat v1 excludes agent chat runtime semantics
- `apps/desktop/src/shell/renderer/features/chat/chat-agent-orchestration.ts` — current desktop message/action execution evidence
- `apps/desktop/src/shell/renderer/features/chat/chat-settings-storage.ts` — current desktop persisted behavior setting evidence
- `apps/desktop/src/shell/renderer/features/chat/chat-thinking.ts` — current desktop reasoning preference semantics
- `nimi-mods/runtime/local-chat/src/types.ts` — local-chat turn mode and beat vocabulary evidence
- `nimi-mods/runtime/local-chat/src/default-settings-store.ts` — product-settings vs inspect-settings split evidence
- `nimi-mods/runtime/local-chat/src/hooks/turn-send/resolved-experience-policy.ts` — resolved policy boundary evidence
- `nimi-mods/runtime/local-chat/src/hooks/turn-send/turn-mode-resolver.ts` — turn-mode classifier evidence
- `.local/**` — local preflight evidence for desktop agent chat behavior authority / defer decisions (non-authoritative supporting material only)
- `.local/**` — local execution-engine boundary audit for AI chat non-owner framing (non-authoritative supporting material only)
- `.nimi/spec/realm/kernel/chat-contract.md` — R-CHAT-002a GROUP thread type, R-CHAT-006 GROUP admin, R-CHAT-007 GROUP post-auth
- `.nimi/spec/realm/kernel/agent-memory-contract.md` — R-MEM-003 DYADIC isolation (referenced by D-LLM-026b)
- `.nimi/spec/platform/kernel/ai-scope-contract.md` — P-AISC-002 scope lifecycle (referenced by D-LLM-026b)
- `.nimi/spec/realm/kernel/truth-contract.md` — R-TRUTH-003 Agent truth boundary (referenced by D-LLM-026b)
