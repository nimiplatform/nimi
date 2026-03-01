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
- [`spec/AGENTS.md`](spec/AGENTS.md) — Runtime/SDK spec contracts, generation, and acceptance checks
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
| `spec/` | Runtime/SDK design spec (kernel + domain) |
| `dev/research/` | Research and investigation documents |
| `dev/report/` | Audit and assessment reports |
| `dev/plan/` | Iteration/refactor/implementation plans |

### Spec Execution Contract (MUST)

- `spec/runtime/kernel/*` is the only home for cross-domain runtime rules.
- `spec/runtime/*.md` (domain docs) MUST only contain domain-specific increments and references to kernel Rule IDs (`K-*-NNN`), not duplicated kernel prose.
- Structured runtime facts MUST be edited in `spec/runtime/kernel/tables/*.yaml` (not hand-maintained in multiple markdown files).
- `spec/runtime/kernel/generated/*.md` are generated artifacts; never edit them manually.
- When changing RPC/reason code/provider/state machine behavior, update the corresponding YAML table first, then update kernel/domain references in the same change.
- Runtime spec verification commands are mandatory after edits:
  - `pnpm generate:runtime-spec-kernel-docs`
  - `pnpm check:runtime-spec-kernel-docs-drift`
  - `pnpm check:runtime-spec-kernel-consistency`
- Legacy naming/contracts are forbidden in runtime spec (including `docs/runtime/design-*` refs and token-provider legacy RPC names).
- If a task explicitly excludes `spec/sdk`, do not modify `spec/sdk/**`.
- If `ssot/` and `spec/` are temporarily inconsistent, do not silently force one to match the other outside task scope; record sync work under `dev/plan/` or `dev/report/`.

### Spec Consistency: CI-First Principle (MUST)

Spec 一致性守护分两层，**CI 是主守护层，LLM 审计仅做补充**：

**Layer 1 — CI 自动化（确定性守护，每次 PR 必过）：**

CI 负责所有可机器化验证的规则。当前 4 个域的检查脚本：

| 域 | 一致性脚本 | 生成漂移脚本 |
|---|---|---|
| Runtime | `check:runtime-spec-kernel-consistency` | `check:runtime-spec-kernel-docs-drift` |
| SDK | `check:sdk-spec-kernel-consistency` | `check:sdk-spec-kernel-docs-drift` |
| Desktop | `check:desktop-spec-kernel-consistency` | `check:desktop-spec-kernel-docs-drift` |
| Future | `check:future-spec-kernel-consistency` | `check:future-spec-kernel-docs-drift` |

CI 覆盖的规则类型：规则 ID 引用完整性、YAML ↔ 生成文档漂移、枚举值一致性、命名格式校验、跨表引用对齐、源码 ↔ spec 对齐（Desktop 域）。

**Layer 2 — LLM 审计（语义补充，低频执行）：**

LLM 审计仅用于 CI 无法覆盖的语义层面：

- 设计合理性（如「4xx 一律视为 healthy 是否正确」）
- 规格完整性（如「脱敏说了'例如'但没给完整枚举」）
- 工程常识（如「固定 backoff 无 jitter 的 thundering herd 风险」）
- 跨域语义冲突（如「错误模型与流式契约的终帧语义是否互补」）

**执行纪律：**

- 新增 spec 规则时，**先评估能否加入一致性脚本**。能自动化的规则必须加脚本，不允许仅靠 LLM 审计兜底。
- 发现 spec 缺陷时，**先检查是否属于 CI 应覆盖但遗漏的规则类型**。如果是，修复缺陷的同时必须补充脚本规则。
- LLM 审计发现的确定性规则违反（如缺失交叉引用、YAML 缺条目），修复后必须在对应脚本中新增检查，防止回归。
- **禁止用 LLM 全量审计替代 CI 检查**。LLM 审计不可复现、有遗漏、依赖上下文窗口，不适合作为主守护层。

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
