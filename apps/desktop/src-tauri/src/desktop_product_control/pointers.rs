//! Resolution of the three non-owner discovery pointers recorded in the
//! `nimi.json` `pointers` block. Each pointer is a discoverability path, not
//! product readiness truth.

use super::paths::runtime_config_path;
use super::record::ProductPointersRecord;

/// Resolve the three non-owner discovery pointers recorded in `nimi.json`
/// `pointers`. Each is a discoverability path, not product readiness truth:
/// - `runtime_config_path`: `~/.nimi/runtime/config.json` (Runtime-owned);
/// - `factory_profile_index`: installed factory profile catalog projection path;
/// - `app_registry`: installed `~/.nimi/apps/registry.json` projection path;
/// - `app_packages`: the `~/.nimi/apps/packages.json` path
///   (`apps_packages_projection.rs`); Runtime `GetAppPackageReadiness` owns
///   package readiness, so only the discoverability path is advertised here.
///
/// Pointer resolution must not materialize or repair governed projection files;
/// the Kit materializer does that only at the projection consumer boundary.
pub(crate) fn resolve_product_pointers() -> Result<ProductPointersRecord, String> {
    Ok(ProductPointersRecord {
        runtime_config_path: Some(runtime_config_path()?),
        factory_profile_index: Some(
            crate::factory_profile_index::factory_profile_index_path()?
                .display()
                .to_string(),
        ),
        app_registry: Some(
            crate::apps_registry_projection::apps_registry_path()?
                .display()
                .to_string(),
        ),
        app_packages: Some(
            crate::apps_packages_projection::apps_packages_path()?
                .display()
                .to_string(),
        ),
    })
}
