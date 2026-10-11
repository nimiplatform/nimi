# LocalAgent Access and Application Authorization

A formal application uses its host-bound SDK client to enumerate authorized agent references, submitting the returned session-scoped opaque `agentHandle` when invoking permitted operations. Raw LocalAgent IDs, static bindings, or cached local handles do not constitute valid operational authority.

Runtime resolves and revalidates security parameters before each execution: authenticated account identity, application subject, declared capability scopes, operational coverage, target agent permissions, and active session generation. Following connection drops or session rotations, the application must acquire fresh authorized handles; replaying prior business requests to recover access is rejected.

## Granular Capability Scope Families

System operations adhere to strict scope boundaries:
- **Standard Local Access (`agent.local`)**: Grants bounded access to conversation turns, Agent Realtime streaming, persona summaries, and typed responses. It explicitly withholds private Cognition memories, knowledge records, system prompts, AI provider credentials, Avatar internal pipeline states, and unpermitted agent inventories.
- **Shared Inference Configuration (`agent.configure`)**: Requires explicit, elevated authorization to update shared LocalAgent capability intent configurations (AIConfig). Machine Loadout management and machine-level model selection remain separately governed by Home and Runtime management surfaces.
- **Memory & Business Workflows**: Managing agent long-term memory or executing application-specific workflows requires separate declared capability scopes; standard conversation permissions never imply access to them. Knowledge V1 currently exposes no public operational interface.

App-authored instructions, custom skills, and business logic must use dedicated business and skill contracts. They cannot be committed into standard conversational history or promoted into core Character identities. The application owns its project lifecycle and result handling.

Nimi Home and Desktop host the application environment, but do not override Runtime authorization checks or Cognition memory boundaries. Unauthorized or unavailable operations fail closed, returning structured error responses without private fallback channels.

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
