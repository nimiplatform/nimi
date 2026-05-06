# Chat And Life Tracks

Every Nimi agent runs on two distinct execution tracks. This isn't
a UX feature; it is a hard architectural cleavage. Understanding
why the platform separates them is the difference between "an agent
that responds to you" and "an agent that has its own life."

## The Two Tracks

| Track | Driven by | Owner |
| --- | --- | --- |
| Chat Track | Reactive — user or app input | Runtime |
| Life Track | Proactive — agent autonomy + Runtime hook scheduling | Runtime |

The two tracks share the agent's state — same Soul, same Memory,
same Worldview — but their scheduling surfaces never collapse into
one.

| Property | Chat Track | Life Track |
| --- | --- | --- |
| Trigger | User / app input | Runtime hook scheduling |
| Default | Always available | Default off; opt-in |
| Cadence | Per-input | `off` / `low` / `medium` / `high` |
| Token budget | Per-request semantics | Daily by default |
| Output | Chat reply, possibly streamed | Life-turn output, possibly persistent |
| Behavior when other track is busy | Available | Suspended if Chat is in flight (admitted by runtime) |

The Life Track is opt-in for a reason: a proactive agent consumes
tokens whether or not anyone is talking to it. The default-off
posture makes that opt-in explicit.

## Why Two Tracks Are A Hard Architectural Cleavage

A naive design would have one scheduling surface that handles both
"user said something" and "the agent decides to do something
itself." Nimi splits them deliberately:

| Concern | Why two tracks |
| --- | --- |
| Token budget | Reactive cost is per-request; proactive cost is per-day. Mixing them blurs both. |
| Chat reliability | Chat must always be available. Life Track being saturated should not prevent the agent from responding. |
| Audit | Chat output and Life output have different audit categories; mixing them obscures the difference between "asked" and "acted unprompted." |
| Approval | Some Life-Track actions may require approval. Chat replies do not. Different gates per track. |
| Replay | Replay of an autonomous moment is not the same as replay of a chat turn. The recorded streams stay distinct. |

Mixing the tracks would force every analysis — billing, audit,
replay, debugging — to disambiguate what the unified loop just did.
Splitting them means the disambiguation is built into the platform.

## Cadence

The Life Track has four cadences:

| Cadence | Meaning |
| --- | --- |
| `off` | Life Track suspended; agent is reactive only |
| `low` | Occasional autonomous moments under daily budget |
| `medium` | More frequent autonomous moments |
| `high` | Most aggressive autonomous behavior; daily budget likely consumed |

Default is `off`. The user (or host product) chooses whether to
turn Life on, and at what cadence.

Life cadence is not "how smart" the agent is. It is "how often the
agent acts on its own initiative." A `high`-cadence agent consumes
more tokens; it does not become a different agent.

## Token Budget

Life Track has a daily token budget by default. When the budget is
exhausted, the Life Track stops dispatching new turns until the
budget resets.

Chat Track does not share this budget. A chat reply happens
regardless of Life budget state.

The user (or host product) can adjust the budget; the platform's
default is intentionally conservative.

## Reader Scenario: Chat And Life Both Active

A user has an agent named Yuki. Yuki's Life Track is enabled at
`medium` cadence.

Throughout the day:

- Morning: user asks Yuki for the weather. Chat Track activates;
  Yuki replies. Token budget for the chat reply is per-request.
- Afternoon: user is away. Yuki's Life Track is dispatched by the
  hook scheduler. Yuki notices a memory she has — the user
  mentioned an interview tomorrow. Yuki emits a typed `HookIntent`
  for "remind to wish good luck tomorrow at 8am." That intent
  enters the hook lifecycle.
- Evening: user returns. Yuki's chat is responsive — the Life
  Track activity in the afternoon did not interrupt chat
  availability.
- Next morning at 8am: the hook fires. Yuki's Life Track produces
  a brief good-luck message. The user sees it as a proactive
  message in chat.

Two tracks; one agent. The user experiences the agent as
continuous; the platform tracks the audit and budget separately.

## Reader Scenario: Life Track Saturated, Chat Still Works

Suppose Yuki's Life Track has consumed her daily token budget by
late afternoon — perhaps the cadence was `high` and several
autonomous moments were dispatched.

- Life Track stops dispatching new turns until the budget resets.
- Chat Track is unaffected. Any input from the user gets a chat
  reply.
- The user does not experience any visible saturation; what they
  see is "I can talk to Yuki normally." What does not happen is
  any further autonomous moments today.

This separation is the architectural payoff. Reactive availability
is not held hostage by proactive cost.

## Reader Scenario: Default Off Is The Right Default

A new user installs Nimi and creates their first agent.

- Life Track is `off` by default. The agent is reactive only.
- The user has not yet decided whether they want a proactive
  agent. The platform does not start spending tokens autonomously
  without explicit consent.
- The user can later turn Life on at `low`, observe behavior,
  decide to raise to `medium`, etc.

If the default were `on`, every new agent would immediately start
consuming budget and producing autonomous moments. The opt-in
default respects the user's consent and budget.

## Source Basis

- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-hook-intent-contract.md)
- [`.nimi/spec/runtime/kernel/agent-output-wire-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-output-wire-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
- [`.nimi/spec/runtime/kernel/tables/runtime-agent-service-typed-family.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-agent-service-typed-family.yaml)
- [`.nimi/spec/runtime/kernel/tables/runtime-agent-event-projection.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-agent-event-projection.yaml)
- [`.nimi/spec/runtime/kernel/audit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/audit-contract.md)
