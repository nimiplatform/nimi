# Zhiyu Conversation Surface Contract

## Z-CHAT-001 Runtime Agent Turn Path

Zhiyu partner conversation and partner creation activities must use
`@nimiplatform/sdk/runtime` Runtime Agent client / turn runner surfaces and Kit
headless Runtime Agent projection helpers. Zhiyu must not implement raw turn
transport, event stream assembly, terminal recovery, snapshot replay, or
conversation projection reducers.

During the Desktop Agent Chat parity hardcut, Zhiyu may host a bounded
app-local presentation implementation under `apps/zhiyu/src/shell/agent-chat/**`
until real app acceptance stabilizes and a later upstream review decides what
belongs in SDK/Kit. This boundary is presentation-only. It may adapt Zhiyu app
identity, copy, layout, local partner selection, failure projection, and
diagnostics entries, but it must not become Runtime transport truth, stream
terminal truth, snapshot replay truth, route/provider/model truth, memory truth,
avatar truth, voice/lipsync truth, or direct AI execution truth.

## Z-CHAT-002 Scoped Binding

Runtime Agent turn consumption must carry Runtime-issued scoped binding such as
`ScopedRuntimeBindingAttachment`. `subjectUserId`, partner id, account session,
or Platform registry scopes are not binding proof.

If Zhiyu claims a first-party Electron host equivalence instead of binding-only
attachment, that equivalence must be admitted by Runtime/SDK authority with an
exact evidence chain and fail-closed semantics before any Runtime Agent turn,
snapshot read, interrupt, or agent event subscription uses it. A Zhiyu-local
spec clause alone cannot weaken Runtime binding requirements.

## Z-CHAT-003 Forbidden Direct AI Chat

In partner conversation and partner activities, Zhiyu must not use direct AI
chat helpers such as `useAppAiChatSession`, `createAppAiChatComposerAdapter`,
`streamNimiTextResponse`, `runNimiTextGenerate`, raw `sendAppMessage` to the
`runtime.agent` target, `client.writeMemory`, or `renderVoice`.

## Z-CHAT-004 Composer During Response

While the current partner is responding, the composer text area may remain
editable for draft continuity, but sending is disabled until the current turn
completes. Zhiyu v1 does not queue turns and does not allow continuous sends.

## Z-CHAT-005 Conversation Artifact Display

Runtime-owned conversation image artifacts may be displayed only as admitted
conversation artifact projection, including `runtime.agent.turn.artifact_ready`
and action projection families. Zhiyu must not request image generation, fetch
artifacts through a local seam, own retry semantics, or store artifact truth.
