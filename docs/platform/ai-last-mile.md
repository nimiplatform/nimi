# AI Execution Last Mile

The AI last mile represents the end-to-end execution path: from an authorized user intent, through Runtime LocalAgent processing, returning a structured read-only projection to the consuming application.

Architectural ownership across this boundary is cleanly separated:
- **Runtime** owns LocalAgent conversation lifecycles, memory routing, local and cloud AI scheduling, driver selection, safety validation, token budgeting, and application authorization.
- **SDK** exposes the bounded, type-safe public interface.
- **Apps** own their UI interactions and presentation, without managing underlying execution state or private credentials.

## Core Execution Pipeline

1. **Intent Submission**: A user or application submits a typed intent via the SDK.
2. **Session Verification**: Runtime derives the user account, application identity, authorization scopes, and target LocalAgent permissions from the active secure session.
3. **Capability Evaluation & Config Binding**: Runtime validates the requested capability against quotas and budgets, binding the machine-selected Local Loadout or cloud provider parameters upon job creation.
4. **Validation & State Commit**: Runtime validates model outputs against structural and safety constraints before committing conversation history or agent state.
5. **Projection Return**: The caller receives only the authorized, structured view to update its UI.

Provider API keys, raw parser logs, internal Runtime tokens, and private agent contexts never leak into application-owned state.

## Optional External Actions

External delegated actions can be integrated as an optional capability plane. However, they are not a prerequisite for the core conversation pipeline. The absence or failure of external tools never blocks core LocalAgent dialogue, memory recall, voice interaction, or standard AI generation.

For details on this security boundary, see [Delegated Capability](/runtime/delegated-capability).

> [!NOTE]
> Long-term memory is managed by Cognition and isolated per agent; Runtime mediates authorized recall and updates. Knowledge V1 currently has no active public client interface.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
