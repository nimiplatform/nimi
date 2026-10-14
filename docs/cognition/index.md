# Cognition Architecture

Cognition is the dedicated home for an Agent's long-term Memory in Nimi. When long-term memory is enabled for an Agent, facts that pass intake and are stored by Cognition—such as your name, everyday preferences, or topics from earlier conversations—can be recalled across sessions.

Cognition operates as an autonomous owner domain alongside Runtime: Runtime drives dialogue execution, while Cognition extracts, persists, and retrieves long-term memory. The two domains communicate exclusively through a strongly-typed Runtime-Bridge protocol, keeping responsibilities and security boundaries distinct.

## Core Capabilities and User Experience

- **Cross-session continuity**: When an Agent's long-term memory is enabled, statements that pass extraction and intake rules are persisted to the Agent entity rather than a single chat window or virtual world. Not every remark in chat is guaranteed to be stored or recalled on every turn—a fact must first be accepted by the intake pipeline and committed to storage, and later recall depends on query relevance and retrieval availability.
- **Strict per-Agent isolation**: Each Agent has its own isolated memory bank. Two Agents owned by the same user cannot query each other's memories, and the platform never builds an ambient, account-wide shared profile.
- **Governed memory management**: Users and apps manage memory through SDK `agentConfigure.memory` (`inspect`, `correct`, `forget`, `setEnabled`, `deleteAll`) and Kit's `AgentCenterCognitionSection` UI, gated by `agent.configure` authorization. When you correct an entry, Cognition commits the replacement atomically and marks that specific old entry as superseded. Correcting or forgetting one entry targets that record by ID and does not automatically purge other semantically similar memories.
- **Confirmed forgetting and Forget Barriers**: Forgetting an entry requires explicit confirmation (`confirmed: true`). Once committed, a durable Forget Barrier prevents that specific memory record from returning to active recall across restarts, retries, index rebuilds, or event replays. However, a Forget Barrier only blocks that specific memory entry: it does not delete raw conversation history or alter Realm character definitions, nor can it guarantee the model is unaware of the fact if it still appears in the current session transcript, other stored entries, or new user input.
- **Credential and `do-not-remember` filtering**: During intake, Cognition applies filtering rules for common credentials (such as passwords, private keys, and API tokens) and honors explicit `do-not-remember` requests before persistence. These boundaries reduce accidental storage of sensitive text, though no automated filter guarantees zero false negatives.
- **Transparent provenance**: Every persisted memory records its source: whether it was explicitly stated by the user, inferred from context, or synthesized from earlier memories.

Memory retrieval is non-blocking: if an index is rebuilding in the background or retrieval is temporarily unavailable, the turn continues without attaching recalled memories. Retrieval hiccups never block dialogue execution or fabricate fallback memories. Write, correction, and forget operations follow strict transactional consistency and report completion only after Cognition commits durably to disk.

## Cognition Ownership Scope

- **Per-Agent long-term Memory**: An opaque, Agent-private logical bank bound to a single Agent. It is not an account profile or shared workspace store, and external Apps cannot query it directly.
- **Memory authority and lifecycle**: Governs intake filtering, provenance tracking, supersession, forget barriers, and deletion.
- **V1 core processing pipelines**: Includes a Remember intake pipeline, a full-text recall pipeline, a vector embedding recall pipeline, an exact Forget pipeline, and a static operation router.
- **Derived search indexes**: Auxiliary full-text and vector indexes built atop canonical memory banks; indexes are rebuildable projections rather than the source of truth.
- **Bounded Agent resource lanes**: Strongly-typed source units derived from Runtime snapshots and partitioned per Agent to assist context construction.

> [!NOTE]
> Long-term Knowledge is architecturally placed under Cognition, but in V1 no public read or write paths are active, and Agent memories never promote themselves to shared knowledge automatically.

## Separation of Concerns: Runtime vs. Realm

- **Runtime owns the execution lifecycle**: Manages LocalAgent identity, session authorization, conversations, context planning, AI inference, and turn commits. Runtime checks permissions before any memory request crosses the Bridge, and Cognition accepts calls only from trusted Runtime instances.
- **Realm owns world canonical state**: An Agent's private memories of events in a virtual world belong solely to that Agent and never mutate the world's canonical state machine or public history.
- **Applications and SDKs stay outside Cognition**: External apps never call Cognition directly; they interact with memory through bounded, validated Runtime APIs.

## Typical Scenario: Remembering Across Sessions

Suppose long-term memory is enabled for your Agent. On Monday you mention that you like unsweetened green tea and close the app; on Friday you open a new session and ask for an afternoon drink recommendation:

1. **Intake on Monday**: Runtime records the turn event and dispatches it across the Bridge to Cognition.
2. **Extraction and persistence**: Cognition's Remember pipeline evaluates the statement, accepts it through intake filtering, and atomically commits the entry with provenance marked as "explicitly stated."
3. **Recall on Friday**: While assembling context for the new turn, Runtime queries Cognition for relevant memories, and Cognition returns the green tea preference.
4. **Contextual injection**: Runtime includes the recalled memory in the prompt context so the Agent can factor your preference into its drink suggestions.

If the search index is rebuilding or retrieval is unavailable during step 3, Cognition returns unavailable and the turn proceeds normally without attaching relevant memories.

## Typical Scenario: Correcting and Forgetting

Suppose a stored memory entry states that you work at Company A, and you have since moved to Company B:

1. **Inspect stored memories**: Open Kit's `AgentCenterCognitionSection` management panel (or call `agentConfigure.memory.inspect` via the SDK) with `agent.configure` authorization to view the Agent's saved entries.
2. **Submit a correction**: Select the outdated entry and submit its `memoryId` with updated text via `agentConfigure.memory.correct`. Runtime verifies the manager handle and `agent.configure` permission before forwarding the request to Cognition.
3. **Atomic update**: Cognition commits the updated fact and marks that specific old entry as superseded so it leaves active recall. (If other separate memory entries also mention Company A, they are not automatically rewritten.)
4. **Confirm forget**: To block a specific entry from being recalled at all, select it and confirm the Forget operation (`agentConfigure.memory.forget` with `confirmed: true`). Once the Forget Barrier commits, that entry will not be returned by recall or revived by index rebuilds or event replays. Raw conversation transcripts and Realm character definitions remain unchanged, and the model may still know about Company A if it appears in the current chat context, other remaining entries, or new input.

Mentioning "I left Company A for Company B" in ordinary chat can still pass through the Remember pipeline and create a new long-term memory entry, but casual conversation never directly invokes administrative `correct` or `forget` operations on existing records.

Because memory banks are isolated per Agent, updating or forgetting memories on one Agent leaves your other Agents unaffected.

## Source Basis

- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)
- [`.nimi/spec/cognition/runtime-bridge.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/runtime-bridge.authority.yaml)
- [`nimi-cognition/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-cognition/README.md)
- [`sdks/typescript/core/app/local-app-runtime-platform-configure.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-configure.ts)
