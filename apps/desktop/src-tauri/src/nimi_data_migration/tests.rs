//! Tests for the `nimi_data` directory ownership + migration flow (T10.2).
//!
//! Coverage:
//! - `P-MIG-006`: the ownership matrix mirrors the kernel table; the
//!   first-level layout builder creates exactly the declared directory set.
//! - `P-MIG-007`: a full data-root migration copies + integrity-verifies +
//!   atomically cuts the pointer over; a copy / verify failure fails closed
//!   with no orphaning of either side; the typed state machine reaches the
//!   correct terminal state.
//! - `P-MIG-008`: a non-pure-cache cleanup fails closed without the
//!   confirmation token; a Runtime-owned directory is refused outright; a
//!   pure-cache cleanup runs without a token.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::test_support::with_env;

use super::cleanup::{
    execute_directory_cleanup, plan_directory_cleanup, plan_old_root_reclaim, reclaim_old_root,
    DESTRUCTIVE_CLEANUP_CONFIRMATION,
};
use super::copy::{compute_signature, copy_tree, verify_copy};
use super::flow::{run_migration, MigrationState};
use super::layout::{enforce_data_root_layout, measure_directory, scan_data_root};
use super::ownership::{
    first_level_directory_names, first_level_row, CleanupClass, NIMI_DATA_DIRECTORY_MATRIX,
};

/// Drive an async `#[tauri::command]` body to completion on a fresh
/// current-thread runtime. `with_env` holds the process-global env mutex, so
/// each test resolves `~/.nimi/nimi.json` against its own isolated `HOME`.
fn block_on_command<T>(future: impl std::future::Future<Output = T>) -> T {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("build test runtime")
        .block_on(future)
}

fn unique_dir(prefix: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("nimi-data-mig-{prefix}-{unique}"));
    fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

fn write_file(path: &Path, contents: &[u8]) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create parent");
    }
    fs::write(path, contents).expect("write file");
}

// --- P-MIG-006: ownership matrix + layout enforcement ---------------------

#[test]
fn matrix_mirrors_kernel_table_rows() {
    // The in-process matrix must mirror tables/nimi-data-directory-ownership
    // .yaml verbatim — the kernel table is the canonical fact source. This
    // asserts the row count and the ordered `directory_id` set against the
    // table so a table change cannot silently desync the Rust mirror.
    let table_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../.nimi/spec/platform/kernel/tables/nimi-data-directory-ownership.yaml");
    let raw = fs::read_to_string(&table_path)
        .unwrap_or_else(|error| panic!("read kernel table {}: {error}", table_path.display()));
    let table_ids: Vec<String> = raw
        .lines()
        .filter_map(|line| line.trim().strip_prefix("- directory_id:"))
        .map(|value| value.trim().trim_matches('"').to_string())
        .collect();
    let matrix_ids: Vec<String> = NIMI_DATA_DIRECTORY_MATRIX
        .iter()
        .map(|row| row.directory_id.to_string())
        .collect();
    assert_eq!(
        table_ids.len(),
        15,
        "the kernel table must declare 15 directory rows"
    );
    assert_eq!(
        matrix_ids, table_ids,
        "the in-process matrix must mirror the kernel table directory rows in order"
    );
}

#[test]
fn enforce_layout_creates_exactly_the_declared_first_level_directories() {
    let root = unique_dir("layout").join("nimi_data");
    enforce_data_root_layout(&root).expect("enforce layout");

    let expected = first_level_directory_names();
    assert_eq!(
        expected.len(),
        10,
        "ten first-level directories are declared"
    );
    for name in &expected {
        assert!(
            root.join(name).is_dir(),
            "declared first-level directory {name} must be created"
        );
    }
    // No undeclared directory was created.
    let on_disk: Vec<String> = fs::read_dir(&root)
        .expect("read root")
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .collect();
    for name in &on_disk {
        assert!(
            first_level_row(name).is_some(),
            "on-disk directory {name} must be a declared P-MIG-006 first-level directory"
        );
    }
}

#[test]
fn runtime_owned_directories_are_classified_runtime_managed() {
    // P-MIG-006: models / dependencies / environments are Runtime-owned and
    // must never be cleaned by the Desktop shell.
    for name in ["models", "dependencies", "environments"] {
        let row = first_level_row(name).expect("declared directory");
        assert!(
            row.owner.is_runtime_owned(),
            "{name} must be a Runtime-owned directory"
        );
        assert_eq!(row.cleanup, CleanupClass::RuntimeManaged);
    }
}

// --- copy + integrity ------------------------------------------------------

#[test]
fn copy_tree_then_verify_matches_integrity_signature() {
    let base = unique_dir("copy");
    let source = base.join("source");
    write_file(&source.join("models/a.bin"), b"model-bytes");
    write_file(&source.join("apps/app-1/data/db.sqlite"), b"app-data");
    write_file(&source.join("logs/run.log"), b"log-line");

    let target = base.join("target");
    copy_tree(&source, &target).expect("copy tree");
    let signature = verify_copy(&source, &target).expect("verify copy");

    assert_eq!(signature.file_count, 3);
    assert_eq!(
        signature.total_bytes,
        (b"model-bytes".len() + b"app-data".len() + b"log-line".len()) as u64
    );
    // The digest is deterministic and path-ordered.
    assert_eq!(
        compute_signature(&source)
            .expect("source signature")
            .content_digest,
        signature.content_digest
    );
}

#[test]
fn verify_copy_fails_closed_on_content_mismatch() {
    let base = unique_dir("verify-mismatch");
    let source = base.join("source");
    write_file(&source.join("apps/app-1/data/db.sqlite"), b"original");
    let target = base.join("target");
    copy_tree(&source, &target).expect("copy tree");
    // Corrupt the target after copy.
    write_file(&target.join("apps/app-1/data/db.sqlite"), b"corrupted");

    let error = verify_copy(&source, &target).expect_err("mismatch must fail closed");
    assert!(
        error.contains("完整性校验失败"),
        "a content mismatch must fail the integrity check, got: {error}"
    );
}

// --- P-MIG-007: full migration flow ---------------------------------------

#[test]
fn full_migration_copies_verifies_and_cuts_pointer_over_atomically() {
    let home = unique_dir("migrate-home");
    with_env(&[("HOME", home.to_str())], || {
        // First-run: select a data root and write some user/app data into it.
        let source_root = home.join("source-nimi-data");
        crate::desktop_product_control::select_product_data_root(
            source_root.to_str().expect("source"),
        )
        .expect("select data root");
        write_file(&source_root.join("apps/app-1/data/db.sqlite"), b"user-data");
        write_file(&source_root.join("models/m.bin"), b"model");
        write_file(&source_root.join("cache/scratch.tmp"), b"cache");

        let target_root = home.join("moved-nimi-data");
        let outcome = run_migration(&source_root, target_root.to_str().expect("target"))
            .expect("run migration");

        assert_eq!(
            outcome.state,
            MigrationState::Completed,
            "a successful migration reaches Completed, error: {:?}",
            outcome.error
        );
        // The data is present + identical at the new location.
        assert_eq!(
            fs::read(target_root.join("apps/app-1/data/db.sqlite")).expect("moved data"),
            b"user-data"
        );
        assert_eq!(outcome.verified_files, 3);
        assert!(outcome.verified_digest.is_some());
        // P-MIG-007 pointer commit last: ~/.nimi/nimi.json now points at the
        // new root.
        let resolved =
            crate::desktop_product_control::selected_product_data_root().expect("resolved");
        assert_eq!(resolved, target_root);
        // P-MIG-006 layout enforced on the migrated root.
        for name in first_level_directory_names() {
            assert!(target_root.join(name).is_dir());
        }
        // No orphaning: the old data root is retained intact, not deleted.
        assert!(outcome.old_root_retained);
        assert_eq!(
            fs::read(source_root.join("apps/app-1/data/db.sqlite")).expect("old data intact"),
            b"user-data"
        );

        // P-MIG-008 reclaim authorization: the completed migration recorded the
        // old root in the reclaim ledger, and ONLY that recorded path is
        // reclaimable. An arbitrary renderer-supplied path is never recorded.
        assert!(
            crate::desktop_product_control::is_recorded_retained_old_root(&source_root)
                .expect("ledger lookup"),
            "the migration must record the retained old root"
        );
        let arbitrary = home.join("not-a-migration-root");
        write_file(&arbitrary.join("important.txt"), b"unrelated user file");
        assert!(
            !crate::desktop_product_control::is_recorded_retained_old_root(&arbitrary)
                .expect("ledger lookup"),
            "an unrecorded path must never be authorized for reclaim"
        );
        // The arbitrary path is not reclaimable even with the token + valid
        // path guards, because the plan folds in the unrecorded fact. The plan
        // also must NOT scan it — its real file is never measured / revealed.
        let arbitrary_plan = plan_old_root_reclaim(&arbitrary, &target_root, false)
            .expect("plan arbitrary");
        assert!(!arbitrary_plan.reclaimable);
        assert_eq!(arbitrary_plan.file_count, 0);
        assert_eq!(arbitrary_plan.total_bytes, 0);

        // The recorded old root reclaims, and the ledger entry is then consumed.
        let reclaimed = reclaim_old_root(
            &source_root,
            &target_root,
            Some(DESTRUCTIVE_CLEANUP_CONFIRMATION),
        )
        .expect("confirmed reclaim of recorded old root");
        assert!(reclaimed.removed_files >= 1);
        assert!(!source_root.exists());
        crate::desktop_product_control::consume_retained_old_root(&source_root)
            .expect("consume ledger entry");
        assert!(
            !crate::desktop_product_control::is_recorded_retained_old_root(&source_root)
                .expect("ledger lookup after consume"),
            "a consumed ledger entry is no longer advertised as reclaimable"
        );
        // The unrelated arbitrary file was never touched.
        assert_eq!(
            fs::read(arbitrary.join("important.txt")).expect("arbitrary intact"),
            b"unrelated user file"
        );
    });
}

#[test]
fn migration_into_occupied_target_fails_closed_without_touching_pointer() {
    let home = unique_dir("migrate-occupied");
    with_env(&[("HOME", home.to_str())], || {
        let source_root = home.join("source-nimi-data");
        crate::desktop_product_control::select_product_data_root(
            source_root.to_str().expect("source"),
        )
        .expect("select data root");
        write_file(&source_root.join("apps/app-1/data/db.sqlite"), b"user-data");

        // A pre-existing non-empty target.
        let target_root = home.join("occupied-nimi-data");
        write_file(&target_root.join("existing/file.txt"), b"already here");

        let outcome = run_migration(&source_root, target_root.to_str().expect("target"))
            .expect("run migration");
        assert_eq!(outcome.state, MigrationState::Failed);
        assert!(outcome
            .error
            .clone()
            .unwrap_or_default()
            .contains("已存在且非空"));
        // P-MIG-005 no orphaning: the pointer still resolves to the source,
        // and the source data is intact.
        let resolved =
            crate::desktop_product_control::selected_product_data_root().expect("resolved");
        assert_eq!(resolved, source_root);
        assert_eq!(
            fs::read(source_root.join("apps/app-1/data/db.sqlite")).expect("source intact"),
            b"user-data"
        );
        // The occupied target's pre-existing content is untouched.
        assert_eq!(
            fs::read(target_root.join("existing/file.txt")).expect("target intact"),
            b"already here"
        );
    });
}

#[test]
fn migration_rejects_target_nested_in_source() {
    let home = unique_dir("migrate-nested");
    with_env(&[("HOME", home.to_str())], || {
        let source_root = home.join("source-nimi-data");
        crate::desktop_product_control::select_product_data_root(
            source_root.to_str().expect("source"),
        )
        .expect("select data root");
        // A target nested inside the source would make the copy
        // self-referential — must fail closed before any move.
        let nested = source_root.join("inner-target");
        let error = run_migration(&source_root, nested.to_str().expect("nested"))
            .expect_err("nested target must be rejected");
        assert!(error.contains("嵌套"));
    });
}

#[test]
fn migration_no_staging_residue_after_failure() {
    let home = unique_dir("migrate-residue");
    with_env(&[("HOME", home.to_str())], || {
        let source_root = home.join("source-nimi-data");
        crate::desktop_product_control::select_product_data_root(
            source_root.to_str().expect("source"),
        )
        .expect("select data root");
        write_file(&source_root.join("apps/app-1/data/db.sqlite"), b"user-data");
        let target_root = home.join("occupied-nimi-data");
        write_file(&target_root.join("existing/file.txt"), b"already here");

        let outcome = run_migration(&source_root, target_root.to_str().expect("target"))
            .expect("run migration");
        assert_eq!(outcome.state, MigrationState::Failed);
        // No `.nimi-migration-staging.*` directory is left behind in the
        // target's parent.
        let residue: Vec<String> = fs::read_dir(&home)
            .expect("read home")
            .filter_map(|entry| entry.ok())
            .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
            .filter(|name| name.contains("nimi-migration-staging"))
            .collect();
        assert!(
            residue.is_empty(),
            "a failed migration must leave no staging residue, found: {residue:?}"
        );
    });
}

// --- P-MIG-008: destructive cleanup confirmation --------------------------

#[test]
fn non_cache_cleanup_fails_closed_without_confirmation() {
    let base = unique_dir("cleanup-confirm");
    let data_root = base.join("nimi_data");
    enforce_data_root_layout(&data_root).expect("layout");
    write_file(
        &data_root.join("generated/artifact.png"),
        b"generated-bytes",
    );

    // `generated` is ConfirmRequired — a cleanup without the token fails closed.
    let plan = plan_directory_cleanup(&data_root, "generated").expect("plan");
    assert!(plan.requires_confirmation);
    let error = execute_directory_cleanup(&data_root, "generated", None)
        .expect_err("missing confirmation must fail closed");
    assert!(error.contains("显式确认令牌"));
    // The data is untouched.
    assert!(data_root.join("generated/artifact.png").exists());

    // A wrong token also fails closed.
    let wrong = execute_directory_cleanup(&data_root, "generated", Some("yes"))
        .expect_err("wrong confirmation fails closed");
    assert!(wrong.contains("显式确认令牌"));
    assert!(data_root.join("generated/artifact.png").exists());

    // The correct token executes the cleanup.
    let outcome = execute_directory_cleanup(
        &data_root,
        "generated",
        Some(DESTRUCTIVE_CLEANUP_CONFIRMATION),
    )
    .expect("confirmed cleanup");
    assert_eq!(outcome.removed_files, 1);
    assert!(!data_root.join("generated/artifact.png").exists());
    // The directory itself is re-created so the P-MIG-006 layout still holds.
    assert!(data_root.join("generated").is_dir());
}

#[test]
fn pure_cache_cleanup_runs_without_confirmation() {
    let base = unique_dir("cleanup-cache");
    let data_root = base.join("nimi_data");
    enforce_data_root_layout(&data_root).expect("layout");
    write_file(&data_root.join("cache/blob"), b"cache-bytes");

    let plan = plan_directory_cleanup(&data_root, "cache").expect("plan");
    assert!(
        !plan.requires_confirmation,
        "pure cache needs no confirmation"
    );
    let outcome = execute_directory_cleanup(&data_root, "cache", None).expect("cache cleanup");
    assert_eq!(outcome.removed_files, 1);
    assert!(!data_root.join("cache/blob").exists());
    assert!(data_root.join("cache").is_dir());
}

#[test]
fn runtime_owned_directory_cleanup_is_refused() {
    let base = unique_dir("cleanup-runtime");
    let data_root = base.join("nimi_data");
    enforce_data_root_layout(&data_root).expect("layout");
    write_file(&data_root.join("models/m.bin"), b"model-bytes");

    // Even with the confirmation token, a Runtime-owned directory is refused —
    // P-MIG-006 forbids the Desktop shell from mutating it.
    let error =
        execute_directory_cleanup(&data_root, "models", Some(DESTRUCTIVE_CLEANUP_CONFIRMATION))
            .expect_err("runtime-owned cleanup must be refused");
    assert!(error.contains("Runtime"));
    assert!(data_root.join("models/m.bin").exists());
}

#[test]
fn undeclared_directory_cleanup_is_rejected() {
    let base = unique_dir("cleanup-undeclared");
    let data_root = base.join("nimi_data");
    enforce_data_root_layout(&data_root).expect("layout");
    let error = execute_directory_cleanup(&data_root, "not-a-real-dir", None)
        .expect_err("undeclared directory must be rejected");
    assert!(error.contains("P-MIG-006"));
}

#[test]
fn old_root_reclaim_requires_confirmation_and_refuses_active_root() {
    let base = unique_dir("reclaim");
    let old_root = base.join("old-nimi-data");
    let active_root = base.join("active-nimi-data");
    write_file(&old_root.join("apps/app-1/data/db.sqlite"), b"old-data");
    enforce_data_root_layout(&active_root).expect("active layout");

    // Without the token, reclaim fails closed.
    let error = reclaim_old_root(&old_root, &active_root, None)
        .expect_err("reclaim without confirmation fails closed");
    assert!(error.contains("显式确认令牌"));
    assert!(old_root.join("apps/app-1/data/db.sqlite").exists());

    // Reclaiming the active root itself is refused.
    let same = reclaim_old_root(
        &active_root,
        &active_root,
        Some(DESTRUCTIVE_CLEANUP_CONFIRMATION),
    )
    .expect_err("reclaiming the active root must be refused");
    assert!(same.contains("当前活动数据根相同"));

    // With the token and a distinct old root, reclaim succeeds.
    let outcome = reclaim_old_root(
        &old_root,
        &active_root,
        Some(DESTRUCTIVE_CLEANUP_CONFIRMATION),
    )
    .expect("confirmed reclaim");
    assert_eq!(outcome.removed_files, 1);
    assert!(!old_root.exists());
}

#[test]
fn old_root_reclaim_plan_surfaces_impact_and_block_conditions() {
    let base = unique_dir("reclaim-plan");
    let old_root = base.join("old-nimi-data");
    let active_root = base.join("active-nimi-data");
    write_file(&old_root.join("apps/app-1/data/db.sqlite"), b"old-data");
    write_file(&old_root.join("logs/run.log"), b"log");

    // A distinct old root, recorded in the migration ledger, is reclaimable;
    // the plan reports the real impact and always requires confirmation (the
    // old root is always destructive).
    let plan = plan_old_root_reclaim(&old_root, &active_root, true).expect("reclaim plan");
    assert_eq!(plan.file_count, 2);
    assert!(plan.total_bytes > 0);
    assert!(plan.requires_confirmation);
    assert!(!plan.same_as_active);
    assert!(!plan.active_nested_in_old);
    assert!(plan.recorded);
    assert!(plan.reclaimable);
    // Planning deletes nothing.
    assert!(old_root.join("apps/app-1/data/db.sqlite").exists());

    // The same distinct old root, NOT recorded in the ledger, is never
    // reclaimable even though the path guards all pass — AND its impact is not
    // measured, so an unrecorded path cannot be used as a filesystem probe.
    let unrecorded =
        plan_old_root_reclaim(&old_root, &active_root, false).expect("plan unrecorded");
    assert!(!unrecorded.recorded);
    assert!(!unrecorded.reclaimable);
    assert_eq!(unrecorded.file_count, 0);
    assert_eq!(unrecorded.total_bytes, 0);

    // The active root itself is not reclaimable.
    let same = plan_old_root_reclaim(&active_root, &active_root, true).expect("plan same root");
    assert!(same.same_as_active);
    assert!(!same.reclaimable);

    // An old root that contains the active root is not reclaimable.
    let nested_active = old_root.join("nested-active");
    let nested =
        plan_old_root_reclaim(&old_root, &nested_active, true).expect("plan nested active root");
    assert!(nested.active_nested_in_old);
    assert!(!nested.reclaimable);
}

#[test]
fn reclaim_execute_command_refuses_unrecorded_path_even_with_token() {
    let home = unique_dir("reclaim-cmd");
    with_env(&[("HOME", home.to_str())], || {
        // An active data root must exist so the command can resolve the
        // backend-authoritative protected root.
        let active_root = home.join("active-nimi-data");
        crate::desktop_product_control::select_product_data_root(
            active_root.to_str().expect("active"),
        )
        .expect("select data root");

        // An arbitrary path with real content that the migration ledger never
        // recorded. A valid `CLEAN` token must NOT make it reclaimable — the
        // token is confirmation, not authorization.
        let arbitrary = home.join("unrelated-dir");
        write_file(&arbitrary.join("important.txt"), b"unrelated user file");

        let payload = super::NimiDataOldRootReclaimPayload {
            old_root: arbitrary.display().to_string(),
            confirmation: Some(DESTRUCTIVE_CLEANUP_CONFIRMATION.to_string()),
        };
        let error = block_on_command(super::nimi_data_old_root_reclaim_execute(payload))
            .expect_err("an unrecorded path must be refused by the command");
        assert!(
            error.contains("不是已记录的迁移保留旧"),
            "command must reject on the ledger authorization, got: {error}"
        );
        // The command deleted nothing — the unrelated file is intact.
        assert_eq!(
            fs::read(arbitrary.join("important.txt")).expect("arbitrary intact"),
            b"unrelated user file"
        );
    });
}

// --- scan / measure --------------------------------------------------------

#[test]
fn scan_data_root_surfaces_unowned_directories() {
    let base = unique_dir("scan");
    let data_root = base.join("nimi_data");
    enforce_data_root_layout(&data_root).expect("layout");
    write_file(&data_root.join("apps/app-1/data/x"), b"app");
    // A foreign directory the matrix does not declare.
    write_file(&data_root.join("foreign-dir/file"), b"foreign");

    let breakdown = scan_data_root(&data_root).expect("scan");
    assert_eq!(breakdown.unowned_names, vec!["foreign-dir".to_string()]);
    assert_eq!(breakdown.unowned_extra.file_count, 1);
    // The declared `apps` directory carries its data.
    assert_eq!(
        breakdown
            .per_directory
            .get("apps")
            .expect("apps")
            .file_count,
        1
    );
}

#[test]
fn measure_directory_of_missing_path_is_empty_not_error() {
    let missing = unique_dir("measure-missing").join("does-not-exist");
    let usage = measure_directory(&missing).expect("missing path measures empty");
    assert_eq!(usage.file_count, 0);
    assert_eq!(usage.total_bytes, 0);
}
