# Spec AGENTS.md

## Scope
- Applies to `spec/**`.
- Kernel files are the only normative layer; domain docs are thin guides that point back to kernel rule IDs.

## Hard Boundaries
- Write rules and structured facts only in `spec/**/kernel/*.md` and `spec/**/kernel/tables/**`.
- Do not place execution state, reports, checklists, dated pass/fail snapshots, or iteration logs in `spec/**`.
- Do not manually edit `spec/**/kernel/generated/**`.
- Domain docs must not invent local rule ID systems or duplicate kernel rule prose.

## Retrieval Defaults
- Start from `spec/INDEX.md`, then the affected `spec/*/kernel/**`, then the nearest domain guide.
- Skip `spec/generated/**` and `spec/**/kernel/generated/**` unless validating drift.

## Verification Commands
- Generate before drift checks when tables change: `pnpm generate:runtime-spec-kernel-docs`, `pnpm generate:sdk-spec-kernel-docs`, `pnpm generate:desktop-spec-kernel-docs`, `pnpm generate:future-spec-kernel-docs`, `pnpm generate:platform-spec-kernel-docs`, `pnpm generate:realm-spec-kernel-docs`.
- Required checks: run the affected spec consistency command and the matching docs drift command.
- Put execution evidence in `dev/report/**` and plans in `dev/plan/**`.
