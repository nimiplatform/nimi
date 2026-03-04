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
| **landing** | React 19 | `apps/landing/` | MIT |
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
- [`spec/AGENTS.md`](spec/AGENTS.md) — Runtime/SDK spec contracts, generation, and acceptance checks
- [`proto/AGENTS.md`](proto/AGENTS.md) — Protocol Buffers, Buf CLI, generation targets
- [`scripts/AGENTS.md`](scripts/AGENTS.md) — CI checks, codegen, build, and release scripts
- [`apps/desktop/AGENTS.md`](apps/desktop/AGENTS.md) — Tauri, React, nimi-hook
- [`apps/web/AGENTS.md`](apps/web/AGENTS.md) — Web shell, desktop renderer reuse
- [`apps/landing/AGENTS.md`](apps/landing/AGENTS.md) — Independent static landing site
- [`nimi-mods/AGENTS.md`](nimi-mods/AGENTS.md) — External mod repo workflow and build contract

## Instruction Precedence (MUST)

To avoid rule drift across tool-specific files, follow this precedence:

1. Root `AGENTS.md` (this file) for repo-wide boundaries and quality bars
2. Nearest path-scoped `*/AGENTS.md` for component-specific rules
3. `spec/AGENTS.md` for any change under `spec/**`

Compatibility files (`CLAUDE.md`, `.github/copilot-instructions.md`, `*/context.md`) are navigation shims only. They do not define independent rules. If any conflict appears, `AGENTS.md` files win.

## AI-Native Planning Rules

This project uses AI as primary executor. **Do NOT default to MVP/phased approaches.**

- **Ambiguity = risk, complexity with clear rules = trivial.** A well-specified 20-file change is easier than a vague 3-file "MVP"
- **No intermediate states** unless a hard external dependency blocks the final state
- **Prefer one complex PR over three simple PRs.** Each boundary introduces merge risk and state drift
- **Never "save cognitive load" for AI.** Don't simplify schemas, defer features, or add compatibility shims

## AI Context Retrieval Hygiene

- Default retrieval SHOULD skip generated/lock/asset noise (`**/generated/**`, `**/gen/**`, `spec/generated/**`, lockfiles, large binaries/images)
- If a task requires generated artifacts or lockfiles, agents MUST state the exception explicitly before reading them
- Prefer targeted search paths (`apps/**/src`, `runtime/internal`, `sdk/src`, `spec/*/kernel`) before repo-wide scans

## Code Organization for AI

- **No file/directory name collisions.** If `foo.ts` extracts to `foo/`, the file must move into that directory
- **No forwarding shells** outside `index.ts`. Inline the logic or use direct re-exports
- **Explicit type signatures** on facade methods. No `Parameters<Service['method']>[0]`
- **Maximum 3-hop debug trace.** From user-facing code to business logic: at most 3 files
- **`apps/_libs/`** is the shared library directory for cross-app code (used by both desktop and web). It is not an independent package — treat it as internal shared code within the `apps/` workspace

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

## Layered Debugging Responsibility (MUST)

- Debug ownership is layer-local:
  - Runtime defects are fixed and validated in `runtime/` first.
  - SDK defects are fixed in `sdk/` only after runtime gates are green.
  - Desktop/Mod defects are fixed in `apps/desktop/` and `nimi-mods/` only after runtime + sdk gates are green.
- CI gate order is hard: `runtime-quality` → `sdk-quality` → `desktop-web-quality` / `mods-quality`.
- Do not use downstream legacy shims, hardcoded provider/model lists, or bypass paths to hide upstream contract gaps.
- Live smoke enforcement is mandatory for nightly and release workflows:
  - Required providers with `failed` or `skipped` status block release.
  - PR workflows remain skip-safe and rely on deterministic gates.

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

## Live Test Matrix

Cross-component live smoke tests validate real API key connectivity for all cloud providers. Tests auto-skip when env vars are missing, so they never break default CI.

| Layer | Test file | Run command |
|-------|-----------|-------------|
| Runtime | `runtime/internal/services/ai/live_provider_smoke_test.go` | `cd runtime && go test ./internal/services/ai/ -run TestLiveSmoke -v` |
| SDK | `sdk/test/runtime/contract/providers/nimi-sdk-ai-provider-live-smoke.test.ts` | `NIMI_SDK_LIVE=1 npx tsx --test <file>` |

**Coverage report:** `node scripts/run-live-test-matrix.mjs` runs both layers and outputs a YAML matrix to `dev/report/live-test-coverage.yaml`.

**Env var template:** `dev/live-test.env.example` documents all required env vars per provider.

**Key invariant:** Adding a new cloud provider to `runtime/internal/services/ai/provider.go` → `cloudProviderEnvBindings` MUST be accompanied by:
1. A `TestLiveSmoke{Provider}GenerateText` in the runtime test file
2. A corresponding SDK live test if the provider is routable via `token-api`
3. An entry in `dev/live-test.env.example`

See [`runtime/AGENTS.md` § Live Smoke Tests](runtime/AGENTS.md) and [`sdk/AGENTS.md` § Live Smoke Tests](sdk/AGENTS.md) for per-layer conventions.

## Spec and Dev Routing (MUST)

- Normative contracts live in `spec/`. Treat `spec/` as the only normative source.
- Full spec editing/verification rules live in [`spec/AGENTS.md`](spec/AGENTS.md). Do not duplicate or fork those rules in tool-specific files.
- `spec/` must stay execution-state free (no progress checkboxes, dated pass/fail snapshots, or iteration ledgers).
- Put process evidence under `dev/report/` and plans under `dev/plan/`.

### Dev Document Routing (MUST)

- `dev/research/` MUST contain research documents only.
- `dev/report/` MUST contain audit/report documents only.
- `dev/plan/` MUST contain iteration, refactor, and implementation plan documents only.
- New development-process documents MUST be placed in one of the `dev/*` folders above (not repo root).

### Spec vs Dev Boundary (MUST)

- `spec/` MUST contain normative contracts only: scope, invariants, MUST/SHOULD rules, acceptance gates, and verification commands.
- `spec/` MUST NOT contain execution-state content:
  - checked progress markers (for example `- [x] ...`)
  - dated status snapshots (for example "当前状态快照（YYYY-MM-DD）")
  - iteration completion ledgers (`计划完成日期/实际完成日期/阻塞原因/下轮承接`)
  - "this round passed/failed" conclusions tied to a specific run
- Execution-state evidence MUST be written in `dev/report/` (results/evidence) or `dev/plan/` (iteration planning).
- If a spec clause needs empirical proof, spec should define the required evidence format and point to `dev/report/*`, but MUST NOT embed dated pass/fail state itself.
- Any migration from spec execution-state content MUST preserve history by creating/refreshing a corresponding `dev/report/*` document first.
