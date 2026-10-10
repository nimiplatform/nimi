# LocalAgent Access and App Authorization

A formal App uses its protected, host-bound SDK client to list authorized Agent references. It submits the returned session-scoped opaque `agentHandle` for admitted Agent operations. A raw LocalAgent ID, stable binding, or cached reference is not an operation authority.

Runtime derives and revalidates the account, App subject, current registration and declaration, operation coverage, target access, and session generation. Reconnect or session rotation requires fresh authorized references; the App must not replay a prior business action to restore access.

## Separate Operation Families

Ordinary `agent.local` access carries bounded Conversation and Agent Realtime operations, source introductions, and typed output. It does not expose private Memory, Knowledge, prompts, provider configuration, presentation internals, or account-wide Agent inventory.

Shared LocalAgent configuration requires `agent.configure`. Agent-specific Memory management and independent App business execution require their separately admitted operation and declaration coverage. Conversation access alone does not grant them. Knowledge V1 has no public operation path.

App-authored business instructions and skills use the dedicated business/skill contracts; they are not committed as ordinary chat or promoted into Agent identity. The App owns its project workflow and result adoption.

Nimi Home and Desktop host the App but do not replace Runtime authorization or Cognition Memory ownership. An unavailable or unauthorized operation returns its typed failure without a private-interface fallback.

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
