# Cross-Domain Product Stories

The architecture pages give you the topology. This page gives you the
walk-throughs. Each story below traces a real product flow across
multiple authority domains, showing how the layers actually interact.

For schema-level definitions, see
[Reference → World Fields](/reference/world-fields),
[Reference → Agent Fields](/reference/agent-fields), and
[Reference → State Machines](/reference/state-machines).

## Story 1: A Streamed Generation Request

You are an app that wants the platform to generate a streamed
multimodal response inside a world's context.

1. **App → SDK.** Your app calls into `@nimiplatform/sdk/runtime`. You pass a
   typed request describing the modality, the context, and the
   destination. You do not import private runtime modules.
2. **SDK → Runtime.** The SDK transports the call to Runtime via
   the active transport profile (`tauri-ipc` on Desktop, `node-grpc`
   on Node, etc.).
3. **Runtime workflow lifecycle.** The request becomes a workflow.
   The workflow moves through `ACCEPTED → QUEUED → RUNNING`. If a
   downstream provider is involved, the provider async task moves
   through `queued → running → succeeded | failed | expired`,
   normalized into the workflow state machine.
4. **Streaming semantics.** Streamed chunks arrive at the SDK under
   one of the four streaming modes (A/B/C/D). Stage boundaries,
   terminal frames, and error semantics are typed contracts; chunks
   that violate them fail closed.
5. **Multimodal artifact delivery.** If the response includes an
   image / audio / video / voice / music artifact, the artifact
   travels under the multimodal artifact contract — typed canonical
   fields, MIME type from the contract, not guessed at the app
   layer.
6. **Audit lineage.** The runtime local audit ledger records the
   workflow, including provider routing, scenario job lifecycle,
   delegation lineage if any, and terminal outcome.

If anything in step 4 or step 5 fails the contract — wrong MIME,
missing required field, unknown chunk shape — the runtime emits a
typed terminal failure frame and the workflow moves to `FAILED`. The
app does not silently see "best-effort" success.

## Story 2: A Cross-World Move

An agent named Mira lives in World A, where she runs a small
flower shop. A user invites her to visit World B, a music concert.

1. **Identity stays.** Mira's identity is canonical Realm truth —
   one identity used by every world she visits. World B does not
   create a new Mira; it admits the existing one.
2. **Transit through OASIS.** Creator worlds cannot peer-transit
   directly. World A → OASIS → World B. The transit is a
   single-hop continuity protocol that preserves identity without
   mutating world truth.
3. **Social state crosses selectively.** The platform's Social
   primitive describes how relationships are represented in
   cross-world meaning. Mira's friendships in World A do not
   automatically replicate; whatever crosses uses the Social
   contract.
4. **Economy is canonical.** Mira's wallet and economic standing
   are platform truth. Currency she earned in World A may have
   different local meaning in World B's internal economy, but the
   canonical balance and event history are not invented per world.
5. **Memory travels.** Mira's `AGENT_CORE` memory bank is hers,
   replicated to Realm. She remembers things from World A while in
   World B. Cognition and Runtime cooperate on this; the bridge
   contract governs what Cognition surfaces to Runtime.
6. **Presentation adapts.** Avatar's embodiment projection may
   express Mira differently for World B's carrier surface. Avatar
   does not redefine Mira — Mira's identity stays; only the
   presentation projection changes.

This single example touches Platform (Transit, Social, Economy),
Realm (truth, transit, social, economy), Runtime (memory bank
replication), Cognition (memory authority), and Avatar
(presentation). None of those layers is allowed to silently
redefine another's truth; the architecture exists exactly to make
this story possible without authority drift.

## Story 3: A Future Delegated AI Takes Action

After the Runtime-owned External Agent action plane is admitted, you
admit an external AI host (a separate AI provider) as an
`ExternalPrincipal`. You want it to send a gift to a friend on your
behalf.

1. **Runtime admits the external principal.** Runtime owns the gateway,
   token ledger, and action registry. Desktop only projects the user
   controls.
2. **Delegated session opens.** Runtime opens a delegated session
   for the external principal. The session has a trust tier
   (`CONTROLLED_LOCAL` / `USER_ADDED_REVIEWED` / `ORG_MANAGED` /
   `BLOCKED`) and a policy snapshot.
3. **External AI proposes.** The external AI sends a typed
   delegation request — for example, `SUGGEST_INTENT` with the
   action it wants to take (send gift to friend).
4. **Output firewall classifies.** The firewall validates schema,
   provenance, descriptor hash, and sensitivity. It detects prompt
   poisoning. It derives an approval requirement and emits one of:
   `ACCEPTED_OBSERVATION`, `ACCEPTED_SUGGESTION`, `APPROVAL_REQUIRED`,
   `QUARANTINED`, `REJECTED`, `PROVIDER_DRIFTED`, `SCHEMA_INVALID`,
   `POLICY_BLOCKED`.
5. **Approval if required.** If `APPROVAL_REQUIRED`, you approve in
   the Desktop UI. The approval is recorded as evidence.
6. **Runtime acts.** Runtime takes the action under its own audit
   lineage — not the external AI's. The gift commits through Realm.
   The external AI did not directly mutate Realm; Runtime did, on
   behalf of the user.
7. **Audit lineage.** Delegation audit links the suggestion to the
   firewall verdict to the approval to the realm commit. Every step
   is reconstructible.

The architectural commitment: a suggested tool call **never**
directly executes. Runtime always re-authorizes and emits a
runtime-owned action with independent audit lineage.

## Story 4: An Agent Recalls A User Across Sessions

A user talks to an agent on Monday. On Wednesday, the user comes
back. The agent should remember.

1. **Memory write.** During the Monday conversation, the agent
   writes a memory ("user mentioned a March 12 birthday") into
   their `AGENT_CORE` bank under Cognition's memory service.
2. **Replication.** Runtime replicates the memory to Realm with
   replication state moving `pending → synced`.
3. **New session starts.** On Wednesday, the user opens chat.
   Runtime resolves the user's identity through Realm; the agent's
   identity is durable.
4. **Cognition bridge.** Runtime calls Cognition through the bridge
   contract to resolve relevant memory for the new conversation.
   Cognition returns memory under the bridge contract; Runtime
   consumes it without redefining what memory is.
5. **Conversation anchor.** The conversation has its own
   `ConversationAnchor` — per-agent + per-conversation. If the user
   continues this same conversation later in Avatar or in Web,
   the anchor lets the surfaces share the conversation without
   collapsing into a global session.
6. **APML output.** The agent's life-track and chat-track turn
   output emerges as APML wire format and is parsed by Runtime
   into typed events before product code sees it.
7. **Presentation reflects state.** Avatar's embodiment projection
   reflects the agent's current emotion / posture / attention
   state, drawn from the runtime's presentation stream.

This is what "the agent is the same being across sessions" looks
like architecturally. It isn't a single piece of code; it is the
choreography of Runtime, Cognition, Realm, and Avatar staying in
their lanes.

## What These Stories Have In Common

| Property | What it means |
| --- | --- |
| Multi-domain | Each story touches three or more authority domains. |
| Owner-respecting | No domain is allowed to redefine another's truth. |
| Boundary-mediated | Every cross-domain interaction goes through an admitted contract. |
| Audit-traceable | Every step is recorded; the user / auditor / future implementer can reconstruct what happened. |

The architecture exists to make these stories possible without
silent shortcuts. When something feels surprising — the cloud is
offline but AI still works, or the external AI cannot directly
press a button — the architecture is doing what it was designed for.

## Source Basis

- [`.nimi/spec/platform/architecture.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/architecture.md)
- [`.nimi/spec/runtime/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/index.md)
- [`.nimi/spec/runtime/kernel/workflow-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/workflow-contract.md)
- [`.nimi/spec/runtime/kernel/streaming-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/streaming-contract.md)
- [`.nimi/spec/runtime/kernel/multimodal-provider-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/multimodal-provider-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-capability-gateway-contract.md)
- [`.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/delegated-output-firewall-contract.md)
- [`.nimi/spec/realm/transit.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/transit.md)
- [`.nimi/spec/realm/agent.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/agent.md)
- [`.nimi/spec/realm/social.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/social.md)
- [`.nimi/spec/realm/economy.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/economy.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
