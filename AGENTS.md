# AGENTS.md

> Project conventions for ALL AI agents (Claude, Codex, Gemini, Cursor, Copilot, Kimi).

## Project Context

Nimi is an AI-native open world platform. This is the open-source monorepo.

| Component | Language | Path | License |
|-----------|----------|------|---------|
| **nimi-runtime** | Go 1.24 | `runtime/` | Apache-2.0 |
| **nimi-sdk** | TypeScript | `sdk/` | Apache-2.0 |
| **desktop** | Tauri + React 19 | `apps/desktop/` | MIT |
| **nimi-web** | React 19 | `apps/web/` | MIT |
| **nimi-mods** | TypeScript | `nimi-mods/` (external repo root) | MIT |
| **proto** | Protocol Buffers | `proto/` | Apache-2.0 |
| **docs** | Markdown | `docs/` | CC-BY-4.0 |

```bash
pnpm install              # Install all dependencies
pnpm build                # Build SDK + Desktop + Web
pnpm build:runtime        # Build runtime to dist/nimi
```

## Per-Component Conventions

Each component has its own AGENTS.md with specific conventions:

- [`runtime/AGENTS.md`](runtime/AGENTS.md) — Go, gRPC, Buf CLI
- [`sdk/AGENTS.md`](sdk/AGENTS.md) — TypeScript, ESM, package boundaries
- [`apps/desktop/AGENTS.md`](apps/desktop/AGENTS.md) — Tauri, React, nimi-hook
- [`nimi-mods/AGENTS.md`](nimi-mods/AGENTS.md) — External mod repo workflow and build contract

## AI-Native Planning Rules

This project uses AI as primary executor. **Do NOT default to MVP/phased approaches.**

- **Ambiguity = risk, complexity with clear rules = trivial.** A well-specified 20-file change is easier than a vague 3-file "MVP"
- **No intermediate states** unless a hard external dependency blocks the final state
- **Prefer one complex PR over three simple PRs.** Each boundary introduces merge risk and state drift
- **Never "save cognitive load" for AI.** Don't simplify schemas, defer features, or add compatibility shims

## Code Organization for AI

- **No file/directory name collisions.** If `foo.ts` extracts to `foo/`, the file must move into that directory
- **No forwarding shells** outside `index.ts`. Inline the logic or use direct re-exports
- **Explicit type signatures** on facade methods. No `Parameters<Service['method']>[0]`
- **Maximum 3-hop debug trace.** From user-facing code to business logic: at most 3 files

## Cross-Component Boundaries

```
desktop  ──@nimiplatform/sdk──→  runtime (gRPC)
desktop  ──@nimiplatform/sdk──→  realm (REST+WS)
web      ──@nimiplatform/sdk──→  realm (REST+WS)
nimi-mods──nimi-hook──→ desktop ──@nimiplatform/sdk──→ runtime/realm
```

**MUST NOT:**
- Desktop/Web must not import from `runtime/internal/`
- SDK must not import across `realm` ↔ `runtime` boundary
- Mods must not bypass nimi-hook to call SDK directly
- Runtime must not import from `sdk/` or `apps/desktop/`

## Language-Specific Rules

### TypeScript (SDK, Desktop, Web, Mods)

- ESM imports with `.js` extension for `.ts` files
- **ULID** for new app-level IDs
- **Zod** `safeParse` for runtime validation
- No `console.log` in production code
- TypeScript-first. Use only dependencies already in `package.json`

### Go (Runtime)

- Module: `github.com/nimiplatform/nimi/runtime`
- **ULID** (`oklog/ulid/v2`) for all generated IDs
- No global state — constructor injection
- `fmt.Errorf("operation: %w", err)` for error wrapping
- `go vet` + `golangci-lint` must pass

### Protocol Buffers (Proto)

- Source in `proto/runtime/v1/`
- Generated stubs committed, CI-verified (zero-drift regeneration)
- Use Buf CLI: `buf lint`, `buf breaking`, `buf generate`

## Git Safety

- **NEVER revert or checkout files outside the explicit scope of the current task**
- **Only stage files directly related to the current task**
- Assume all uncommitted changes are intentional unless told otherwise

## Sensitive Domains

| Domain | Paths | Concern |
|--------|-------|---------|
| Auth | `**/auth/**`, `**/grant/**` | Security |
| Economy | `**/economy/**`, `**/gift/**`, `**/asset/**` | Financial accuracy |
| AI | `**/ai/**`, `**/services/ai/**` | Inference correctness |
| Audit | `**/audit/**`, `**/auditlog/**` | Compliance |

## Documentation

| Path | Content |
|------|---------|
| `docs/getting-started/` | Quick start guide |
| `docs/architecture/` | Platform architecture |
| `docs/runtime/` | Runtime reference |
| `docs/sdk/` | SDK API guide |
| `docs/mods/` | Mod development |
| `docs/protocol/` | Platform Protocol spec |
| `docs/error-codes.md` | Error code dictionary |
| `dev/research/` | Research and investigation documents |
| `dev/report/` | Audit and assessment reports |
| `dev/plan/` | Iteration/refactor/implementation plans |

### Dev Document Routing (MUST)

- `dev/research/` MUST contain research documents only.
- `dev/report/` MUST contain audit/report documents only.
- `dev/plan/` MUST contain iteration, refactor, and implementation plan documents only.
- New development-process documents MUST be placed in one of the `dev/*` folders above (not repo root).

### SSOT vs Dev Boundary (MUST)

- `ssot/` MUST contain normative contracts only: scope, invariants, MUST/SHOULD rules, acceptance gates, and verification commands.
- `ssot/` MUST NOT contain execution-state content:
  - checked progress markers (for example `- [x] ...`)
  - dated status snapshots (for example "当前状态快照（YYYY-MM-DD）")
  - iteration completion ledgers (`计划完成日期/实际完成日期/阻塞原因/下轮承接`)
  - "this round passed/failed" conclusions tied to a specific run
- Execution-state evidence MUST be written in `dev/report/` (results/evidence) or `dev/plan/` (iteration planning).
- If a SSOT clause needs empirical proof, SSOT should define the required evidence format and point to `dev/report/*`, but MUST NOT embed dated pass/fail state itself.
- Any migration from SSOT execution-state content MUST preserve history by creating/refreshing a corresponding `dev/report/*` document first.
