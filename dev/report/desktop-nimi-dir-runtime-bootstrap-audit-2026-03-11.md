# Desktop `nimi_dir` / Runtime Bootstrap Audit

Date: 2026-03-11

## Baseline

- Normative direction for this audit is [`dev/plan/0311-nimi-dir.md`](/Users/snwozy/nimi-realm/nimi/dev/plan/0311-nimi-dir.md).
- Desktop spec remains authoritative under [`spec/desktop/**`](/Users/snwozy/nimi-realm/nimi/spec/desktop/kernel/mod-governance-contract.md).
- [`dev/plan/0311-runtime-bootstrap.md`](/Users/snwozy/nimi-realm/nimi/dev/plan/0311-runtime-bootstrap.md) is treated as partially superseded where it still targets `nimi_dir/mods`.

## Conclusion

Current Desktop implementation is already aligned with the newer `nimi_dir` / `nimi_data_dir` contract in the key areas below:

- `nimi_dir` is fixed at `~/.nimi`, and `nimi_data_dir` defaults to `~/.nimi/data`.
- installed runtime mods resolve to `{nimi_data_dir}/mods`, not `~/.nimi/mods`.
- Desktop persists and switches `nimi_data_dir` without automatic migration.
- runtime mod source registry is constrained to one Desktop-managed installed source plus user-configurable `dev` sources.
- auto reload only watches `dev` sources.
- missing `nimi` binary is treated as runtime unavailable, not shell-fatal startup failure.

The remaining issue was not a contract bug but an audit gap:

- the older `0311-runtime-bootstrap.md` document still described `nimi_dir/mods`;
- targeted tests did not sufficiently lock the newer contract or the non-fatal runtime-unavailable startup path;
- runtime settings UI surfaced the raw bridge error but did not provide explicit binary guidance.

## Evidence

- Directory roots and resolved storage paths are defined in [`apps/desktop/src-tauri/src/desktop_paths.rs`](/Users/snwozy/nimi-realm/nimi/apps/desktop/src-tauri/src/desktop_paths.rs).
- Default installed mods directory is resolved in [`apps/desktop/src-tauri/src/runtime_mod/store/path_env.rs`](/Users/snwozy/nimi-realm/nimi/apps/desktop/src-tauri/src/runtime_mod/store/path_env.rs).
- installed/dev source constraints and dev-only watcher behavior live in [`apps/desktop/src-tauri/src/runtime_mod/store/source_registry.rs`](/Users/snwozy/nimi-realm/nimi/apps/desktop/src-tauri/src/runtime_mod/store/source_registry.rs).
- runtime-unavailable bootstrap degradation lives in [`apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts`](/Users/snwozy/nimi-realm/nimi/apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap.ts).

## Superseded Old-Plan Item

The following old-plan target is considered obsolete and should not be implemented unless the Desktop spec is intentionally changed:

- `0311-runtime-bootstrap.md` target: default installed mods path = `nimi_dir/mods`

Reason:

- it conflicts with the newer `0311-nimi-dir.md` direction;
- it conflicts with the current Desktop spec;
- it conflicts with the existing Desktop storage model that intentionally keeps mutable mod/model/cache/state data under `nimi_data_dir`.

## Follow-up Closed By This Change

- Added contract tests for `nimi_data_dir` and runtime mod source behavior.
- Added bootstrap test coverage for non-fatal runtime unavailable startup.
- Added runtime settings guidance for missing `nimi` binary while preserving raw diagnostics.
