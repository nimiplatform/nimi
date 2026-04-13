# AGENTS.md
- Think before acting. Read before editing. Prefer edits over rewrites.
- Be concise. Test your code. User instructions override this file.
## Scope
- Applies repo-wide. Nearest `AGENTS.md` wins.
## Hard Boundaries
- Repo-wide normative authority lives under `.nimi/spec/**`; retired pre-cutover authority history now lives in Git and must not regain active truth. Admitted app slices may live under `apps/**/spec/**` if they do not create parallel truth. `nimi-coding/**` owns methodology/bootstrap sources under `nimi-coding/{config,contracts,methodology,spec}/**`; host-local truth lives under `.nimi/**`; local-only execution lives under `.local/**`; tracked support inputs live under `config/**`; `dev/**` is inactive.
- High-risk authority-bearing work needs preflight before implementation with `Spec Status`, `Authority Owner`, `Work Type`, and `Parallel Truth`.
- `Work Type=alignment` must align to existing authority with no parallel truth. `Work Type=redesign` changes authority/canonical ownership and must not proceed without prior `/.nimi/spec/**` alignment.
- Debug/fix order: `runtime` → `sdk` → `apps/desktop`/`apps/web` → `nimi-mods`. Reuse `nimi-kit` first for UI work via `kit/README.md` and `.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml`.
- Fail closed on contract violations. No legacy shims, no pseudo-success, no app-level REST bypass, no provider/model hardcoding.
- Boundary enforcement: Desktop/Web must not import `runtime/internal/**`; SDK must not cross `realm`/`runtime` private boundaries; Mods must not bypass `nimi-hook`; Runtime must not import `sdk/**` or `apps/**`; no file collisions or forwarding shells outside `index.ts`.
## Retrieval Defaults
- Start: `runtime/internal`, `runtime/cmd/nimi`, `sdk/src`, `apps/**/src`, `apps/**/src-tauri/src`, `.nimi/spec/*/kernel`, `scripts`, `nimi-coding/**`, `.local/**`, `.nimi/**`, `config/**`.
- Skip: `_external/**`, `.iterate/**`, `.cache/**`, `archive/**`, `docs/**`, `**/generated/**`, `**/gen/**`, lockfiles, large assets.
## Verification Commands
- Guardrails: `pnpm check:agents-freshness`, `pnpm check:high-risk-doc-metadata`, `pnpm check:no-retired-methodology-refs`, `pnpm check:ai-context-budget`, `pnpm check:ai-structure-budget`, `pnpm check:no-legacy-imports`, `pnpm check:no-absolute-user-paths`, `pnpm check:no-app-realm-rest-bypass`.
- Spec: run affected consistency + docs drift commands. For `/.nimi/spec/**/kernel/**`, also run `pnpm check:spec-human-doc-drift`; if it fails, run `pnpm generate:spec-human-doc`.
- Runtime/SDK/Desktop/Web/Live: `go build ./...`, `go vet ./...`, `go test ./...`, `go run ./cmd/runtime-compliance --gate`, `pnpm --filter @nimiplatform/sdk test`, `pnpm check:sdk-coverage`, `pnpm check:sdk-consumer-smoke`, `pnpm --filter @nimiplatform/desktop test`, `pnpm --filter @nimiplatform/web build`, `pnpm check:live-provider-invariants`, `pnpm check:runtime-mod-hook-hardcut`, `pnpm check:mods-no-runtime-sdk`, `pnpm check:local-chat-e2e`.
<!-- nimicoding:managed:agents:start -->
# Nimi Coding Managed Block
- Read `.nimi/methodology`, `.nimi/spec`, and `.nimi/contracts` before high-risk changes. Treat `.nimi` as the primary AI truth surface.
- Treat `/.nimi/spec/**` as the current repo-wide authority. For retired pre-cutover authority history, use Git history only.
- If `.nimi/spec` is bootstrap-only, use `.nimi/methodology/spec-reconstruction.yaml` and `.nimi/config/skills.yaml` to drive reconstruction. Treat `.nimi/methodology/spec-target-truth-profile.yaml` as repo-local support only.
- Treat `.nimi/contracts/spec-reconstruction-result.yaml`, `.nimi/contracts/doc-spec-audit-result.yaml`, `.nimi/contracts/high-risk-execution-result.yaml`, and `.nimi/contracts/high-risk-admission.schema.yaml` as machine contracts for reconstruction, audit, local-only closeout, and canonical high-risk admission truth.
- Treat `.nimi/config/{skill-manifest,host-profile,host-adapter,external-execution-artifacts,skill-installer}.yaml`, `.nimi/methodology/{skill-runtime,skill-installer-result,skill-handoff}.yaml`, and admitted adapter profiles under `adapters/**/profile.yaml` as the bridge to external AI/skill execution.
- Standalone nimicoding is boundary-complete for bootstrap, handoff, validation, projection, and explicit admission only; do not assume packaged run-kernel, provider, scheduler, notification, or automation ownership.
- Treat `.nimi/config/installer-evidence.yaml`, `.nimi/methodology/skill-installer-summary-projection.yaml`, and `.nimi/local/**` high-risk artifacts as operational/local-only projections, not semantic truth promotion.
- Default posture: use packetized execution only when risk justifies it, keep inline manager-worker by default, keep continuity-agnostic semantics, and do not treat this block as a replacement for project-specific rules.
<!-- nimicoding:managed:agents:end -->
