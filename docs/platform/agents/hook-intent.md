# Hook Intent

A `HookIntent` is the typed contract by which an agent requests
future follow-up-turn action. Models cannot emit free-form scheduling
logic; they emit typed hook intents that Runtime validates and admits.
For the first release promise this is narrow follow-up-turn only; general
reminders, appointments, broad automation, and app scheduler ownership are
not promised.

This is what makes "an agent proposes a bounded follow-up turn" a typed
Runtime decision instead of a free-form prompt.

## What Hook Intent Solves

A naive agent design lets the model emit arbitrary future-action text.
That string is not itself an admitted hook — it is a model output that
some downstream code would need to interpret and turn into an actual
call.

Two failure modes follow:

- **Free-form interpretation.** Different code paths interpret the
  string differently; the agent's intent drifts from what actually
  happens.
- **Capability sprawl.** If the agent can request anything, it
  needs a sandbox for everything.

Nimi's response: agents emit **typed `HookIntent` records**, not
free-form strings. The intent has a typed verb, typed parameters,
and a contract against which Runtime validates. The model proposes;
Runtime admits or refuses; the admitted intent enters a typed
lifecycle.

## What `HookIntent` Carries

A typed intent record describes:

| Field | Meaning |
| --- | --- |
| Intent kind | What sort of follow-up-turn action is requested |
| Parameters | Typed arguments specific to the kind |
| Schedule | When the narrow follow-up-turn hook is eligible to fire |
| Scope | Within whose context this intent runs |
| Approval requirement | Whether user approval is needed before firing |

The kinds and parameters are admitted in the runtime kernel; agents
can't invent new kinds. An undeclared kind fails closed.

## Hook Lifecycle

Once admitted, an intent enters the hook lifecycle:

| State | Meaning |
| --- | --- |
| `pending` | Admitted; awaiting fire time |
| `running` | Currently executing |
| `completed` | Successful terminal |
| `failed` | Failed terminal |
| `canceled` | Canceled before completion |
| `rescheduled` | Moved to a new schedule; transitions back to `pending` |
| `rejected` | Refused at admission |

The state machine is the same for any agent's hooks. An intent that
never reaches `pending` is one Runtime refused to admit.

## Reader Scenario: An Agent Requests A Follow-Up Turn

A user mentions an interview. The agent proposes a bounded follow-up turn.

1. **Agent emits typed intent.** Through APML wire format, the
   model produces a typed `HookIntent` record for a narrow
   follow-up-turn effect, scoped to `chat conversation X`.
2. **Runtime validates.** The follow-up-turn effect is admitted. The
   parameters fit the contract. The hook is within the agent's
   life-track budget allotment.
3. **Admission.** Runtime admits the intent. The hook moves from
   `pending → running` only when Runtime dispatches the narrow
   follow-up-turn.
4. **Fire.** The hook runs through Runtime. The agent's life-track
   produces a follow-up turn under its admitted budget.
5. **Terminal.** The hook completes. Audit records the firing.

What did **not** happen:

- The model did not emit a free-form scheduling string.
- The user did not grant a general scheduler or app-authored automation
  surface.
- The hook did not bypass the daily token budget.

The typed contract is what makes this safe and predictable.

## Reader Scenario: An Intent That Gets Rejected

An agent attempts to emit a `HookIntent` for an action that is not
admitted under the kind's contract — perhaps the parameters violate
a sensitivity rule, or the agent does not have capability for the
target.

1. **Validation fails.** The intent does not match the admitted
   contract.
2. **State.** The intent moves to `rejected`. It doesn't enter
   `pending`.
3. **Audit.** The rejection is recorded with reason.
4. **Agent learns.** The rejection is observable to the agent (in
   typed form), so the agent can choose a different approach.

The rejection is not silent. Runtime tells the agent why; the
agent's next turn can adjust.

## Reader Scenario: A Hook Is Rescheduled

A scheduled hook needs to move — perhaps the agent has new
information that suggests the original time is no longer
appropriate.

1. **Reschedule request.** The agent emits a typed reschedule
   request referencing the existing intent.
2. **Validation.** Runtime checks that the reschedule is admitted
   for this intent.
3. **State.** The hook moves to `rescheduled`, then back to
   `pending` with the new schedule.
4. **Audit.** The reschedule lineage is recorded.

`rescheduled` is a transitional state, not a terminal. It captures
the fact that the schedule changed; the audit lets a future reader
see why.

## Why "Typed Intent, Not Free-Form String"

| Concern | What typed intents give you |
| --- | --- |
| Audit | Each intent is a typed record with structured lineage |
| Capability bounding | Kind + parameters are admitted; nothing free-form |
| Replay | Replay can step through the intent record without re-inferring |
| Approval | Sensitivity is derivable from the typed kind |
| Budget | Token budget is enforced on admission, not at firing |
| Schedule reliability | Runtime owns the narrow follow-up-turn scheduler; the model does not invent timing semantics |

A platform that lets the model emit free-form scheduling strings
has none of these. A platform that requires typed intents has all
of them by construction.

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
