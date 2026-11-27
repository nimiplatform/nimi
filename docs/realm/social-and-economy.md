# Social Graph

Realm Social manages friendships and blocking across Nimi accounts.

## Account Social Graph

Realm Social manages human-to-human relationships at the account level through two core records: `Friendship` and an independent `AccountBlock`.

- **Uniquely Ordered Account Pairs**: Each `Friendship` is stored against a canonical, uniquely ordered pair of accounts. Friendships support requests, state transitions, and removal.
- **Cross-World Account Continuity**: Because friendships belong to user accounts rather than individual worlds, users do not need to re-add friends when switching worlds. However, an account-level connection does not mean every application can freely read your social graph; actual visibility and actions always depend on current authorization.
- **Clear Domain Boundaries**:
  - **Messaging**: Human-to-human direct messaging checks applicable friendship and block preconditions in Realm Social, while conversation streams and message delivery are handled by [Realm Chat](/realm/chat).
  - **Characters and Local Agents**: Realm Social only tracks relationships between human accounts. It does not hold Character or Persona relationships, nor is it responsible for LocalAgent creation, dialogue, or long-term memory.

## Application Access and Permissions

Nimi Apps use explicitly admitted `client.realm` operations on a protected host session. Runtime manages credentials locally, and Realm checks resource-level permissions on each request.

## Related Documentation

- [Realm Realtime Chat Architecture](/realm/chat)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
