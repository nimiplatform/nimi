# AGENTS.md
- Think before acting. Read before editing. Prefer edits over rewrites. Be concise. Test your code. User instructions override this file.
## Scope
- Applies repo-wide. Nearest `AGENTS.md` wins.
## Hard Boundaries
- Repo-wide normative authority lives under `.nimi/spec/**`; retired pre-cutover authority history now lives in Git and must not regain active truth. Admitted app slices may live under `apps/**/spec/**` if they do not create parallel truth. Nimicoding package authority lives in the external `@nimiplatform/nimi-coding` package; this host consumes it only through `pnpm exec nimicoding` and injected `.nimi/{config,contracts,methodology}/**` projections. Host-local truth lives under `.nimi/**`; human-authored topic lifecycle reports live under `.nimi/topics/{proposal,ongoing,pending,closed}/**`; `.local/**` is legacy local execution/evidence compatibility space, not the primary human report workspace; tracked support inputs live under `config/**`; `dev/**` is inactive.
- High-risk authority-bearing work needs preflight before implementation with `Spec Status`, `Authority Owner`, `Work Type`, and `Parallel Truth`.
- `Work Type=alignment` must align to existing authority with no parallel truth. `Work Type=redesign` changes authority/canonical ownership and must not proceed without prior `/.nimi/spec/**` alignment.
- Debug/fix order: `runtime` → `sdks/typescript` → `apps/desktop`/`apps/web`. Reuse `@nimiplatform/kit` first for UI work via `kit/README.md` and `.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml`.
- Fail closed on contract violations. No legacy shims, no pseudo-success, no app-level REST bypass, no provider/model hardcoding.
- Boundary enforcement: Desktop/Web must not import `runtime/internal/**`; SDK must not cross `realm`/`runtime` private boundaries; Runtime must not import `sdks/**` or `apps/**`; no file collisions or forwarding shells outside `index.ts`.
- Ralph/topic runner: do not emulate the loop by generating long `topic run-ledger record` primitive command chains. Use packaged `pnpm exec nimicoding topic-runner run|step ...` when available; otherwise use `topic run-next-step --json` and stop on every non-`continue` stop class.
- Nimi2D Image2: use standard provider scripts `image2-provider-plan`, `image2-provider-run`, `image2-register-output`, and `image2-layer-workflow`; never treat provider artifacts as formal admission before atlas, layer-input, Generation Bench, and runtime proof gates pass.
## Retrieval Defaults
- Start: `runtime/internal`, `runtime/cmd/nimi`, `sdks/typescript`, `apps/**/src`, `apps/**/src-tauri/src`, `.nimi/spec/*/kernel`, `scripts`, `.local/**`, `.nimi/**`, `config/**`.
- Skip: `_external/**`, `.iterate/**`, `.cache/**`, `archive/**`, `docs/**`, `**/generated/**`, `**/gen/**`, lockfiles, large assets.
## Verification Commands
- Guardrails: `pnpm nimicoding:validate-ai-governance --profile nimi --scope all`, `pnpm check:no-retired-methodology-refs`, `pnpm check:no-legacy-imports`, `pnpm check:no-absolute-user-paths`, `pnpm check:no-app-realm-rest-bypass`.
- Spec: run affected `pnpm exec nimicoding validate-spec-governance --profile nimi --scope ...` and `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope ... --check` commands. For broad spec drift, also run `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope spec-human-doc --check`.
- Runtime/SDK/Desktop/Web/Live: `go build ./...`, `go vet ./...`, `go test ./...`, `go run ./cmd/runtime-compliance --gate`, `pnpm --filter @nimiplatform/sdk test`, `pnpm check:sdk-coverage`, `pnpm check:sdk-consumer-smoke`, `pnpm --filter @nimiplatform/desktop test`, `pnpm --filter @nimiplatform/web build`, `pnpm check:live-provider-invariants`.
<!-- nimicoding:managed:agents:start -->
# Nimi Coding Managed Block
- Read .nimi/methodology, .nimi/spec, and .nimi/contracts before high-risk changes.
- Treat .nimi as the primary AI truth surface for this project.
- Treat `/.nimi/spec/**` as the current repo-wide product authority for this project, and use Git history for retired pre-cutover authority evidence.
- If .nimi/spec remains bootstrap-only, use .nimi/methodology/spec-reconstruction.yaml and .nimi/config/skills.yaml to drive AI-side truth reconstruction.
- Treat .nimi/methodology/spec-target-truth-profile.yaml as repo-local support guidance for future governance slices, not as the canonical reconstruction completion target or a guaranteed fresh-bootstrap seed.
- Treat .nimi/contracts/spec-reconstruction-result.yaml, .nimi/contracts/doc-spec-audit-result.yaml, .nimi/contracts/high-risk-execution-result.yaml, and .nimi/contracts/high-risk-admission.schema.yaml as machine contracts for reconstruction, audit, local-only high-risk closeout summaries, and local-only high-risk admission evidence.
- Treat .nimi/config/skill-manifest.yaml, .nimi/config/host-profile.yaml, .nimi/config/host-adapter.yaml, .nimi/config/external-execution-artifacts.yaml, .nimi/config/skill-installer.yaml, .nimi/methodology/skill-runtime.yaml, .nimi/methodology/skill-installer-result.yaml, .nimi/methodology/skill-handoff.yaml, and admitted package-owned adapter profiles under adapters/**/profile.yaml as the canonical bridge to any external AI/skill execution.
- Treat standalone nimicoding as boundary-complete for bootstrap, handoff, validation, projection, and explicit admission only; do not assume packaged run-kernel, provider, scheduler, notification, or automation ownership.
- Treat .nimi/config/installer-evidence.yaml and .nimi/methodology/skill-installer-summary-projection.yaml as the operational-to-semantic installer projection boundary; do not promote concrete evidence artifacts into semantic truth.
- Treat high-risk external execution closeout, decision, ingest, and review payloads under .nimi/local/** as local-only operational projections; they do not promote semantic truth automatically, even when manager-owned.
- Use high-risk packetized execution only when authority, ownership, or cross-layer risk justifies it.
- Keep inline manager-worker as the default methodology posture; do not assume a separate worker runtime is mandatory.
- Keep code changes AI-context-efficient: favor bounded, cohesive files and split by responsibility during implementation instead of first concentrating unrelated logic into one file.
- Keep the methodology continuity-agnostic; do not assume daemon, heartbeat, or persistent manager ownership.
- Treat cutover readiness as preflight evidence only; the authority flip must come from an admitted cutover batch, not from readiness green by itself.
- Do not treat this managed block as a replacement for project-specific rules outside .nimi.
<!-- nimicoding:managed:agents:end -->
