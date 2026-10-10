# LocalAgent Execution

Runtime owns LocalAgent materialization and execution. A LocalAgent is created
from a Realm-issued Character Source under an explicit owner; it is not a
second Realm identity and there is no platform-wide default LocalAgent.

## Execution boundary

Runtime owns:

- LocalAgent materialization, lifecycle, and owner isolation;
- Conversation anchors, committed turns, recovery, and interruption;
- Memory mediation;
- AI capability-intent evaluation, implementation selection, Quota, Budget,
  and provider credential custody;
- validation of execution output before it becomes Conversation, state, voice, or
  presentation truth;
- typed projections for authorized consumers.

Apps submit typed intent through the SDK. Runtime derives the account, App
identity, authorization, and LocalAgent access from the active session. A formal App uses a current session-scoped `agentHandle`, not a raw LocalAgent ID; a cached handle is not proof of continuing access.

## Consumer boundary

Apps, Desktop, Nimi Home, and Avatar may render authorized Conversation, state,
voice, and presentation projections. They do not consume raw provider or parser
output, maintain Runtime proof, reconstruct Memory or Knowledge from UI
history, or create LocalAgent success.

Avatar consumes typed embodiment input and owns only shell interaction,
renderer execution, playback, and ephemeral visual state.

## Continuity

Each LocalAgent has one Runtime-owned Conversation and explicit anchor. Later
authorized opens, including from another App, continue the same committed
history. Different LocalAgents materialized from the same Character Source
keep independent operational state; callers cannot partition one LocalAgent's
Conversation by App or window.

See [Conversation Anchor](/platform/agents/conversation-anchor) and
[LocalAgent Access](/platform/agents/participation-authority).

Cognition owns Agent-private long-term Memory; Runtime mediates authorized delivery, recall, and management. Knowledge V1 has no active read, write, or public client path.

## Source Basis

- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
