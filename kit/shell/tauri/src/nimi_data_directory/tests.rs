//! Tests for the shared `nimi_data` directory ownership + cleanup primitives.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::{
    enforce_data_root_layout, execute_directory_cleanup, first_level_directory_names,
    first_level_row, measure_directory, plan_directory_cleanup, CleanupClass,
    DESTRUCTIVE_CLEANUP_CONFIRMATION, NIMI_DATA_DIRECTORY_MATRIX,
};
use crate::nimi_data_directory::layout::scan_data_root;

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

#[test]
fn matrix_mirrors_kernel_table_rows() {
    let table_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../config/platform-nimi-data-directory-ownership.yaml");
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
    for name in ["models", "dependencies", "environments"] {
        let row = first_level_row(name).expect("declared directory");
        assert!(
            row.owner.is_runtime_owned(),
            "{name} must be a Runtime-owned directory"
        );
        assert_eq!(row.cleanup, CleanupClass::RuntimeManaged);
    }
}

#[test]
fn non_cache_cleanup_fails_closed_without_confirmation() {
    let base = unique_dir("cleanup-confirm");
    let data_root = base.join("nimi_data");
    enforce_data_root_layout(&data_root).expect("layout");
    write_file(
        &data_root.join("generated/artifact.png"),
        b"generated-bytes",
    );

    let plan = plan_directory_cleanup(&data_root, "generated").expect("plan");
    assert!(plan.requires_confirmation);
    let error = execute_directory_cleanup(&data_root, "generated", None)
        .expect_err("missing confirmation must fail closed");
    assert!(error.contains("显式确认令牌"));
    assert!(data_root.join("generated/artifact.png").exists());

    let wrong = execute_directory_cleanup(&data_root, "generated", Some("yes"))
        .expect_err("wrong confirmation fails closed");
    assert!(wrong.contains("显式确认令牌"));
    assert!(data_root.join("generated/artifact.png").exists());

    let outcome = execute_directory_cleanup(
        &data_root,
        "generated",
        Some(DESTRUCTIVE_CLEANUP_CONFIRMATION),
    )
    .expect("confirmed cleanup");
    assert_eq!(outcome.removed_files, 1);
    assert!(!data_root.join("generated/artifact.png").exists());
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
fn scan_data_root_surfaces_unowned_directories() {
    let base = unique_dir("scan");
    let data_root = base.join("nimi_data");
    enforce_data_root_layout(&data_root).expect("layout");
    write_file(&data_root.join("apps/app-1/data/x"), b"app");
    write_file(&data_root.join("foreign-dir/file"), b"foreign");

    let breakdown = scan_data_root(&data_root).expect("scan");
    assert_eq!(breakdown.unowned_names, vec!["foreign-dir".to_string()]);
    assert_eq!(breakdown.unowned_extra.file_count, 1);
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
