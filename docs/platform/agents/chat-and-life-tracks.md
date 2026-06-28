# Chat And Life Tracks

Every Nimi agent runs on two distinct execution tracks. This isn't
a UX feature; it is a hard architectural cleavage. Understanding
why the platform separates them is the difference between "an agent
that responds to you" and "an agent that has its own life."

## The Two Tracks

| Track | Driven by | Owner |
| --- | --- | --- |
| Chat Track | Reactive — user or app input | Runtime |
| Life Track | Partial — Runtime-owned narrow follow-up-turn hooks only in the first release promise | Runtime |

The two tracks share the agent's state — same Soul, same Memory,
same Worldview — but their scheduling surfaces never collapse into
one.

| Property | Chat Track | Life Track |
| --- | --- | --- |
| Trigger | User / app input | Runtime-owned narrow follow-up-turn hook |
| Default | Always available | Default off; opt-in |
| Cadence | Per-input | Future broader cadence model; not a first release promise |
| Token budget | Per-request semantics | Daily by default |
| Output | Chat reply, possibly streamed | Follow-up turn projection only in the first release promise |
| Behavior when other track is busy | Available | Suspended if Chat is in flight (admitted by runtime) |

The Life Track is partial in the first release promise. Runtime may
admit narrow follow-up-turn hooks, but general reminders, appointments,
host automation, broad event bus behavior, and app scheduler ownership
are outside this promise.

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

The broader cadence model is architectural direction, not a first
release promise. The first release promise is narrow follow-up-turn only.

Future cadence vocabulary:

| Cadence | Meaning |
| --- | --- |
| `off` | Life Track suspended; agent is reactive only |
| `low` | Occasional autonomous moments under daily budget |
| `medium` | More frequent autonomous moments |
| `high` | Most aggressive autonomous behavior; daily budget likely consumed |

Default is `off`. Broader user-controlled cadence remains outside the
first release promise until explicitly admitted.

Life cadence is not "how smart" the agent is. It is "how often the
agent acts on its own initiative." A `high`-cadence agent consumes
more tokens; it does not become a different agent.

## Token Budget

The narrow follow-up-turn path has Runtime-owned budget checks. A
broader daily Life Track budget model remains outside the first release
promise until explicitly admitted.

Chat Track does not share this budget. A chat reply happens
regardless of Life budget state.

The user (or host product) can adjust the budget; the platform's
default is intentionally conservative.

## Reader Scenario: Chat And Narrow Follow-Up Both Active

A user has an agent named Yuki. Yuki is in reactive chat, and Runtime
has admitted one narrow follow-up-turn hook.

Throughout the day:

- Morning: user asks Yuki for the weather. Chat Track activates;
  Yuki replies. Token budget for the chat reply is per-request.
- Afternoon: Runtime dispatches the admitted narrow follow-up-turn hook.
  Yuki produces a bounded follow-up turn. That intent enters the hook
  lifecycle.
- Evening: user returns. Yuki's chat is responsive — the Life
  Track activity in the afternoon did not interrupt chat
  availability.
- Later: the hook fires through Runtime. The user sees a bounded
  follow-up message in chat.

Two tracks; one agent. The user experiences the agent as
continuous; the platform tracks the audit and budget separately.

## Reader Scenario: Follow-Up Budget Denied, Chat Still Works

Suppose Runtime denies a narrow follow-up-turn hook because the admitted
budget is exhausted.

- Runtime refuses the follow-up-turn dispatch with a typed state.
- Chat Track is unaffected. Any input from the user gets a chat
  reply.
- The user does not experience any visible saturation; what they
  see is "I can talk to Yuki normally." What does not happen is a
  false success follow-up.

This separation is the architectural payoff. Reactive availability
is not held hostage by proactive cost.

## Reader Scenario: Default Off Is The Right Default

A new user installs Nimi and creates their first agent.

- Life Track is `off` by default. The agent is reactive only.
- The user has not yet decided whether they want broader Life behavior.
  The platform does not start spending tokens autonomously without
  explicit consent.
- The user can later opt into admitted Life surfaces after they are
  explicitly release-promised.

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
