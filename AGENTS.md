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
- The external AI host owns workflow state. Use only guarded package scripts in `package.json`; Nimi-coding must not own or mutate host task lifecycle.
- For Image2/provider work under `nimi2d/**`, read `nimi2d/AGENTS.md`.
## Execution Priority
- Treat explicit user direction and completed phase decisions as fixed unless the real path or direct authority contradicts them.
- For an authorized implementation or product-gate task, attempt the real affected build, launch, or journey first. `not_observed` is not invalid; stop on the first actual failure, repair its smallest causal mechanism, and rerun the same target.
- Later gates, historical mappings, and unrelated validation cannot block the current target unless they are direct prerequisites.
- Read historical plans or evidence only when the current failure points there; inspect only affected paths and preserve unrelated work.
## Retrieval Defaults
- Start with the changed consumer, its nearest `AGENTS.md`, direct dependencies, and exact authority IDs implicated by the task or first failure.
- For prompt or governance audits, search instruction filenames rather than repository content; inspect only the instruction files and exact loader/checker configuration named by the task. Never search `.nimi/spec/**` or product implementation merely because an instruction mentions them.
- For planning-only tasks or requests to list bounded lookup targets, the list is the output, not an execution checklist. Read the applicable descendant `AGENTS.md` chain inside this Git worktree and any explicitly named files; these are the only product reads allowed. When naming a runnable or validation command, also read its direct package manifest. Targeted discovery of that chain is allowed; do not enumerate other product files, inspect Git state, or perform the proposed lookups.
- Skip `_external/**`, `.iterate/**`, `.cache/**`, `archive/**`, `docs/**`, generated code, lockfiles, and large assets unless directly required.
## Verification Commands
- Run the nearest affected test/build or real journey first, then rerun the same failing target. Add broader guards only for changed cross-cutting contracts.
- For authority edits, use the managed commands below. For shared projection changes, run `pnpm check:nimi-design-artifacts`; do not run it for unrelated UI composition.
<!-- nimicoding:managed:agents:start -->
# Nimi Coding Managed Block

- Product authority lives under `.nimi/spec/**`.
- For canonical authority authoring, read only `.nimi/methodology/authority-authoring.yaml`, the affected authority files or bounded task context, and CLI diagnostics.
- Use `nimicoding authority context <path> <id> --max-units <n> --max-bytes <n> --json` only for the complete declared outgoing interpretation closure; it is not complete task context, and failure never permits guessed or partial context.
- Use `nimicoding authority diff` and `authority impact` with explicit `--max-bytes`; impact reports declared review obligations and does not prove implementation, consumers, or tests are synchronized.
- Under `.nimi/spec/**`, author only closed multi-unit `*.authority.yaml` containers or single-unit `*.authority.md`; historical document formats are unsupported and never inferred.
- Run `nimicoding authority fmt` on each changed file, then `nimicoding authority check` on the complete authority input set.
- Never bypass a failure with inferred or fallback semantics; choose repair values only from product/task authority.
- Keep derived and verification evidence under `.nimi/local/**`; it is never product authority.
<!-- nimicoding:managed:agents:end -->
