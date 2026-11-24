# AGENTS.md

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

<!-- nimi-app:managed:start -->
## Nimi App development

- For auditing adaptation feasibility or cost, creating, adapting, upgrading or releasing this App, read [the lifecycle skill](.agents/skills/nimi-app-lifecycle/SKILL.md) and only the relevant scenario. Audit-only requests do not begin implementation; prior reports remain evidence-dependent.
- For first integration or foundation wiring changes, use the selected app-tools package's generated reference for the same carrier and reuse its renderer, session, App Access, AIConfig and AI call wiring; Host/preload apply only to native Desktop, while Web uses official scoped login and its admitted HTTPS source. Follow the adaptation guide's baseline checks and reuse passing results for ordinary business edits.
- Keep App-owned product behavior, Host code, business accounts and non-AI services with this repository. Use the SDK/Kit Local App carrier for Nimi AI, configuration, storage and session access.
- Development may consume complete local npm tarballs through the supported explicit overrides and version matrix; public-release preflight uses registry resolutions. Do not substitute source-workspace or directory links.
- App Tools owns its lifecycle skill, this block, managed workflow and declared engineering fields; preserve other instructions, product source and licenses. Existing adoption does not create fresh scaffold intent or lock.
- Maintain root NIMI_APP.md for the App’s actual users: purpose, first steps, configuration, data handling, limitations and help. Keep engineering instructions and acceptance logs in README/developer documentation. metadata.readme and README fallback are not supported; sync never overwrites or recreates this App-owned introduction.
- Product-operation guides apply to their specific business tasks; they do not replace the Nimi development boundary.
- Reuse the user's confirmed scope and authorization. Report command checks separately from actual App journeys; unrun relevant paths remain NOT-VERIFIED.
<!-- nimi-app:managed:end -->
