# Message Actions

> Status: Running today. The behavior and per-message action rules for
> Desktop agent chat ship under
> `desktop/kernel/agent-chat-{behavior,message-action}-contract.md`.

Every message in Desktop chat comes with actions — regenerate, fork,
edit, and more. Each action has a precisely defined behavior: what it
does, what conversation continuity it keeps, and how it runs through
Runtime's turn semantics.

## Behavior + Message Action Split

| Contract | Owns |
| --- | --- |
| Agent chat behavior | Generic behavior across messages (turn admission, retry posture, mid-stream stop) |
| Agent chat message action | Per-message typed actions (regenerate, fork, edit) |

Generic behavior — like "stopping mid-stream keeps the partial reply" —
lives in the behavior contract. Per-message actions — like "you clicked
regenerate on this message" — live in the message action contract.

## Admitted Message Actions

| Action | What it does |
| --- | --- |
| Regenerate | Re-derive the agent's reply for the same anchor + turn input |
| Fork | Branch the conversation from this message; create a new anchor or sub-anchor per the contract |
| Edit | Edit the user's prior message and re-derive |
| Other admitted actions per `agent-chat-message-action-contract.md` |

The action set is fixed and typed; app code can't invent new actions.

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

- App code can't invent new actions.
- They don't bypass the turn lifecycle.
- They don't silently change the human chat history stored in Realm.
- They don't redefine the `ConversationAnchor` shape.

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
