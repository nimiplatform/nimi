# Claude Code Adapter

This adapter defines how to use `@nimiplatform/nimi-coding` with Claude Code
without turning Claude into the semantic owner.

## Intent

Use Claude Code for:

- inline coding with direct filesystem access
- exploration, planning, and execution in a single session
- review and decision projection (manager-ready, not manager-owned)
- AGENTS.md-governed module-scoped work via PreToolUse hooks

Keep `nimicoding` responsible for:

- project-local `.nimi/**` truth
- authority boundaries
- handoff constraints
- packet, prompt, worker-output, and acceptance schema ownership
- fail-closed validation

## Integration Mode

Claude Code integrates differently from oh-my-codex:

| Concern | oh-my-codex | Claude Code |
|---|---|---|
| Host class | external execution host | inline coding host |
| Instruction format | AGENTS.md (native) | CLAUDE.md (native) + AGENTS.md (hook-injected) |
| Module context | automatic on every interaction | PreToolUse hook on Read/Edit/Write |
| Operational state | `.omx/` | `.claude/` |
| Execution mode | external handoff via JSON | inline in-repo execution |
| Review capability | execution only | execution + inline review |

## Boundary

Treat the systems as layered rather than merged:

- `@nimiplatform/nimi-coding` is the semantic kernel.
- Claude Code is a constrained inline coding host.
- This adapter is only the bridge.

Claude Code may read `.nimi/**` and produce execution artifacts, but it must not:

- become the owner of `.nimi/spec/**`
- treat cutover readiness as an authority flip
- decide semantic acceptance or final disposition
- redefine methodology state from `.claude/**` operational state
- bypass `nimicoding doctor`, `handoff`, or validator gates
- use hooks as a replacement for AGENTS.md authority

## Context Channel

Claude Code receives module-level AGENTS.md content through a PreToolUse hook:

1. Hook fires on **Read**, **Edit**, and **Write** tool calls
2. Script walks up from the target file to find the nearest `AGENTS.md`
3. Content is injected as `additionalContext` before the tool executes
4. Root `AGENTS.md` is already synced into `CLAUDE.md` (not re-injected)
5. **Grep/Glob/Bash** do not trigger injection — manual AGENTS.md reads
   are still needed for search-based exploration

The `CLAUDE.md` managed block (marker `nimicoding:managed:claude`) provides
the baseline methodology context. Module-level AGENTS.md provides scoped
constraints on top of that baseline.

## Coverage Gap

| Tool | Hook fires? | Module AGENTS.md visible? |
|---|---|---|
| Read | Yes | Automatic |
| Edit | Yes | Automatic |
| Write | Yes | Automatic |
| Grep | No | Manual read needed |
| Glob | No | Manual read needed |
| Bash | No | Manual read needed |
| Agent (subagent) | No | Manual read needed |

## Mapping

| Claude concern | Adapter rule | `nimicoding` owner |
|---|---|---|
| exploration/planning | hook-injected module context | `.nimi/methodology/skill-handoff.yaml` |
| prompt handoff | consume exported prompt/context | `.nimi/methodology/skill-handoff.yaml` |
| worker output | write candidate artifact only under declared local roots | `.nimi/contracts/worker-output.schema.yaml` |
| evidence | write candidate artifact only under declared local roots | packet/evidence contract family |
| inline review | project decision material, do not decide | manager-reviewed `nimicoding` semantics |
| final disposition | Claude must not decide | manager-reviewed `nimicoding` semantics |
