# Cognition Architecture

Cognition is the dedicated home for an Agent's long-term Memory in Nimi. When an Agent recalls your name, your preferences, or a conversation from last month across different sessions, that capability is powered by Cognition.

Cognition functions as an autonomous owner domain within the platform: Runtime drives dialogue execution, while Cognition extracts and persists meaningful information. The two domains interact through a strongly-typed Runtime-Bridge protocol, maintaining clean decoupling, strong isolation, and unambiguous responsibilities.

## Core Capabilities and User Experience

- **Cross-session continuity**: Agents retain long-term memory across sessions. Close the application, return days later, and the same Agent still remembers previously established facts. Memories attach directly to the Agent entity rather than a transient chat window or single world.
- **Strict per-Agent isolation**: Memory is partitioned per Agent. Two Agents owned by the same user maintain distinct, isolated memory banks and cannot cross-query each other's memories; the platform never maintains an ambient, account-wide shared profile.
- **Governed memory correction**: Users can inspect and correct stored memories via authorized management surfaces. When a user selects an entry and submits updated text, the change commits atomically before the updated fact becomes active.
- **Explicit confirmation for forgetting**: Users can explicitly confirm forgetting specific memories. Once committed by Cognition, a durable Forget Barrier ensures the entry is removed from active recall, and subsequent restarts, retries, index rebuilds, or event replays will not restore it. Raw conversation transcripts and Realm Character personas remain unaltered. A casual remark in standard chat does not trigger this management operation.
- **Privacy and credential filtering**: Sensitive credentials are automatically filtered. Passwords, private keys, API tokens, and statements explicitly expressing "do not remember" are rejected before reaching storage.
- **Transparent provenance**: Every persisted memory tracks its origin: whether it was explicitly stated by the user, inferred from context, or synthesized from earlier memories.

Memory retrieval is resilient: if background indexing is underway or retrieval is temporarily unavailable, the conversation proceeds smoothly without memory context. Retrieval hiccups never synthesize hallucinations and never block turn execution. Conversely, write and forget operations adhere to strict transactional consistency, reporting completion only after Cognition durably commits to disk.

## Cognition Ownership Scope

- **Per-Agent long-term Memory**: An opaque, Agent-private logical bank bound exclusively to a single Agent. It is not an account profile, not a shared workspace store, and cannot be directly queried by external Apps.
- **Memory authority and lifecycle**: Governs intake filtering, provenance tracking, supersession, forget barriers, and permanent deletion.
- **V1 core processing pipelines**: Includes a Remember pipeline, a full-text recall pipeline, a vector embedding recall pipeline, an exact Forget pipeline, and a static operation router.
- **Derived search indexes**: Auxiliary full-text and vector indexes built atop canonical memory banks; indexes are rebuildable projections that do not own truth.
- **Bounded Agent resource lanes**: Strongly-typed source units derived from Runtime snapshots, partitioned per Agent to assist context construction.

> [!NOTE]
> Long-term Knowledge is architecturally designated under Cognition, but in the V1 milestone no public read/write paths are active, and memories never promote themselves to shared knowledge without explicit workflows.

## Separation of Concerns: Runtime vs. Realm

- **Runtime owns the execution lifecycle**: Manages LocalAgent identity, session authorization, conversations, context planning, AI inference, and final turn commits. Runtime evaluates permissions before any memory request traverses the Bridge; Cognition accepts calls exclusively from trusted Runtime instances.
- **Realm owns world canonical state**: An Agent's private memory of events within a virtual world does not alter that world's canonical state machine or public history.
- **Applications and SDKs stay outside Cognition**: External apps cannot address Cognition directly; they interact with memory through bounded, validated responses mediated by Runtime.

## Typical Scenario: Remembering Across Sessions

On Monday, you mention a peanut allergy to your Agent and close the application. On Friday, you ask for snack recommendations:

1. **Intake on Monday**: Runtime logs the message as an event and dispatches it across the Bridge to Cognition.
2. **Extraction and persistence**: Cognition's Remember pipeline assesses the fact as durable, and Cognition Core atomically commits it with provenance marked as "explicitly stated."
3. **Recall on Friday**: When planning the turn context, Runtime requests relevant memories from Cognition, which returns the peanut allergy entry.
4. **Contextual injection**: Runtime incorporates the preference into the prompt context, allowing the model to naturally avoid peanut snacks.

If the search index had been rebuilding during step 3, Cognition would return "unavailable," and the turn would proceed normally without that memory entry.

## Typical Scenario: Correcting and Forgetting

A stored memory indicates you work at Company A, but you have transitioned to Company B:

1. **Access management surface**: Open the authorized Memory management panel for that Agent and view saved entries.
2. **Submit correction**: Select the outdated entry, submitting its `memoryId` alongside the updated text. Runtime validates the manager handle and `agent.configure` permissions before forwarding to Cognition.
3. **Atomic update**: Once committed by Cognition, the updated fact becomes current and the superseded entry leaves the active recall view.
4. **Confirm forget**: To remove the former workplace from memory recall, select the entry and confirm the Forget operation (`confirmed: true`). Once the forget barrier commits, the memory will no longer be recalled, and subsequent index rebuilds or event replays will not revive it. (Raw conversation history and baseline character personas remain untouched.)

Mentioning "I left Company A" in casual conversation does not trigger this administrative deletion; permanent modifications must be confirmed through authorized management interfaces.

Because memory banks are strictly partitioned per Agent, adjusting one Agent's memory leaves your conversations with other Agents completely unaffected.

## Source Basis

- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)
- [`.nimi/spec/cognition/runtime-bridge.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/runtime-bridge.authority.yaml)
- [`nimi-cognition/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-cognition/README.md)
- [`sdks/typescript/core/app/local-app-runtime-platform-configure.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-configure.ts)
