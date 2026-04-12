# AGENTS.md

- Think before acting. Read existing files before writing code. Prefer editing over rewriting.
- Be concise in output but thorough in reasoning. No sycophantic openers or closing fluff.
- Test your code before declaring done. User instructions always override this file.

## Scope
- Applies to the whole monorepo. Nearest path-scoped `AGENTS.md` may add stricter rules.
- `spec/AGENTS.md` is authoritative for anything under `spec/**`.

## Hard Boundaries
- Repo-wide normative product authority lives under `spec/**`. Admitted app-local product authority slices may also live under `apps/**/spec/**` when the owning app declares that landing, keeps normative content inside `kernel/*.md` and `kernel/tables/**`, and does not create parallel truth against `spec/**`. `nimi-coding/**` is an admitted monorepo package for methodology tooling and bootstrap contracts; it is not repo-wide product authority. Package-owned methodology source lives under `nimi-coding/{config,contracts,methodology,spec}/**`. Host-project local truth seeded by the package lives under `.nimi/**`. Local-only execution workspaces and reports may live under `.local/**`; tracked support inputs live under `config/**`. `dev/**` is not an active execution-doc surface.
- High-risk design/refactor/implementation work must complete authority preflight before implementation. Required fields in the design/plan doc: `Spec Status`, `Authority Owner`, `Work Type`, `Parallel Truth`.
- `Work Type=alignment` means align to existing spec authority and must not introduce parallel truth. `Work Type=redesign` means authority/canonical-model/ownership change and must not proceed to implementation without prior `spec/**` alignment.
- High-risk, authority-bearing, cross-layer, or multi-phase work must complete authority preflight before implementation. Small, local, low-risk fixes do not need a formal execution workspace when the authority boundary is already clear.
- Debug/fix by layer order: `runtime` → `sdk` → `apps/desktop`/`apps/web` → `nimi-mods`.
- Reuse `nimi-kit` first for app UI and interaction work; check `kit/README.md` and `spec/platform/kernel/tables/nimi-kit-registry.yaml`.
- No legacy shims, compatibility shells, hardcoded provider/model lists, or downstream workarounds.
- No fallback logic hiding contract violations. Missing typed output, MIME type, discriminator, required JSON shape, or schema fields must fail-close.
- No pseudo-success on stable product paths. Do not synthesize empty artifacts, guessed MIME types, fabricated IDs, default payloads.
- App-facing SDK must not expose fallback knobs for route/provider recovery. Internal runtime fallback may exist only as observable low-level strategy.
- Transport retry and single-flight auth refresh: only for transient transport/auth failures; never rescue decode/content-type/schema/contract errors.
- Boundary enforcement: Desktop/Web must not import `runtime/internal/**`; SDK must not cross `realm`/`runtime` private boundaries; Mods must not bypass `nimi-hook`; Runtime must not import from `sdk/**` or `apps/**`.
- App code must not bypass Realm typed services with raw/unsafe requests or ad hoc REST paths.
- No file/directory collisions, no forwarding shells outside `index.ts`, max 3-hop debug trace. Structure depth measured from layer source root.

## Retrieval Defaults
- Start: `runtime/internal`, `runtime/cmd/nimi`, `sdk/src`, `apps/**/src`, `apps/**/src-tauri/src`, `spec/*/kernel`, `scripts`, `nimi-coding/**`, `.local/**`, `.nimi/**`, `config/**`.
- Skip: `_external/**`, `.iterate/**`, `.cache/**`, `archive/**`, `docs/**`, `**/generated/**`, `**/gen/**`, lockfiles, large assets.

## Verification Commands
- Guardrails: `pnpm check:agents-freshness`, `pnpm check:high-risk-doc-metadata`, `pnpm check:no-retired-methodology-refs`, `pnpm check:ai-context-budget`, `pnpm check:ai-structure-budget`, `pnpm check:no-legacy-imports`, `pnpm check:no-absolute-user-paths`, `pnpm check:no-app-realm-rest-bypass`.
- Spec: run affected consistency + docs drift commands. For `spec/**/kernel/**` changes, also run `pnpm check:spec-human-doc-drift`; if fail, `pnpm generate:spec-human-doc`.
- Runtime: `go build ./...`, `go vet ./...`, `go test ./...`, `go run ./cmd/runtime-compliance --gate`
- SDK: `pnpm --filter @nimiplatform/sdk test`, `pnpm check:sdk-coverage`, `pnpm check:sdk-consumer-smoke`
- Desktop/Web: `pnpm --filter @nimiplatform/desktop test`, `pnpm --filter @nimiplatform/web build`
- Live gates: `pnpm check:live-provider-invariants`, `pnpm check:runtime-mod-hook-hardcut`, `pnpm check:mods-no-runtime-sdk`, `pnpm check:local-chat-e2e`.

<!-- nimicoding:managed:agents:start -->
# Nimi Coding Managed Block

- Read .nimi/methodology, .nimi/spec, and .nimi/contracts before high-risk changes.
- Treat .nimi as the primary AI truth surface for this project.
- If .nimi/spec remains bootstrap-only, use .nimi/methodology/spec-reconstruction.yaml and .nimi/config/skills.yaml to drive AI-side truth reconstruction.
- Treat .nimi/methodology/spec-target-truth-profile.yaml as repo-local support guidance for future governance slices, not as the canonical reconstruction completion target or a guaranteed fresh-bootstrap seed.
- Treat .nimi/contracts/spec-reconstruction-result.yaml, .nimi/contracts/doc-spec-audit-result.yaml, .nimi/contracts/high-risk-execution-result.yaml, and .nimi/contracts/high-risk-admission.schema.yaml as machine contracts for reconstruction, audit, local-only high-risk closeout summaries, and canonical high-risk admission truth.
- Treat .nimi/config/skill-manifest.yaml, .nimi/config/host-profile.yaml, .nimi/config/host-adapter.yaml, .nimi/config/external-execution-artifacts.yaml, .nimi/config/skill-installer.yaml, .nimi/methodology/skill-runtime.yaml, .nimi/methodology/skill-installer-result.yaml, .nimi/methodology/skill-handoff.yaml, and admitted package-owned adapter profiles under adapters/**/profile.yaml as the canonical bridge to any external AI/skill execution.
- Treat standalone nimicoding as boundary-complete for bootstrap, handoff, validation, projection, and explicit admission only; do not assume packaged run-kernel, provider, scheduler, notification, or automation ownership.
- Treat .nimi/config/installer-evidence.yaml and .nimi/methodology/skill-installer-summary-projection.yaml as the operational-to-semantic installer projection boundary; do not promote concrete evidence artifacts into semantic truth.
- Treat high-risk external execution closeout, decision, ingest, and review payloads under .nimi/local/** as local-only operational projections; they do not promote semantic truth automatically, even when manager-owned.
- Use high-risk packetized execution only when authority, ownership, or cross-layer risk justifies it.
- Keep inline manager-worker as the default methodology posture; do not assume a separate worker runtime is mandatory.
- Keep the methodology continuity-agnostic; do not assume daemon, heartbeat, or persistent manager ownership.
- Do not treat this managed block as a replacement for project-specific rules outside .nimi.
<!-- nimicoding:managed:agents:end -->
