# AGENTS.md
- Think before acting. Read before editing. Prefer edits over rewrites. Be concise. Test the affected behavior. User instructions override this file.
## Scope
- Applies repo-wide; the descendant `AGENTS.md` chain from this Git root to the target path adds or narrows rules. Do not discover or read parent-directory `AGENTS.md` files above this Git root.
## Hard Boundaries
- Product authority lives under `.nimi/spec/**`; Git holds retired authority history. App-local spec slices must not create parallel truth. Host governance/configuration lives under `.nimi/**` and `config/**`; `.local/**` is non-authoritative compatibility/evidence space.
- Use a formal `Spec Status` / `Authority Owner` / `Work Type` / `Parallel Truth` preflight only for redesign that changes product semantics or canonical ownership; align `.nimi/spec/**` before such redesign. Alignment and bounded fixes follow existing authority without a preflight artifact.
- Start debugging at the observed consumer. Inspect SDK or Runtime only when a trace, import boundary, or contract failure points upstream.
- Before changing a shared Nimi UI primitive or contract, read `DESIGN.md` and `kit/DESIGN.md`; they are generated projections, not authority. App-local composition starts with its consumer and nearest guidance.
- Fail closed on contract violations. No legacy shims, pseudo-success, app-level REST bypass, provider/model hardcoding, file collisions, or forwarding shells outside `index.ts`.
- Desktop/Web must not import `runtime/internal/**`; SDK must not cross Realm/Runtime private boundaries; Runtime must not import `sdks/**` or `apps/**`.
- The external AI host owns workflow state. Use guarded package scripts in `package.json` for host workflows. Invoke Nimi-coding operations from this repository root through the pinned project-local `pnpm exec nimicoding ...`, including where the installed managed block shows bare `nimicoding ...`; never probe or rely on a global `nimicoding` in `PATH`. Nimi-coding must not own or mutate host task lifecycle.
- For Image2/provider work under `nimi2d/**`, read `nimi2d/AGENTS.md`.
## Execution Priority
- Treat explicit user direction and completed phase decisions as fixed unless the real path or direct authority contradicts them.
- For an authorized implementation or product-gate task, attempt the real affected build, launch, or journey first. `not_observed` is not invalid; stop on the first actual failure, repair its smallest causal mechanism, and rerun the same target.
- Later gates, historical mappings, and unrelated validation cannot block the current target unless they are direct prerequisites.
- Read historical plans or evidence only when the current failure points there; inspect only affected paths and preserve unrelated work.
## Nimi App CDP
- For real Nimi App acceptance or renderer debugging, use the guarded package script with Desktop-supervised Electron and explicit loopback CDP: `pnpm --filter <app-package> dev -- --cdp-port <free-port>`. Attach to that App's exact target; do not open its Vite renderer directly or attach to Desktop or another App. Native and owner UI remain outside CDP.
- Stay code-first: read the affected consumer and direct contract, use CDP only to reproduce or observe the first real failure, repair the smallest causal mechanism, then rerun the same journey. CDP success does not replace code review or affected tests.
- Keep CDP ephemeral. Do not add or commit automation harnesses, Playwright projects, helper endpoints, recordings, fixtures, baselines, evidence systems, ledgers, manifests, or default CDP configuration.
## Retrieval Defaults
- Start with the changed consumer, its nearest `AGENTS.md`, direct dependencies, and exact authority IDs implicated by the task or first failure.
- When a task changes or reviews top-level Nimi/Home/App product or layer framing, public App lifecycle, or cross-domain canonical ownership, first read `rule.nimi.platform.core-protocol.p-arch-001a` with its declared outgoing context and then the affected exact domain owners; for public positioning or release-promise work, also read the exact implicated `P-GOV-026` rules beginning with `rule.nimi.platform.governance-release.p-gov-026-positioning` and `rule.nimi.platform.governance-release.p-gov-026-owner-boundary`. Local fixes remain consumer-first.
- For prompt or governance audits, search instruction filenames rather than repository content; inspect only the instruction files and exact loader/checker configuration named by the task. Never search `.nimi/spec/**` or product implementation merely because an instruction mentions them.
- For planning-only tasks or requests to list bounded lookup targets, the list is the output, not an execution checklist. Read the applicable descendant `AGENTS.md` chain inside this Git worktree and any explicitly named files; these are the only product reads allowed. When naming a runnable or validation command, also read its direct package manifest. Targeted discovery of that chain is allowed; do not enumerate other product files, inspect Git state, or perform the proposed lookups.
- Skip `_external/**`, `.iterate/**`, `.cache/**`, `archive/**`, `docs/**`, generated code, lockfiles, and large assets unless directly required.
## Verification Commands
- Run the nearest affected test/build or real journey first, then rerun the same failing target. Add broader guards only for changed cross-cutting contracts.
- For authority edits, use the managed commands below. For shared projection changes, run `pnpm check:nimi-design-artifacts`; do not run it for unrelated UI composition.
<!-- nimicoding:managed:agents:start -->
# Nimi Coding Managed Block

- From the repository root, invoke the pinned project-local CLI as `pnpm exec nimicoding`; do not probe or rely on a global `nimicoding` binary in `PATH`.
- Product authority lives under `.nimi/spec/**`.
- For canonical authority authoring, read only `.nimi/methodology/authority-authoring.yaml`, the affected authority files or bounded task context, and CLI diagnostics.
- Use `pnpm exec nimicoding authority context <path> <id> --max-units <n> --max-bytes <n> --json` only for the complete declared outgoing interpretation closure; it is not complete task context, and failure never permits guessed or partial context.
- Use `pnpm exec nimicoding authority diff` and `pnpm exec nimicoding authority impact` with explicit `--max-bytes`; impact reports declared review obligations and does not prove implementation, consumers, or tests are synchronized.
- Use `pnpm exec nimicoding authority change-candidates` only with explicit channels and budgets; its complete union is recall input, never conflict, retirement, absence, authority, or conformance judgment.
- For implementation audits with an exact authority ID, use `pnpm exec nimicoding code authority --repo <root> --authority <id> --max-files <n> --max-bytes <n>` to locate annotated code, and use `--source <path>` for code-to-authority lookup. Results cover only explicit markers and authority lifecycle; they do not prove implementation conformance or evaluate unannotated code.
- For a new or changed authority-governed feature, add `// nimi-authority: <exact-id>` only at the small number of key semantic owner files or declarations. Multiple markers are allowed; do not blanket-annotate mechanical helpers or tests.
- Use `// nimi-deprecated: <exact-id>` only after direct authority evidence or a real product failure confirms obsolete semantics; find it with `pnpm exec nimicoding code authority --repo <root> --audit --max-files <n> --max-bytes <n>` and remove the marker with the hard cut.
- After selecting an explicit TypeScript or TSX consumer, use `pnpm exec nimicoding code context <path> --repo <root> --symbol <identifier> --tsconfig <path> --max-bytes <n>` for bounded root-direct static dependencies; it is not inbound impact, runtime dispatch, or complete task context.
- Use `pnpm exec nimicoding sync --check` to diagnose drift in package-owned managed projections, `pnpm exec nimicoding sync --apply` to restore them, and `pnpm exec nimicoding doctor` to diagnose package/managed compatibility. These commands do not validate product authority, implementation conformance, or task readiness.
- Under `.nimi/spec/**`, author only closed multi-unit `*.authority.yaml` containers or single-unit `*.authority.md`; historical document formats are unsupported and never inferred.
- Run `pnpm exec nimicoding authority fmt` on each changed file, then `pnpm exec nimicoding authority check` on the complete authority input set.
- A failed project-local `pnpm exec nimicoding ...` invocation blocks only the requested CLI product and never permits guessed, partial, corpus-wide, or fallback context; choose repair values only from product/task authority.
- Keep derived and local verification output under `.nimi/local/**`; it is never product authority.
<!-- nimicoding:managed:agents:end -->
