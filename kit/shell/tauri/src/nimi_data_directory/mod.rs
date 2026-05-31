//! `nimi_data` directory ownership enforcement + destructive cleanup.
//!
//! Spec authority: `.nimi/spec/platform/kernel/local-config-migration-contract.md`
//! `P-MIG-006`, `P-MIG-008`, and the kernel table
//! `.nimi/spec/platform/kernel/tables/nimi-data-directory-ownership.yaml`.
//!
//! This module is shared host/scaffold infrastructure for Nimi apps. It owns
//! the reusable Rust/Tauri primitive for materializing the declared `nimi_data`
//! layout and for planning / executing ownership-aware cleanup. Callers still
//! own how they resolve a selected data root.

mod cleanup;
mod layout;
mod ownership;

#[cfg(test)]
mod tests;

pub use cleanup::{
    execute_directory_cleanup, plan_directory_cleanup, CleanupOutcome, CleanupPlan,
    DESTRUCTIVE_CLEANUP_CONFIRMATION,
};
pub use layout::{enforce_data_root_layout, measure_directory, DirectoryUsage};
pub use ownership::{
    first_level_directory_names, first_level_row, is_declared_first_level, CleanupClass,
    DirectoryOwner, NimiDataDirectoryRow, NIMI_DATA_DIRECTORY_MATRIX,
};
