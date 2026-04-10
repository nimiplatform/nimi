# Agent Chat Behavior Contract

> Authority: Desktop Kernel

## Scope

定义 Desktop agent chat 的产品行为 authority。此契约只拥有三类核心语义：

- multi-beat semantics
- turn-mode semantics
- experience-policy / settings semantics

本契约不拥有 capability route truth、runtime route truth、state persistence mechanics、stream transport mechanics，也不把 execution helper / prompt engine 升格为语义 owner。
delayed beat、pending beat invalidation、modality action envelope、以及
model-generated modality prompt semantics 固定由
`agent-chat-beat-action-contract.md`（`D-LLM-027` ~ `D-LLM-033`）拥有；本文件
只保留 generic beat ordering / turn-mode / experience-policy truth。

## D-LLM-022 — Canonical Behavior Authority Home

Desktop agent chat 的 canonical behavior owner 固定为本文件。

本 authority 只定义并固化以下 behavior outputs：

- `resolvedTurnMode`
- `resolvedExperiencePolicy`
- `resolvedBeatPlan`

adjacent authority 边界固定为：

- `agent-chat-beat-action-contract.md`（`D-LLM-027` ~ `D-LLM-033`）继续拥有
  delayed beat admission、pending beat invalidation、modality action envelope、
  model-generated modality prompt payload truth
- `conversation-capability-contract.md`（`D-LLM-015` ~ `D-LLM-021`）继续拥有 capability selection / projection / execution snapshot truth
- `ai-profile-config-contract.md` 继续拥有 `AIConfig` / `AISnapshot` authority
- `state-contract.md` 继续拥有 persistence/store ownership
- `streaming-consumption-contract.md` 继续拥有 stream lifecycle / cancel / retry semantics

execution engine helpers、submit orchestration、prompt assembly、context packing、diagnostics 与 invocation shaping 只能消费 resolved behavior outputs；不得重新拥有、重算、覆盖或静默修正 turn mode、experience policy、beat plan truth。

## D-LLM-023 — Experience Settings And Resolved Policy Boundary

Desktop agent chat 的 experience semantics 固定拆分为两层：

1. `AgentChatExperienceSettings`：用户可编辑、可持久化的 product-facing behavior preferences
2. `ResolvedExperiencePolicy`：每次 turn 启动前解析出的 execution-time policy snapshot

固定边界：

- product-facing settings 只表达用户 intent，不表达 route health、runtime readiness、provider/model truth、diagnostics transport truth
- capability/model/connector/inspector settings 不属于本 contract 的 canonical settings surface
- current desktop settings surface does not admit manual `deliveryStyle`
  (`compact` / `natural`) or `allowMultiReply` toggles
- multi-beat remains an admitted product behavior capability, but it is not a
  user-facing on/off setting
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

## D-LLM-025 — Multi-Beat Semantics

`resolvedBeatPlan` 是 assistant turn 的 canonical delivery plan。它必须是一个 ordered beat list，并在 execution 开始前固定。

每个 beat 至少包含：

- `beatId`
- `beatIndex`
- `beatCount`
- `intent`
- `deliveryPhase`
- optional delay / pacing hint

这里的 optional delay / pacing hint 只表达 ordered beat list 内的 generic
pacing metadata；某个 beat 是否被 admit 为 delayed follow-up、何时进入 pending、
何时失效、以及是否关联 modality action，不由本 contract 拥有，必须读取
`agent-chat-beat-action-contract.md` 的 resolved beat/action outputs。

固定约束：

- `beatId` 在 turn 内唯一
- `beatIndex` 从 `0` 开始连续递增
- `beatCount` 必须与实际 plan 长度一致
- 第一拍（`beatIndex=0`）是 primary visible beat；tail beats 只能在 first beat sealed 之后进入 delivery
- user-facing desktop settings must not hard-toggle whether multi-beat planning
  is allowed; beat planning belongs to behavior resolution and later
  model-planned beat/action outputs, not to a manual thread-local switch
- 一旦 beat plan 被 resolve，execution / streaming / store projection 只能记录 lifecycle，不得静默增删 beat、重排 beat、或把多 beat plan 降格成单 beat pseudo-success
- beat intent 属于 behavior truth；具体 delayed beat admission / pending invalidation、
  modality action envelope / prompt payload、artifact transport、voice playback、media
  job lifecycle 是 adjacent consumer semantics，不得在本 contract 外重新定义 beat
  ordering truth

本 landing 明确承认 multi-beat 是 desktop product behavior surface；当前或历史实现若仍停留在 first-beat-only commit，不构成 authority，后续 alignment 必须向本 contract 收敛。

## D-LLM-026 — Deferred Scope And Non-Owners

以下内容在本次 landing 中保持显式 deferred，不能被本 contract 或其 consumers 隐式吸收：

- proactive contact semantics
- video-generation product admission

具体约束：

- Desktop agent chat 在本 landing 中不得把 scheduler、heartbeat、notification、automation、orchestration helpers、prompt runtime internals、或 mod implementation evidence 升格为 proactive-contact owner
- `explicit-media`、beat planning、experience policy、或 helper diagnostics 不得借道重新引入 video-generation admission
- 若 downstream consumer 需要 proactive contact 或 video-generation 语义，必须先由新的 admitted desktop kernel authority 显式落地，而不是扩写本 contract 的现有 rules

## Fact Sources

- `spec/desktop/kernel/agent-chat-beat-action-contract.md` — D-LLM-027 ~ D-LLM-033 beat/action authority boundary
- `spec/desktop/kernel/conversation-capability-contract.md` — capability projection / execution snapshot boundary
- `spec/desktop/kernel/ai-profile-config-contract.md` — `AIConfig` / `AISnapshot` umbrella authority
- `spec/desktop/kernel/state-contract.md` — runtimeFields and persistence boundary
- `spec/desktop/kernel/streaming-consumption-contract.md` — stream lifecycle boundary
- `spec/realm/chat.md` — Realm Chat v1 excludes agent chat runtime semantics
- `apps/desktop/src/shell/renderer/features/chat/chat-agent-orchestration.ts` — current desktop beat events and single-text-beat limitation evidence
- `apps/desktop/src/shell/renderer/features/chat/chat-settings-storage.ts` — current desktop persisted behavior setting evidence
- `apps/desktop/src/shell/renderer/features/chat/chat-thinking.ts` — current desktop reasoning preference semantics
- `nimi-mods/runtime/local-chat/src/types.ts` — local-chat turn mode and beat vocabulary evidence
- `nimi-mods/runtime/local-chat/src/default-settings-store.ts` — product-settings vs inspect-settings split evidence
- `nimi-mods/runtime/local-chat/src/hooks/turn-send/resolved-experience-policy.ts` — resolved policy boundary evidence
- `nimi-mods/runtime/local-chat/src/hooks/turn-send/turn-mode-resolver.ts` — turn-mode classifier evidence
- `nimi-coding/.local/**` — local preflight evidence for desktop agent chat behavior authority / defer decisions (non-authoritative supporting material only)
- `nimi-coding/.local/**` — local execution-engine boundary audit for AI chat non-owner framing (non-authoritative supporting material only)
