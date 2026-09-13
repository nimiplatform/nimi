# AGENTS.md

## Scope and decisions

- This file applies repo-wide. Before working in a target subtree, read the applicable `AGENTS.md` chain from this Git root to that target, including intermediate ancestors. Reuse guidance already in context unless it changes; do not enumerate unrelated subtrees or read parent-directory guidance above this Git root.
- Explicit user instructions take precedence over this file. Reuse confirmed goals, topology, phase state, and authorization. Ask only about unresolved choices that materially change the result; continue independent authorized work.
- Complete the requested outcome within its authorized scope. Preserve unrelated work. Report concrete adjacent defects without silently expanding the task to repair them.

## Product authority and ownership

- Product authority lives under `.nimi/spec/**`; Git holds retired authority history. App-local spec slices, implementation, generated projections, and local evidence must not create parallel product truth. Host governance and configuration live under `.nimi/**` and `config/**`; `.local/**` is non-authoritative.
- Before redesign that changes product semantics or canonical ownership, resolve `Spec Status`, `Authority Owner`, `Work Type`, and `Parallel Truth`, reusing confirmed decisions, and align canonical authority. Bounded fixes and alignment do not require a separate preflight artifact or renewed approval.
- Fail closed on contract violations. Do not add legacy shims, pseudo-success, app-level REST bypasses, provider/model hardcoding, file collisions, or forwarding shells outside `index.ts`.
- Desktop and Web must not import `runtime/internal/**`. SDK must not cross Realm or Runtime private boundaries. Runtime must not import `sdks/**` or `apps/**`.
- The external AI host owns workflow state; Nimi-coding must not own or mutate host task lifecycle. Use the guarded scripts in the relevant `package.json` for host workflows. The managed block below defines project-local Nimi-coding execution.
- Product composition serves the current module's audience and task. Facts, behavior, ownership, safety, and release boundaries remain binding; wording, grouping, hierarchy, and interaction are product decisions. Advanced controls and developer documentation retain necessary precision.

## Task-specific context

- Start at the requested target or observed consumer, its direct dependencies, and its nearest guidance. Inspect upstream owners when a concrete task question, dependency, trace, or contract requires them; do not require a runtime failure before investigating a directly implicated owner.
- For shared UI primitive or contract changes, read `DESIGN.md` and `kit/DESIGN.md` as generated projections. App-local composition starts with its consumer and nearest guidance.
- For top-level Nimi/Home/App framing, public App lifecycle, or cross-domain canonical ownership, read `rule.nimi.platform.core-protocol.p-arch-001a` with its declared outgoing context and the affected exact domain owners. Public positioning or release promises also require the implicated `P-GOV-026` rules beginning with `rule.nimi.platform.governance-release.p-gov-026-positioning` and `rule.nimi.platform.governance-release.p-gov-026-owner-boundary`.
- For prompt or governance audits, search instruction filenames and inspect the relevant instructions and their direct loaders/checkers. Do not inspect `.nimi/spec/**` or product implementation merely because an instruction mentions them.
- For canonical authority edits, reviews, or authority-command failures, use `.agents/skills/nimi-authority-work/SKILL.md`; ordinary implementation that follows settled contracts does not require this workflow.
- When the requested output is only a list of lookup targets, provide the list without performing the lookups or inspecting Git state. For an actual implementation plan, read the bounded inputs needed to resolve its decisions; do not execute the planned changes. Read the direct package manifest before naming a runnable command.
- Skip `_external/**`, `.iterate/**`, `.cache/**`, `archive/**`, `docs/**`, generated code, lockfiles, large assets, and historical plans/evidence unless directly relevant to the task.

## Verification and findings

- For a reported failure, attempt the affected supported path when feasible, repair its cause, and rerun that path. For new work, verify the requested behavior without requiring a pre-existing failure. When the task includes launch or product interaction, run the real supported journey and address failures within scope.
- Select checks for a specific plausible failure or an applicable module requirement. Reuse passing results until a new change, failure, or concrete unresolved risk invalidates them. Complete required module checks; broader validation follows changed cross-cutting contracts.
- Supported uncommon cases remain in scope. Match threat assumptions and evidence strength to the actual task and interfaces; do not add speculative compatibility paths, corner-case machinery, or redundant evidence systems.
- Report actual incorrect behavior; a review finding may rely on a concrete supported path and failure mechanism without a reproduction. Say when inspected behavior is correct.
- `unknown`, unread, and `not_observed` mean unconfirmed. Missing prerequisites block only dependent work. Mark relevant product paths not actually run as `NOT-VERIFIED`; automation success alone does not establish product acceptance.
- For shared design projection changes, run `pnpm check:nimi-design-artifacts` unless an already-required check includes it. Do not run it for unrelated app composition. Authority edits follow the managed instructions below.

## Nimi App acceptance

- For real Nimi App acceptance or renderer debugging, read `.agents/skills/nimi-app-acceptance/SKILL.md`. Use Desktop-supervised Electron and that App's exact loopback development CDP target; direct Vite or another App's renderer is not acceptance. Native and owner UI remain outside CDP.

<!-- nimicoding:managed:agents:start -->
# Nimi Coding Managed Block

- From the repository root, invoke the pinned project-local CLI as `pnpm exec nimicoding`; do not probe or rely on a global `nimicoding` binary in `PATH`.
- Product authority lives under `.nimi/spec/**`.
- Choose authority and code queries when their declared scope can resolve an uncertainty that affects the current task; reuse sufficient current evidence. Query scope is not the limit of host reasoning or authorized work, and hypotheses are not product authority.
- For canonical authority authoring, read only `.nimi/methodology/authority-authoring.yaml`, the affected authority files or bounded task context, and CLI diagnostics.
- Use `pnpm exec nimicoding authority context <path> <id> --max-units <n> --max-bytes <n> --json` only for the complete declared outgoing interpretation closure; it is not complete task context, and failure never permits guessed or partial context.
- Use `pnpm exec nimicoding authority diff` and `pnpm exec nimicoding authority impact` with explicit `--max-bytes`; impact reports declared review obligations and does not prove implementation, consumers, or tests are synchronized.
- Use `pnpm exec nimicoding authority change-candidates` only with explicit channels and budgets; its complete union is recall input, never conflict, retirement, absence, authority, or conformance judgment.
- When explicit authority links are needed, use `pnpm exec nimicoding code authority --repo <root> --authority <id> --max-files <n> --max-bytes <n>` to locate annotated code, and use `--source <path>` for code-to-authority lookup. Results cover only explicit markers and authority lifecycle; they do not prove implementation conformance or evaluate unannotated code.
- For a new or changed authority-governed feature, add the reserved standalone physical line `// @nimi-authority: <exact-id>` in TypeScript/TSX, Go, or Rust, and `# @nimi-authority: <exact-id>` in Python. The scanner does not prove language comment context, so use this reserved form only for intentional links at a few key semantic owners.
- Use `// @nimi-deprecated: <exact-id>`, or `# @nimi-deprecated: <exact-id>` in Python, only after direct authority evidence or a real product failure confirms obsolete semantics; find it with `pnpm exec nimicoding code authority --repo <root> --audit --max-files <n> --max-bytes <n>` and remove it with the hard cut.
- When a selected TypeScript or TSX consumer still has a static-dependency question, use `pnpm exec nimicoding code context <path> --repo <root> --symbol <identifier> --tsconfig <path> --max-bytes <n>` for bounded root-direct static dependencies; it is not inbound impact, runtime dispatch, or complete task context.
- Use `pnpm exec nimicoding sync --check` to diagnose drift in package-owned managed projections, `pnpm exec nimicoding sync --apply` to restore them, and `pnpm exec nimicoding doctor` to diagnose package/managed compatibility. These commands do not validate product authority, implementation conformance, or task readiness.
- Under `.nimi/spec/**`, author only closed multi-unit `*.authority.yaml` containers or single-unit `*.authority.md`; historical document formats are unsupported and never inferred.
- Run `pnpm exec nimicoding authority fmt` on each changed file, then `pnpm exec nimicoding authority check` on the complete authority input set.
- A failed project-local `pnpm exec nimicoding ...` invocation supplies no usable result. Pause decisions that require refused, missing, or incomplete results; continue independent authorized work. Never substitute guessed, corpus-wide, or fallback context, or treat diagnostics or partial output as complete context; choose repair values only from product/task authority.
- Keep derived and local verification output under `.nimi/local/**`; it is never product authority.
<!-- nimicoding:managed:agents:end -->
