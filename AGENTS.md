# AGENTS.md

## Scope and decisions

- This file applies repo-wide. Before working in a subtree, read its `AGENTS.md` chain from this Git root, including intermediate ancestors. Reuse unchanged guidance already in context; do not enumerate unrelated subtrees or read guidance above this Git root.
- Explicit user instructions take precedence over this file. Reuse confirmed goals, topology, phase state, and authorization. Ask only about unresolved choices that materially change the result; continue independent authorized work.
- Complete the requested outcome within its authorized scope; audits and plans do not authorize implementation. Preserve unrelated work and report concrete adjacent defects without expanding the task to repair them.

## Product authority and implementation

- Product authority lives under `.nimi/spec/**`; Git holds retired authority history. App-local spec slices, implementation, generated projections, and local evidence must not create parallel product truth. Host governance and configuration live under `.nimi/**` and `config/**`; `.local/**` is non-authoritative.
- For redesigns changing product semantics or canonical ownership, resolve `Spec Status`, `Authority Owner`, `Work Type`, and `Parallel Truth` and align canonical authority, reusing confirmed decisions. Bounded fixes and alignment need no separate preflight artifact or renewed approval.
- Validate unknown inputs once at their owning trust boundary and fail closed on contract violations. Pass validated, typed values inward; do not repeat checks already guaranteed by a schema, constructor, or internal contract unless crossing a new trust boundary. Do not add legacy shims, pseudo-success, app-level REST bypasses, provider/model hardcoding, file collisions, or forwarding shells outside `index.ts`.
- Desktop and Web must not import `runtime/internal/**`. SDK must not cross Realm or Runtime private boundaries. Runtime must not import `sdks/**` or `apps/**`.
- Keep implementation direct. Extract helpers or add layers for current reuse, a complex boundary, or a clear concept that improves readability. New fallback, retry, compatibility, concurrency, or recovery machinery must address a concrete failure mode in a supported path or an explicit contract. Supported uncommon cases remain in scope; hypothetical future needs alone do not justify complexity.
- The external AI host owns workflow state; Nimi-coding must not own or mutate host task lifecycle. Use the relevant `package.json` guarded scripts for host workflows and the managed block below for project-local Nimi-coding execution.
- Product composition serves the current module's audience and task. Facts, behavior, ownership, safety, and release boundaries remain binding; wording, grouping, hierarchy, and interaction are product decisions. Advanced controls and developer documentation retain necessary precision.

## UI composition

- Use grouping, alignment, spacing, hierarchy, and proximity to make relationships and actions clear. Avoid redundant labels and descriptions across page, section, and item levels, including repeating a fact as both prose and status.
- Keep secondary text when it helps the user identify an object, distinguish actual states, or understand scope, prerequisites, permissions, costs, or consequences. Preserve meaningful control labels and accessible names. Keep essential warnings beside the relevant action; optional detail may use a clearly reachable disclosure, but necessary information must not depend on color or hover alone.
- Simplification must preserve the user's ability to find the next action and predict its result. Keep necessary choices, uncertainty, and distinctions such as configured, prepared, and actually running.

## Task-specific context

- Start at the requested target or observed consumer, its direct dependencies, and nearest guidance. Expand inspection only to resolve an uncertainty affecting the task; reuse sufficient existing evidence. A concrete dependency, trace, or contract can justify inspecting an upstream owner without a runtime failure.
- For third-party App feasibility, capability-fit or cost audits, adaptation, AI capability expansion, consume-chain repair or related acceptance in Nimi, read `.agents/skills/nimi-app-runtime-evolution/SKILL.md`. Select audit or implementation from the current request; prior audit recommendations do not become product authority. Ordinary App business edits use the App's lifecycle guidance.
- For shared UI primitive or contract changes, read `DESIGN.md` and `kit/DESIGN.md` as generated projections. App-local composition starts with its consumer and nearest guidance.
- For top-level Nimi/Home/App framing, public App lifecycle, or cross-domain canonical ownership, read `rule.nimi.platform.core-protocol.p-arch-001a` with its declared outgoing context and the affected exact domain owners. Public positioning or release promises also require the implicated `P-GOV-026` rules beginning with `rule.nimi.platform.governance-release.p-gov-026-positioning` and `rule.nimi.platform.governance-release.p-gov-026-owner-boundary`.
- For prompt or governance audits, search instruction filenames and inspect the relevant instructions and their direct loaders/checkers. Do not inspect `.nimi/spec/**` or product implementation merely because an instruction mentions them.
- For canonical authority edits, reviews, or authority-command failures, use `.agents/skills/nimi-authority-work/SKILL.md`; ordinary implementation that follows settled contracts does not require this workflow.
- For a list of lookup targets, provide the list without lookups or Git inspection. For implementation plans, read the bounded inputs needed to resolve decisions without executing changes. Read the direct package manifest before naming a runnable command.
- Skip `_external/**`, `.iterate/**`, `.cache/**`, `archive/**`, `docs/**`, generated code, lockfiles, large assets, and historical plans/evidence unless directly relevant to the task.

## Verification and findings

- For reported failures, attempt the supported path when feasible, repair the cause, and rerun it. Verify new behavior without requiring a pre-existing failure. Tasks involving launch or product interaction require the real supported journey; automation success alone does not establish acceptance.
- Select checks for a concrete risk or an applicable module requirement; broaden validation for changed cross-cutting contracts. Reuse passing results. Stop verification when the requested behavior, required checks, and identified risks are sufficiently covered; reopen it only for a new change, failure, or unresolved risk affecting the conclusion. Do not create extra evidence artifacts merely to restate established results.
- Add tests for important behavior or regression risks not already covered. Exercise the implementation without copying its logic or merely asserting its structure. Low-impact copy, styling, or mechanical edits do not automatically need new tests; applicable checks and acceptance still apply.
- Report actual incorrect behavior; a concrete supported path and failure mechanism can support a finding without reproduction. Say when inspected behavior is correct. Treat `unknown`, unread, and `not_observed` as unconfirmed, not automatic investigation tasks. Mark unrun product paths affecting the conclusion `NOT-VERIFIED` and explain the impact; missing prerequisites block only dependent work.
- For shared design projection changes, run `pnpm check:nimi-design-artifacts` unless an already-required check includes it. Do not run it for unrelated app composition. Authority edits follow the managed instructions below.

## Nimi App acceptance

- For real Nimi Home or App acceptance or renderer debugging, read `.agents/skills/nimi-app-acceptance/SKILL.md`. Prefer each product's exact loopback development CDP target for its web UI, including Home; launch Apps through Desktop-supervised Electron. Use Computer Use for native windows, system dialogs, and behavior CDP cannot cover. Direct Vite, another product's renderer, private-interface calls, or permission bypasses do not establish acceptance.

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
