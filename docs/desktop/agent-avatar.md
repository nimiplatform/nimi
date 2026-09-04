# Agent Avatar (Desktop Chat Surface)

> Status: Running today. The avatar status display in Desktop chat is
> driven by Runtime; the full embodiment carrier is the separate,
> first-party Avatar app.

While you chat with an agent in Desktop, a small visual signal shows
what it's doing: idle, thinking, listening, speaking, or transitioning.
It is deliberately **not** an embodiment carrier. The Avatar app is the
carrier; Desktop chat is a **bridge** to it.

## What This Surface Is

| Concept | Meaning |
| --- | --- |
| `AvatarInteractionState` | Current-anchor / current-surface transient state inside Desktop chat |
| `phase` | `idle` / `thinking` / `listening` / `speaking` / `transitioning` |
| `emotion` | Optional projected emotion (consumed from runtime, not invented) |
| `actionCue` | Optional typed cue describing what the agent is doing |
| `attentionTarget` | Optional gaze / attention target |
| `visemeId` / `amplitude` | Optional lipsync-related fields |

This indicator is temporary: it reflects the conversation you currently
have open, and it isn't stored as lasting state.

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

This split is fixed. Desktop chat doesn't host a Live2D / VRM carrier;
if you want embodiment, open the Avatar app.

## How Desktop Chat Bridges Into Avatar

1. **Runtime emits status events.**
   `runtime.agent.presentation.*` and `runtime.agent.state.*` events
   carry phase, emotion, action cue, attention target, lipsync
   frames.
2. **Desktop chat normalizes.** Per
   `.nimi/spec/desktop/agent-projection.authority.yaml` (D-LLM-053..D-LLM-054), Desktop
   maps these events into a unified `AvatarInteractionState`.
3. **Reusable kit avatar consumes.** `kit/features/avatar` and
   `apps/avatar` both consume the normalized surface inputs. Neither
   reaches behind the contract for hidden Desktop semantics.

That's how the chat window and the standalone Avatar carrier stay in
sync without talking to each other — both listen to the same Runtime
events.

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

## What This Surface Does Not Do

- It doesn't render Live2D / VRM — that's `apps/avatar`.
- It doesn't store the persistent presentation profile — that's Runtime.
- It doesn't define the message / action envelope — that's the Desktop
  chat message / action contract.
- It doesn't run the voice session / workflow — those are the Desktop
  voice contracts.
- It isn't saved as lasting state — `AvatarInteractionState` is
  temporary, not durable.

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
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
