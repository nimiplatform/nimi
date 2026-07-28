//! `nimi_data` directory ownership matrix — `P-MIG-006`.
//!
//! Spec authority:
//! `.nimi/spec/platform/product-lifecycle.authority.yaml`
//! `definition.nimi.platform.product-lifecycle.nimi-data-ownership` and the
//! `P-MIG-006` rules. Host input projection:
//! `config/platform-nimi-data-directory-ownership.yaml`.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DirectoryOwner {
    RuntimeModelMaterializer,
    RuntimeDependencyMaterializer,
    RuntimeEnvironmentMaterializer,
    AppPackageInstaller,
    App,
    AccountDataPlaneConsumers,
    UserExportFlow,
    RuntimeProductSupport,
    RuntimeRealmProductAudit,
}

impl DirectoryOwner {
    pub const fn owner_id(self) -> &'static str {
        match self {
            Self::RuntimeModelMaterializer => "runtime_model_materializer",
            Self::RuntimeDependencyMaterializer => "runtime_dependency_materializer",
            Self::RuntimeEnvironmentMaterializer => "runtime_environment_materializer",
            Self::AppPackageInstaller => "app_package_installer",
            Self::App => "app",
            Self::AccountDataPlaneConsumers => "account_data_plane_consumers",
            Self::UserExportFlow => "user_export_flow",
            Self::RuntimeProductSupport => "runtime_product_support",
            Self::RuntimeRealmProductAudit => "runtime_realm_product_audit",
        }
    }

    pub const fn is_runtime_owned(self) -> bool {
        matches!(
            self,
            Self::RuntimeModelMaterializer
                | Self::RuntimeDependencyMaterializer
                | Self::RuntimeEnvironmentMaterializer
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CleanupClass {
    PureCache,
    RuntimeManaged,
    ConfirmRequired,
    UserManaged,
}

impl CleanupClass {
    pub const fn requires_confirmation(self) -> bool {
        !matches!(self, Self::PureCache)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct NimiDataDirectoryRow {
    pub directory_id: &'static str,
    pub path_template: &'static str,
    pub first_level: bool,
    pub owner: DirectoryOwner,
    pub cleanup: CleanupClass,
}

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
];

fn first_segment(path_template: &'static str) -> &'static str {
    path_template
        .trim_start_matches("<nimi_data>/")
        .split('/')
        .next()
        .unwrap_or("")
}

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

pub fn is_declared_first_level(name: &str) -> bool {
    let trimmed = name.trim().trim_matches('/');
    !trimmed.is_empty()
        && NIMI_DATA_DIRECTORY_MATRIX
            .iter()
            .any(|row| first_segment(row.path_template) == trimmed)
}

pub fn first_level_row(name: &str) -> Option<&'static NimiDataDirectoryRow> {
    let trimmed = name.trim().trim_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    if let Some(row) = NIMI_DATA_DIRECTORY_MATRIX
        .iter()
        .find(|row| row.first_level && first_segment(row.path_template) == trimmed)
    {
        return Some(row);
    }
    NIMI_DATA_DIRECTORY_MATRIX
        .iter()
        .find(|row| first_segment(row.path_template) == trimmed)
}
