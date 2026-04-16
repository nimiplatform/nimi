# nimi-cognition AGENTS.md

## Scope

Applies to `nimi-cognition/**`. Standalone Go module for per-agent local cognition.

## Hard Boundaries

- Standalone Go module: own `go.mod`; do not depend on other monorepo modules/packages, and keep external dependencies limited to the admitted SQLite driver/runtime plus its transitive support libraries.
- SQLite is the only admitted durable backend. Do not reintroduce parallel
  file-based persistence surfaces.
- Cognition completion status is determined by cognition-owned spec and rule
  evidence. Green module gates do not by themselves justify promoting reopened
  `deferred` cognition rules back to `covered`.
- Repo-wide blockers outside cognition must be recorded separately and must not
  be misreported as cognition completion failure.
- No imports from `runtime/**`, `sdk/**`, `apps/**`, or any other monorepo package.
- No coupling to runtime services (AgentCore, Memory, Knowledge). Runtime
  adaptation is a separate phase outside this package.
- Dependency flow is strictly downward (see graph below). No cycles.
- Go conventions: constructor injection, no global mutable state,
  `fmt.Errorf("op: %w", err)`, no `log.Println`.
- Fail-closed validation: malformed data must be rejected, never silently accepted.
- Digest MUST NOT directly mutate agent_model_kernel or world_model_kernel.
  Kernel mutation goes exclusively through `kernelops/`.

## Package Structure

| Package | Responsibility | Dependencies |
|---|---|---|
| `kernel/` | Rule (3 state axes), Kernel, AgentModel/WorldModel types + validation. Zero I/O. | none |
| `memory/` | Memory substrate types (Record, Experience, Observation, Event, Evidence, Narrative) + validation. | `kernel` (for SourceRef, RefStrength) |
| `knowledge/` | Knowledge projection types (Page, Citation) + validation. | `kernel` |
| `skill/` | Skill artifact types, validation, lifecycle/history semantics. | `kernel` |
| `working/` | Transient working state types + validation. | none |
| `kernelops/` | Git-like update surface: IncomingPatch → Diff → Conflict → Resolve → Commit + 6 operations. | `kernel`, `internal/storage`, `internal/clock`, `internal/identity` |
| `prompt/` | Format all artifact families for LLM prompt/context consumption. | `kernel`, `memory`, `knowledge`, `skill` |
| `routine/` | Routine interface and framework. | none |
| `routine/digest/` | Digest routine: external analysis + lifecycle-aware archive/remove phases on memory/knowledge/skill. | `memory`, `knowledge`, `skill`, `internal/storage`, `internal/refgraph` |
| `cognition/` | Top-level facade wiring standalone local cognition services, history, and routine context. | all above |
| `internal/storage/` | Unified SQLite persistence backend for durable artifact families. | none |
| `internal/refgraph/` | Reference integrity graph and support queries. | `memory` |
| `internal/identity/` | ULID-style ID generation (stdlib only). | none |
| `internal/scope/` | ScopeID validation. | none |
| `internal/clock/` | Clock interface for testability. | none |
| `internal/testutil/` | Shared test infrastructure. | `internal/storage` |

## Dependency Graph

```
                     cognition (facade)
                  /   |    |    |    |    \
                 v    v    v    v    v     v
            kernelops memory knowledge skill working prompt
                |       |       |      |             |
                v       v       v      v             v
             kernel  internal/storage + refgraph   kernel
                 \         |        |        /       /
                  v        v        v       v       v
                    internal/identity, scope, clock
```

## Retrieval Defaults

Start in `kernel/`, `kernelops/`, `cognition/`. Then `memory/`, `knowledge/`,
`skill/`, `working/`. Then `routine/digest/`, `prompt/`. Finally `internal/`.

## Verification Commands

```bash
cd nimi-cognition && make all        # build + vet + test
cd nimi-cognition && make test-race  # race detector
cd nimi-cognition && make lint       # golangci-lint (if installed)
```
