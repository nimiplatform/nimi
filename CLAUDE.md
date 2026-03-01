# CLAUDE.md

> Claude Code specific instructions for the Nimi open-source monorepo.

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
- [`spec/AGENTS.md`](spec/AGENTS.md) — Runtime/SDK spec contracts, generation, and acceptance checks
- [`apps/desktop/AGENTS.md`](apps/desktop/AGENTS.md) — Tauri, React, nimi-hook
- [`nimi-mods/AGENTS.md`](nimi-mods/AGENTS.md) — External mod repo workflow and build contract

## Inherited Rules

Root CLAUDE.md 中的 AI-Native Planning Rules、Code Organization for AI、Git Safety 在本仓库同样适用。

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
| `spec/` | Runtime/SDK design spec (kernel + domain) |
| `dev/research/` | Research and investigation documents |
| `dev/report/` | Audit and assessment reports |
| `dev/plan/` | Iteration/refactor/implementation plans |

评估/审计/可行性分析同样从 `spec/INDEX.md` 的最短阅读路径开始。

### Spec Editing Rules (MUST)

完整的 spec 编辑规则、CI 守护策略、LLM 审计约束见 [`spec/AGENTS.md`](spec/AGENTS.md)。以下是最核心的 MUST 规则：

- 结构化事实 MUST 先编辑 `spec/**/kernel/tables/*.yaml`，再对齐 kernel/domain 引用。
- `spec/**/kernel/generated/*.md` 是生成产物，不得手动编辑。
- `spec/` MUST 仅含规范性契约，不得含执行状态（进度标记、日期快照、迭代台账）。
- 开发过程文档 MUST 放入 `dev/research/`（调研）、`dev/report/`（报告）、`dev/plan/`（计划），不得放仓库根目录。
- 改完 spec 后 MUST 运行对应域的验证命令（见 `spec/AGENTS.md` § Mandatory Verification Commands）。
