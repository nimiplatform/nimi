# AGENTS.md

- Think before acting. Read before editing. Prefer bounded edits over rewrites. Be concise. Test the affected behavior. User instructions override this file.

## Scope and Precedence

- This file applies repo-wide. The descendant `AGENTS.md` chain from this Git root to the target path may add or narrow rules. Do not discover or read parent-directory `AGENTS.md` files above this Git root.
- Treat explicit user direction, topology, phase state, and closed decisions as execution inputs. Change them only when the real product path or direct authority evidence contradicts them.
- Scope and proportionality rules constrain what is proposed and changed. They do not excuse an actual defect encountered during scoped work, and they do not authorize repo-wide discovery or audit.
- When user intent has a branch that would materially change the result, request the choice. Otherwise state the smallest necessary assumption and proceed.

## Product Authority and Hard Boundaries

- Product authority lives under `.nimi/spec/**`; Git holds retired authority history. App-local spec slices must not create parallel truth. Host governance and configuration live under `.nimi/**` and `config/**`; `.local/**` is non-authoritative compatibility or evidence space.
- Use a formal `Spec Status` / `Authority Owner` / `Work Type` / `Parallel Truth` preflight only for redesign that changes product semantics or canonical ownership. Align `.nimi/spec/**` before such redesign. Alignment and bounded fixes follow existing authority without a preflight artifact.
- Before changing a shared Nimi UI primitive or contract, read `DESIGN.md` and `kit/DESIGN.md`; they are generated projections, not authority. App-local composition starts with its consumer and nearest guidance.
- Fail closed on contract violations. Do not add legacy shims, pseudo-success, app-level REST bypasses, provider or model hardcoding, file collisions, or forwarding shells outside `index.ts`.
- Desktop and Web must not import `runtime/internal/**`. SDK must not cross Realm or Runtime private boundaries. Runtime must not import `sdks/**` or `apps/**`.
- The external AI host owns workflow state. Use guarded package scripts in `package.json` for host workflows. Invoke Nimi-coding operations from this repository root through the pinned project-local `pnpm exec nimicoding ...`, including where an installed managed block shows bare `nimicoding ...`. Never probe or rely on a global `nimicoding` in `PATH`. Nimi-coding must not own or mutate host task lifecycle.
- For Image2 or provider work under `nimi2d/**`, read `nimi2d/AGENTS.md`.

## Execution

- For an authorized implementation or product-gate task, attempt the real affected build, launch, or journey first.
- Start debugging at the observed consumer. Inspect SDK or Runtime only when a trace, import boundary, or contract failure points upstream.
- Proceed as: real target attempt → first actual failure → smallest causal repair → rerun the same target → necessary evidence.
- `unknown`, unread, and `not_observed` mean unconfirmed; they are not evidence that behavior is invalid. A blocker must come from a real failing path or a located prerequisite that is actually missing.
- Later gates, historical mappings, global counts, and unrelated validation cannot block the current target unless they are direct prerequisites.
- Read historical plans, checkpoints, or evidence only when the current failure points there. Inspect only affected paths and preserve unrelated work.
- Do not delete or redesign working behavior based only on convention, effort, or sunk cost. Require a real product failure or direct authority evidence.

## Findings and Proportionality

- Report behavior that is actually wrong, including uncommon cases reachable through supported inputs, published interfaces, documented examples, or real project data.
- A reproduction is not mandatory for a review finding when the supported path and failure mechanism are concrete. Constructibility in principle is not enough.
- Unless the task, product authority, or deployed interface establishes an adversarial threat model, assume a cooperating operator on their own machine. Do not introduce security machinery for an unsupported threat model.
- Do not add hashes, checksums, or fingerprints as defensive evidence. Add them only when explicitly required by the task, authority, or security boundary, or when they replace a materially more expensive operation and their result changes subsequent behavior.
- Do not add speculative feature flags, migration frameworks, compatibility layers, wrappers, guards, or dual paths for cases the project does not produce. Current, supported transitions remain in scope when authority requires them.
- Do not pursue exotic encodings, symlink races, RTL text, sub-second timing races, or similar corner cases unless they are reachable through supported project use.
- Apply engineering judgment directly. Do not replace it with scoring tables, generic checklists, or repeated verification of an already settled result.
- Say plainly when inspected behavior is correct. Do not manufacture findings.

## Retrieval Defaults

- Start with the changed consumer, its nearest `AGENTS.md`, direct dependencies, and exact authority IDs implicated by the task or first failure.
- When a task changes or reviews top-level Nimi/Home/App product or layer framing, public App lifecycle, or cross-domain canonical ownership, first read `rule.nimi.platform.core-protocol.p-arch-001a` with its declared outgoing context and then the affected exact domain owners. For public positioning or release-promise work, also read the exact implicated `P-GOV-026` rules beginning with `rule.nimi.platform.governance-release.p-gov-026-positioning` and `rule.nimi.platform.governance-release.p-gov-026-owner-boundary`. Local fixes remain consumer-first.
- For prompt or governance audits, search instruction filenames rather than repository content. Inspect only the instruction files and exact loader or checker configuration named by the task. Never search `.nimi/spec/**` or product implementation merely because an instruction mentions them.
- For planning-only tasks or requests to list bounded lookup targets, the list is the output, not an execution checklist. Read the applicable descendant `AGENTS.md` chain inside this Git worktree and any explicitly named files; these are the only product reads allowed. When naming a runnable or validation command, also read its direct package manifest. Targeted discovery of that chain is allowed; do not enumerate other product files, inspect Git state, or perform the proposed lookups.
- Skip `_external/**`, `.iterate/**`, `.cache/**`, `archive/**`, `docs/**`, generated code, lockfiles, and large assets unless directly required.

## Verification

- Run a check only when it can detect a specific plausible failure and its result would change the next action.
- Run the nearest affected test, build, or real journey first. After a repair, rerun the same failing target before adding broader validation.
- Add broader guards only for changed cross-cutting contracts. Stop when evidence proportionate to the change is sufficient.
- Do not create extra environments, harnesses, Gates, checkpoints, evidence systems, receipts, ledgers, manifests, schemas, or repeated reviews solely to automate or prove acceptance.
- Automation success does not replace product acceptance. Product paths not actually run must be described as `NOT-VERIFIED`, not treated as blockers.
- For authority edits, use the managed commands below.
- For shared projection changes, run `pnpm check:nimi-design-artifacts`; do not run it for unrelated UI composition.

## Nimi App CDP

- For real Nimi App acceptance or renderer debugging, use the guarded package script with Desktop-supervised Electron. Generic `nimi-app dev` selects an ephemeral loopback CDP port and prints it; use `pnpm --filter <app-package> dev -- --cdp-port <free-port>` when the acceptance tool requires a stable port. Attach to that App's exact target; do not open its Vite renderer directly or attach to Desktop or another App. Native and owner UI remain outside CDP.
- Stay code-first: read the affected consumer and direct contract, use CDP only to reproduce or observe the first real failure, repair the smallest causal mechanism, then rerun the same journey. CDP success does not replace code review or affected tests.
- Keep CDP loopback-only, development-only, and ephemeral. The canonical root `pnpm dev:desktop`, `dev:zhiyu`, `dev:lab`, and `dev:avatar` launchers own deterministic default ports; generic `nimi-app dev` owns automatic port selection and may read the exact `NIMI_APP_DEV_CDP_PORT` override from the project `.env`. Use `--cdp-port <free-port>` to override either path and `--no-cdp` to disable it. Do not add other default CDP configuration, automation harnesses, Playwright projects, helper endpoints, recordings, fixtures, baselines, evidence systems, ledgers, or manifests.

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
