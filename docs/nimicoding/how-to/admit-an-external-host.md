# Admit An External Host

An external host is suitable when it can consume Nimi's authority and run its
checks without taking ownership of product truth or weakening fail-closed
behavior. Nimi Coding 0.3.x does not maintain an adapter registry or host
runtime.

## Recipe

1. Load the repository's `AGENTS.md` and affected `.nimi/spec/**` authority.
2. Verify repository read/write scope and command access.
3. Exercise a blocked result; the host must preserve the blocker.
4. Run deterministic project checks and capture actual results.
5. For app work, prove the host can drive the real app/runtime
   acceptance path.
6. Review secret, token, and provider custody.
7. Confirm that task planning, progress, review, and completion remain native
   host state rather than repository artifacts.

## Required Boundary

| Host owns | Host does not own |
| --- | --- |
| Task, plan, subagents, retry, resume, completion | `.nimi/spec/**` authority |
| Context and execution mechanics | Nimi Coding methodology or contracts |
| Real commands and runtime interaction | Promotion of local evidence to product truth |

## Rejection Conditions

Reject the host when it fabricates evidence, turns blocked results
into success, bypasses canonical SDK/runtime surfaces, requires secrets
outside admitted custody, or writes task progress into semantic project
truth.

## Source Basis

- [`.nimi/methodology/core.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/core.yaml)
- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)
- [`.nimi/spec/platform/authority-admission.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/authority-admission.authority.yaml)
