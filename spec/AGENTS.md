# Spec AGENTS.md

## Scope
- Applies to the `nimi/spec/**` subtree in this workspace (`runtime`, `sdk`, `desktop`, `platform`, `realm`, `future`).
- Relay spec generation/check scripts may exist in the repo root toolchain, but there is no active `spec/relay/**` subtree in this workspace yet.
- Kernel files are the only normative layer; domain docs are thin guides that point back to kernel rule IDs.

## Hard Boundaries
- Write rules and structured facts only in `spec/**/kernel/*.md` and `spec/**/kernel/tables/**`.
- Do not place execution state, reports, checklists, dated pass/fail snapshots, or iteration logs in `spec/**`.
- Do not manually edit `spec/**/kernel/generated/**`.
- Do not manually edit `spec/generated/nimi-spec.md`; it is derived output and must be regenerated from current kernel sources.
- Domain docs must not invent local rule ID systems or duplicate kernel rule prose.

## Retrieval Defaults
- Start from `spec/INDEX.md`, then the affected `spec/*/kernel/**`, then the nearest domain guide.
- Skip `spec/generated/**` and `spec/**/kernel/generated/**` unless validating drift.

## Verification Commands
- Generate before drift checks when tables change: `pnpm generate:runtime-spec-kernel-docs`, `pnpm generate:sdk-spec-kernel-docs`, `pnpm generate:desktop-spec-kernel-docs`, `pnpm generate:future-spec-kernel-docs`, `pnpm generate:platform-spec-kernel-docs`, `pnpm generate:realm-spec-kernel-docs`.
- Any change under `spec/**/kernel/**` or `spec/**/kernel/tables/**` must also run `pnpm check:spec-human-doc-drift`; if it fails, run `pnpm generate:spec-human-doc` and include the regenerated `spec/generated/nimi-spec.md` in the same change.
- Required checks: run the affected spec consistency command and the matching docs drift command.
- Put topic-bound local execution materials in `.local/work/<topic-id>/**` and local reports in `.local/report/**` when a local workspace is used. Tracked spec content must not depend on concrete `.local` files.
