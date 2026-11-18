# AGENTS.md

## Scope and decisions

- This file applies repo-wide. Before working in a subtree, read its `AGENTS.md` chain from this Git root, including intermediate ancestors. Reuse unchanged guidance already in context; do not enumerate unrelated subtrees or read guidance above this Git root.
- Explicit user instructions take precedence over this file. Reuse confirmed goals, topology, phase state, and authorization. Ask only about unresolved choices that materially change the result; continue independent authorized work.
- Complete the requested outcome within its authorized scope; audits and plans do not authorize implementation. Preserve unrelated work and report concrete adjacent defects without expanding the task to repair them.

## Product authority and implementation

- Product authority lives under `.nimi/spec/**`; Git holds retired authority history. App-local spec slices, implementation, generated projections, and local evidence must not create parallel product truth. Host governance and configuration live under `.nimi/**` and `config/**`; `.local/**` is non-authoritative.
- When a redesign changes product semantics or canonical ownership, identify the current rule and its owner, reconcile competing definitions, and align canonical authority with the authorized change.
- Validate unknown inputs once at their owning trust boundary and fail closed on contract violations. Pass validated, typed values inward; do not repeat checks already guaranteed by a schema, constructor, or internal contract unless crossing a new trust boundary. Do not add legacy shims, pseudo-success, app-level REST bypasses, provider/model hardcoding, file collisions, or forwarding shells outside `index.ts`.
- Desktop and Web must not import `runtime/internal/**`. SDK must not cross Realm or Runtime private boundaries. Runtime must not import `sdks/**` or `apps/**`.
- Keep implementation direct. Extract helpers or add layers for current reuse, a complex boundary, or a clear concept that improves readability. New fallback, retry, compatibility, concurrency, or recovery machinery must address a concrete failure mode in a supported path or an explicit contract. Supported uncommon cases remain in scope; hypothetical future needs alone do not justify complexity.
- The external AI host owns workflow state; Nimi-coding must not own or mutate host task lifecycle. Use the relevant `package.json` guarded scripts for host workflows and the managed block below for project-local Nimi-coding execution.
- Every Nimi App owns a root `NIMI_APP.md` for its Home introduction: actual user tasks, first steps, required configuration, relevant data handling, limitations and help. Keep engineering setup and acceptance records in README/developer documentation. Follow `rule.nimi.platform.app-ecosystem.p-napp-042d`; `metadata.readme` and README fallback are not supported.

## UI composition

- The public website, Home, and each App own their copy, page structure, visual hierarchy, and interaction flow within existing product and Kit contracts. Start with the audience, the task, and what the next action actually does. Compose existing primitives for that experience, including layouts unique to one product.
- Group related controls and avoid repeating the same explanation across page, section, and item. Make the next action and its consequences clear. Preserve accessible names, distinctions such as configured, prepared, and running, and the precision advanced users need. Put prerequisites, costs, permissions, and essential warnings where they affect a choice. Essential information must be available without relying on color or hover alone.

## Task-specific context

- Start at the requested target or observed consumer and its nearest guidance. Follow a concrete dependency, trace, or contract to its owner when it affects the task. Reuse sufficient existing evidence.
- For third-party App feasibility, capability-fit or cost audits, adaptation, AI capability expansion, consume-chain repair or related acceptance in Nimi, read `.agents/skills/nimi-app-runtime-evolution/SKILL.md`. Select audit or implementation from the current request; prior audit recommendations do not become product authority. Ordinary App business edits use the App's lifecycle guidance.
- For changes to shared UI primitives, tokens, themes, or cross-App interaction contracts, consult the generated `DESIGN.md` and `kit/DESIGN.md` and work at the shared owner.
- When a task changes or raises a question about top-level Nimi/Home/App meaning, the public App lifecycle, or cross-domain ownership, read `rule.nimi.platform.core-protocol.p-arch-001a` with its declared outgoing context and the affected domain owners. For public positioning or release claims that change or need verification, also consult the implicated `P-GOV-026` rules beginning with `rule.nimi.platform.governance-release.p-gov-026-positioning` and `rule.nimi.platform.governance-release.p-gov-026-owner-boundary`.
- For prompt or governance audits, search instruction filenames and inspect the relevant instructions and their direct loaders/checkers. Do not inspect `.nimi/spec/**` or product implementation merely because an instruction mentions them.
- For canonical authority edits, reviews, or authority-command failures, use `.agents/skills/nimi-authority-work/SKILL.md`; ordinary implementation that follows settled contracts does not require this workflow.
- Answer conceptual lookup lists directly. Verify concrete paths and commands against their direct sources, including the declaring package manifest for scripts. For implementation plans, inspect the inputs needed to resolve decisions and deliver the plan.
- Skip `_external/**`, `.iterate/**`, `.cache/**`, `archive/**`, `docs/**`, generated code, lockfiles, large assets, and historical plans/evidence unless directly relevant to the task.

## Verification and findings

- For a reported failure, exercise the supported path when feasible. In diagnosis or audit work, report the cause the evidence supports and its impact. When a fix is authorized, repair the cause and rerun the affected journey. Exercise newly implemented behavior directly.
- Review a requested design or prototype against the user's task at its intended size. For an implemented visual change, inspect the affected surface in its supported entry. For an interaction change, use that entry to perform the action and observe its result.
- Select checks for a concrete risk or an applicable module requirement; broaden validation for changed cross-cutting contracts. Reuse passing results. Stop verification when the requested behavior, required checks, and identified risks are sufficiently covered; reopen it only for a new change, failure, or unresolved risk affecting the conclusion. Do not create extra evidence artifacts merely to restate established results.
- Add tests for important behavior or regression risks not already covered. Exercise the implementation without copying its logic or merely asserting its structure. Low-impact copy, styling, or mechanical edits do not automatically need new tests; applicable checks and acceptance still apply.
- Report actual incorrect behavior; a concrete supported path and failure mechanism can support a finding without reproduction. Say when inspected behavior is correct. Treat `unknown`, unread, and `not_observed` as unconfirmed, not automatic investigation tasks. Mark unrun product paths affecting the conclusion `NOT-VERIFIED` and explain the impact; missing prerequisites block only dependent work.
- For shared design projection changes, run `pnpm check:nimi-design-artifacts` unless an already-required check includes it. Do not run it for unrelated app composition. Authority edits follow the managed instructions below.
- For Home or App launch, interaction acceptance, or renderer debugging, follow `.agents/skills/nimi-app-acceptance/SKILL.md` for the supported entry, matching renderer, and permissions of the product under test.

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
