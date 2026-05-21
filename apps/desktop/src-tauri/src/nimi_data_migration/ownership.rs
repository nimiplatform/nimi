//! `nimi_data` directory ownership matrix — `P-MIG-006`.
//!
//! Spec authority: `local-config-migration-contract.md` `P-MIG-006` and the
//! canonical table `tables/nimi-data-directory-ownership.yaml`. That table is
//! the only structured fact source for the `nimi_data` data-root directory
//! ownership and cleanup-rule authority; this module is its in-process Rust
//! mirror and the enforcement surface for directory creation, ownership
//! checks, and cleanup classification.
//!
//! The matrix has 15 rows. Ten of them are first-level `nimi_data`
//! subdirectories (`models`, `dependencies`, `environments`, `apps`,
//! `accounts`, `cache`, `logs`, `audit`, `generated`, `tmp`); the remaining
//! five are the per-`<app-id>` / per-`<account-id>` nested directories
//! (`apps/<app-id>/{releases,data,cache,tmp}`, `accounts/<account-id>/{data,
//! cache,exports}`). The first-level set is what the data-root layout
//! materializes; the nested set is templated and matched by path shape.

/// The owning authority of one `nimi_data` directory (`P-MIG-006`).
///
/// Mirrors the `owner` column of `nimi-data-directory-ownership.yaml`
/// verbatim. The owner decides who may mutate / clean a directory: the Desktop
/// shell and any Support surface MUST NOT mutate a `Runtime*`-owned directory
/// directly — those go through Runtime-owned management / job paths only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirectoryOwner {
    RuntimeModelMaterializer,
    RuntimeDependencyMaterializer,
    RuntimeEnvironmentMaterializer,
    AppPackageInstaller,
    App,
    AccountDataPlaneConsumers,
    UserExportFlow,
    NimiProductShell,
    RuntimeProductSupport,
    RuntimeRealmProductAudit,
    RuntimeAndApps,
}

impl DirectoryOwner {
    /// The canonical `owner` token from the kernel table.
    pub const fn owner_id(self) -> &'static str {
        match self {
            Self::RuntimeModelMaterializer => "runtime_model_materializer",
            Self::RuntimeDependencyMaterializer => "runtime_dependency_materializer",
            Self::RuntimeEnvironmentMaterializer => "runtime_environment_materializer",
            Self::AppPackageInstaller => "app_package_installer",
            Self::App => "app",
            Self::AccountDataPlaneConsumers => "account_data_plane_consumers",
            Self::UserExportFlow => "user_export_flow",
            Self::NimiProductShell => "nimi_product_shell",
            Self::RuntimeProductSupport => "runtime_product_support",
            Self::RuntimeRealmProductAudit => "runtime_realm_product_audit",
            Self::RuntimeAndApps => "runtime_and_apps",
        }
    }

    /// Whether this owner is a Runtime-owned data plane.
    ///
    /// `P-MIG-006` `MUST NOT`: the Desktop shell / Support surface / any
    /// renderer must not directly mutate a Runtime-owned directory
    /// (`models/` / `dependencies/` / `environments/`). Cleanup for those
    /// goes through Runtime management / job paths only — this predicate is
    /// the enforcement gate.
    pub const fn is_runtime_owned(self) -> bool {
        matches!(
            self,
            Self::RuntimeModelMaterializer
                | Self::RuntimeDependencyMaterializer
                | Self::RuntimeEnvironmentMaterializer
        )
    }
}

/// The cleanup classification of one `nimi_data` directory (`P-MIG-006` /
/// `P-MIG-008`).
///
/// Derived from the `cleanup_rule` column. It is the enforcement-relevant
/// distinction the migration / cleanup code branches on:
///
/// - `PureCache` — `cache/` and `tmp/` shaped directories. `P-MIG-008` allows
///   clearing these without forced confirmation, but the cleanup must still
///   obey the owner classification.
/// - `RuntimeManaged` — `models/` / `dependencies/` / `environments/`. Never
///   cleaned by the Desktop shell directly; routed to a Runtime job.
/// - `ConfirmRequired` — non-cache user / app / account persistent data.
///   `P-MIG-008` requires explicit confirmation + impact preview before any
///   destructive cleanup.
/// - `UserManaged` — user-created exports. Cleanup is a user action; the
///   product never auto-deletes these and a destructive cleanup still needs
///   confirmation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CleanupClass {
    PureCache,
    RuntimeManaged,
    ConfirmRequired,
    UserManaged,
}

impl CleanupClass {
    /// Whether a destructive cleanup of a directory in this class requires an
    /// explicit confirmation token (`P-MIG-008`).
    ///
    /// Pure-cache directories are the only class that may be cleared without a
    /// confirmation token. Runtime-managed directories are never cleaned by
    /// the Desktop shell at all — `requires_confirmation` is `true` for them
    /// so a confirmation-less request still fails closed, but the cleanup path
    /// additionally rejects them outright as a Runtime-owner boundary
    /// violation.
    pub const fn requires_confirmation(self) -> bool {
        !matches!(self, Self::PureCache)
    }
}

/// One row of the `nimi_data` directory ownership matrix.
#[derive(Debug, Clone, Copy)]
pub struct NimiDataDirectoryRow {
    /// Stable `directory_id` from the kernel table. Load-bearing identity used
    /// by the kernel-table drift test; `#[allow(dead_code)]` because the
    /// non-test enforcement paths key off the path template, not this id.
    #[allow(dead_code)]
    pub directory_id: &'static str,
    /// The `<nimi_data>`-relative path template from the table. Per-app /
    /// per-account rows keep the `<app-id>` / `<account-id>` placeholders.
    pub path_template: &'static str,
    /// Whether this row is a first-level `nimi_data` subdirectory (vs a
    /// templated nested directory under `apps/` / `accounts/`).
    pub first_level: bool,
    /// Owning authority (`P-MIG-006`).
    pub owner: DirectoryOwner,
    /// Cleanup classification (`P-MIG-006` / `P-MIG-008`).
    pub cleanup: CleanupClass,
}

/// The canonical 15-row `nimi_data` directory ownership matrix.
///
/// This is the verbatim in-process mirror of
/// `tables/nimi-data-directory-ownership.yaml`. The row order matches the
/// table's `directories` block. A drift test
/// (`tests::matrix_mirrors_kernel_table_rows`) asserts the row count and ids
/// against the kernel table so a table change cannot silently desync this
/// mirror.
pub const NIMI_DATA_DIRECTORY_MATRIX: &[NimiDataDirectoryRow] = &[
    NimiDataDirectoryRow {
        directory_id: "models",
        path_template: "<nimi_data>/models/",
        first_level: true,
        owner: DirectoryOwner::RuntimeModelMaterializer,
        cleanup: CleanupClass::RuntimeManaged,
    },
    NimiDataDirectoryRow {
        directory_id: "dependencies",
        path_template: "<nimi_data>/dependencies/",
        first_level: true,
        owner: DirectoryOwner::RuntimeDependencyMaterializer,
        cleanup: CleanupClass::RuntimeManaged,
    },
    NimiDataDirectoryRow {
        directory_id: "environments",
        path_template: "<nimi_data>/environments/",
        first_level: true,
        owner: DirectoryOwner::RuntimeEnvironmentMaterializer,
        cleanup: CleanupClass::RuntimeManaged,
    },
    NimiDataDirectoryRow {
        directory_id: "apps_releases",
        path_template: "<nimi_data>/apps/<app-id>/releases/",
        first_level: false,
        owner: DirectoryOwner::AppPackageInstaller,
        cleanup: CleanupClass::ConfirmRequired,
    },
    NimiDataDirectoryRow {
        directory_id: "apps_data",
        path_template: "<nimi_data>/apps/<app-id>/data/",
        first_level: false,
        owner: DirectoryOwner::App,
        cleanup: CleanupClass::ConfirmRequired,
    },
    NimiDataDirectoryRow {
        directory_id: "apps_cache",
        path_template: "<nimi_data>/apps/<app-id>/cache/",
        first_level: false,
        owner: DirectoryOwner::App,
        cleanup: CleanupClass::PureCache,
    },
    NimiDataDirectoryRow {
        directory_id: "apps_tmp",
        path_template: "<nimi_data>/apps/<app-id>/tmp/",
        first_level: false,
        owner: DirectoryOwner::App,
        cleanup: CleanupClass::PureCache,
    },
    NimiDataDirectoryRow {
        directory_id: "accounts_data",
        path_template: "<nimi_data>/accounts/<account-id>/data/",
        first_level: false,
        owner: DirectoryOwner::AccountDataPlaneConsumers,
        cleanup: CleanupClass::ConfirmRequired,
    },
    NimiDataDirectoryRow {
        directory_id: "accounts_cache",
        path_template: "<nimi_data>/accounts/<account-id>/cache/",
        first_level: false,
        owner: DirectoryOwner::AccountDataPlaneConsumers,
        cleanup: CleanupClass::PureCache,
    },
    NimiDataDirectoryRow {
        directory_id: "accounts_exports",
        path_template: "<nimi_data>/accounts/<account-id>/exports/",
        first_level: false,
        owner: DirectoryOwner::UserExportFlow,
        cleanup: CleanupClass::UserManaged,
    },
    NimiDataDirectoryRow {
        directory_id: "shared_cache",
        path_template: "<nimi_data>/cache/",
        first_level: true,
        owner: DirectoryOwner::NimiProductShell,
        cleanup: CleanupClass::PureCache,
    },
    NimiDataDirectoryRow {
        directory_id: "logs",
        path_template: "<nimi_data>/logs/",
        first_level: true,
        owner: DirectoryOwner::RuntimeProductSupport,
        cleanup: CleanupClass::ConfirmRequired,
    },
    NimiDataDirectoryRow {
        directory_id: "audit",
        path_template: "<nimi_data>/audit/",
        first_level: true,
        owner: DirectoryOwner::RuntimeRealmProductAudit,
        cleanup: CleanupClass::ConfirmRequired,
    },
    NimiDataDirectoryRow {
        directory_id: "generated",
        path_template: "<nimi_data>/generated/",
        first_level: true,
        owner: DirectoryOwner::RuntimeAndApps,
        cleanup: CleanupClass::ConfirmRequired,
    },
    NimiDataDirectoryRow {
        directory_id: "product_tmp",
        path_template: "<nimi_data>/tmp/",
        first_level: true,
        owner: DirectoryOwner::NimiProductShell,
        cleanup: CleanupClass::PureCache,
    },
];

/// The first path segment of a row's `<nimi_data>`-relative path template.
///
/// For a first-level row (`<nimi_data>/models/`) this is the directory name
/// itself (`models`). For a nested row (`<nimi_data>/apps/<app-id>/data/`)
/// this is the first-level *container* the nested row lives under (`apps`).
fn first_segment(path_template: &'static str) -> &'static str {
    path_template
        .trim_start_matches("<nimi_data>/")
        .split('/')
        .next()
        .unwrap_or("")
}

/// The ordered first-level `nimi_data` subdirectory names, derived from the
/// matrix.
///
/// This is the authoritative directory list for materializing a `nimi_data`
/// data root. `enforce_data_root_layout` creates exactly this set; the
/// `nimi_data` migration flow copies exactly this set.
///
/// It is the union of two matrix-derived sets:
/// - the directly-declared first-level rows (`models/`, `cache/`, `tmp/`, ...);
/// - the first-level *containers* implied by the nested per-`<app-id>` /
///   per-`<account-id>` rows — a nested row `<nimi_data>/apps/<app-id>/...`
///   means `apps/` is a first-level directory. Their owner / cleanup authority
///   is the union of their nested rows; they are governed by `P-MIG-006`
///   through those rows.
///
/// The result is deterministically ordered by first appearance in the matrix
/// so the materialized layout is stable.
pub fn first_level_directory_names() -> Vec<&'static str> {
    let mut names: Vec<&'static str> = Vec::new();
    for row in NIMI_DATA_DIRECTORY_MATRIX {
        let segment = first_segment(row.path_template);
        if !segment.is_empty() && !names.contains(&segment) {
            names.push(segment);
        }
    }
    names
}

/// Whether `name` is a declared first-level `nimi_data` directory — either a
/// directly-declared first-level row or a first-level container implied by a
/// nested per-`<app-id>` / per-`<account-id>` row.
///
/// `P-MIG-006`: a directory that is not in this set has no owner and must not
/// be treated as a governed `nimi_data` directory.
pub fn is_declared_first_level(name: &str) -> bool {
    let trimmed = name.trim().trim_matches('/');
    !trimmed.is_empty()
        && NIMI_DATA_DIRECTORY_MATRIX
            .iter()
            .any(|row| first_segment(row.path_template) == trimmed)
}

/// Look up the matrix row that defines the owner / cleanup authority of a
/// first-level `nimi_data` directory name.
///
/// Returns `None` for a name that is not a declared first-level directory.
/// For a directly-declared first-level directory this is its own row. For a
/// first-level container (`apps` / `accounts`) this returns the FIRST nested
/// row under it — the container's owner is governed by its nested rows, and
/// the first nested row's owner / cleanup classification is the conservative
/// authority a container-level cleanup must obey (an `apps_releases` /
/// `apps_data` / `accounts_data` row is `ConfirmRequired`, so a container
/// cleanup is correctly confirmation-gated).
pub fn first_level_row(name: &str) -> Option<&'static NimiDataDirectoryRow> {
    let trimmed = name.trim().trim_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    // Prefer an exact directly-declared first-level row.
    if let Some(row) = NIMI_DATA_DIRECTORY_MATRIX
        .iter()
        .find(|row| row.first_level && first_segment(row.path_template) == trimmed)
    {
        return Some(row);
    }
    // Otherwise resolve a first-level container to its first nested row.
    NIMI_DATA_DIRECTORY_MATRIX
        .iter()
        .find(|row| first_segment(row.path_template) == trimmed)
}
