# Admit An External Host

An external host is admitted when it can consume Nimi's truth and
contracts without taking ownership of project authority or weakening
fail-closed behavior.

## Recipe

1. Define the adapter identity in `.nimi/config/host-adapter.yaml`.
2. Verify required context order and repository read access.
3. Verify typed handoff input and result output.
4. Exercise a blocked result; the host must preserve the blocker.
5. Exercise deterministic project checks and capture actual results.
6. For app work, prove the host can drive the real app/runtime
   acceptance path.
7. Review secret, token, and provider custody.

## Required Boundary

| Host owns | Host does not own |
| --- | --- |
| Task, plan, subagents, retry, resume, completion | `.nimi/spec/**` authority |
| Context and execution mechanics | Nimi Coding methodology or contracts |
| Real commands and runtime interaction | Promotion of local evidence to product truth |

## Rejection Conditions

Reject the adapter when it fabricates evidence, turns blocked results
into success, bypasses canonical SDK/runtime surfaces, requires secrets
outside admitted custody, or writes task progress into semantic project
truth.

## Source Basis

- [`.nimi/contracts/external-host-compatibility.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/external-host-compatibility.yaml)
- [`.nimi/config/host-adapter.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/config/host-adapter.yaml)
- [`.nimi/methodology/skill-handoff.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/skill-handoff.yaml)
