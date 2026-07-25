# Agent Avatar (Desktop Chat Surface)

> Status: Running today. Desktop chat consumes the runtime-owned
> avatar transient surface authority; the carrier app (Avatar) is a
> separate first-party app.

Desktop's agent chat shows an avatar transient surface — the small
visual signal that the agent is idle, thinking, listening, speaking,
or transitioning. It is intentionally **not** an embodiment carrier.
The Avatar app is the embodiment carrier; Desktop's chat is a
**bridge**.

## What This Surface Is

| Concept | Meaning |
| --- | --- |
| `AvatarInteractionState` | Current-anchor / current-surface transient state inside Desktop chat |
| `phase` | `idle` / `thinking` / `listening` / `speaking` / `transitioning` |
| `emotion` | Optional projected emotion (consumed from runtime, not invented) |
| `actionCue` | Optional typed cue describing what the agent is doing |
| `attentionTarget` | Optional gaze / attention target |
| `visemeId` / `amplitude` | Optional lipsync-related fields |

This surface is transient: it lives in Desktop chat for the current
anchor / surface only. It does not become canonical truth.

## Why Desktop Chat Is Not the Embodiment Carrier

| Concern | Owned by |
| --- | --- |
| Embodiment / carrier rendering | Avatar app (`apps/avatar`) — Live2D / VRM execution lives there |
| Persistent presentation profile / default voice | Runtime (`agent-presentation-contract.md`) |
| Transient runtime presentation events | Runtime (`agent-presentation-stream-contract.md`) |
| Message / action envelope | Desktop chat message / action contract |
| Voice session / workflow | Desktop chat voice contracts |
| Desktop chat avatar transient surface | Desktop (this surface) |
| Reusable kit avatar module | `kit/features/avatar` (consumes normalized inputs only) |

The owner cut is fixed. Desktop chat does not host a Live2D / VRM
carrier; if the user wants embodiment, the Avatar app surfaces it.

## How Desktop Chat Bridges Into Avatar

1. **Runtime emits transient projection.**
   `runtime.agent.presentation.*` and `runtime.agent.state.*` events
   carry phase, emotion, action cue, attention target, lipsync
   frames.
2. **Desktop chat normalizes.** Per
   `.nimi/spec/desktop/agent-projection.authority.yaml` (D-LLM-053..D-LLM-054), Desktop
   maps these events into a unified `AvatarInteractionState`.
3. **Reusable kit avatar consumes.** `kit/features/avatar` and
   `apps/avatar` both consume the normalized surface inputs. Neither
   reaches behind the contract for hidden Desktop semantics.

This is why the chat surface and the standalone Avatar carrier stay
in sync without coordinating with each other — they consume the same
runtime projection.

## Reader Scenario: A Voice Turn Drives Both Surfaces

A user speaks to their agent. The Avatar app is open; Desktop chat
is also open.

1. **Voice begins.** Runtime emits transient `presentation.*` events:
   `phase: listening`, then `phase: thinking`, then `phase: speaking`
   with lipsync frames.
2. **Desktop chat updates.** The chat avatar transient surface shows
   the matching phase indicator + emotion projection inline near the
   message bubble.
3. **Avatar carrier updates.** `apps/avatar` consumes the same
   runtime events; the embodiment renders the speaking pose +
   lipsync via Live2D.
4. **Both surfaces are in sync.** Neither talks to the other; both
   talk to runtime.

If the user closes the Avatar carrier, Desktop chat's transient
surface continues to render — it is its own surface.

## Reader Scenario: Group Chat Anti-Spoof

A user is in a group chat with humans plus an agent slot.

1. **Group thread.** Realm `R-CHAT-*` admits `GROUP` substrate.
2. **Agent posts.** Realm validates the agent slot binding before
   the message commits. Anti-spoof check happens at protocol level.
3. **Desktop chat avatar surface reflects the agent author.** The
   transient surface for the agent author updates with the runtime
   projection for that turn.
4. **Humans cannot impersonate the agent.** The slot binding is
   admitted Realm authority — the avatar transient surface never
   shows on a human author.

The transient surface trusts Realm slot binding for identity. It
does not invent author identity.

## What This Surface Does Not Do

- It does not host Live2D / VRM rendering — that's `apps/avatar`.
- It does not own persistent presentation profile — that's runtime.
- It does not own message / action envelope — that's Desktop chat
  message / action contract.
- It does not own voice session / workflow — those are Desktop voice
  contracts.
- It does not become canonical truth — `AvatarInteractionState` is
  transient, not durable.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Desktop chat avatar transient surface | Desktop (`.nimi/spec/desktop/agent-projection.authority.yaml`, D-LLM-053..) |
| Persistent presentation profile + default voice | Runtime (`agent-presentation-contract.md`) |
| Transient turn / presentation seam | Runtime (`agent-presentation-stream-contract.md`) |
| Avatar carrier + embodiment execution | Avatar app (`apps/avatar`) |
| Reusable kit avatar consumer | `kit/features/avatar` |
| Configuration / debug workbench | Desktop (`.nimi/spec/desktop/agent-projection.authority.yaml`, `agent-avatar-debug-workbench-contract.md`) |

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/desktop/kernel/agent-avatar-debug-workbench-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/agent-avatar-debug-workbench-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
- [`.nimi/spec/avatar/kernel/app-shell-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/app-shell-contract.md)
