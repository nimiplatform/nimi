# Message Actions

> Status: Running today. The Desktop agent chat behavior contract
> + agent chat message action contract are shipped under
> `desktop/kernel/agent-chat-{behavior,message-action}-contract.md`.

Per-message actions in Desktop chat (regenerate, fork, edit, etc.)
are admitted under typed contracts that govern what each action
does, what conversation continuity it preserves, and how it
participates in admitted runtime turn semantics.

## Behavior + Message Action Split

| Contract | Owns |
| --- | --- |
| Agent chat behavior | Generic behavior across messages (turn admission, retry posture, mid-stream stop) |
| Agent chat message action | Per-message typed actions (regenerate, fork, edit) |

Generic behavior (e.g., "stopping mid-stream preserves partial reply")
is the behavior contract. Per-message actions (e.g., "the user
clicked regenerate on this message") are the message action contract.

## Admitted Message Actions

| Action | What it does |
| --- | --- |
| Regenerate | Re-derive the agent's reply for the same anchor + turn input |
| Fork | Branch the conversation from this message; create a new anchor or sub-anchor per the contract |
| Edit | Edit the user's prior message and re-derive |
| Other admitted actions per `agent-chat-message-action-contract.md` |

Each action is typed; app code does not invent new actions.

## Boundary

| Owns | Does NOT own |
| --- | --- |
| Per-message action UI + typed dispatch | Turn execution (Runtime) |
| Action-induced anchor lifecycle | `ConversationAnchor` semantics (Runtime) |
| User-facing message action surface | Realm chat thread truth (Realm) |

## Reader Scenario: User Regenerates A Reply

User clicks regenerate on the agent's last message.

1. **Action dispatched.** Desktop emits typed regenerate action for
   the targeted message.
2. **Anchor preserved.** Same `ConversationAnchor`; new turn under
   admitted regenerate semantics.
3. **Runtime processes.** Turn lifecycle re-runs.
4. **New reply streams.** Replaces (or stacks per contract) the
   previous one in the chat thread.

## Reader Scenario: User Forks From A Message

User wants to explore an alternate conversation branch from this
point.

1. **Fork action dispatched.** Desktop emits typed fork action.
2. **New anchor created.** Per the message action contract's fork
   semantics.
3. **Original conversation untouched.** The user can switch between
   the original and the fork.

## What Message Actions Do Not Do

- They do not let app code invent new actions.
- They do not bypass turn lifecycle.
- They do not silently mutate Realm chat thread truth.
- They do not redefine `ConversationAnchor` shape.

## Source Basis

- [`.nimi/spec/desktop/kernel/agent-chat-behavior-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/agent-chat-behavior-contract.md)
- [`.nimi/spec/desktop/kernel/agent-chat-message-action-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/kernel/agent-chat-message-action-contract.md)
- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
