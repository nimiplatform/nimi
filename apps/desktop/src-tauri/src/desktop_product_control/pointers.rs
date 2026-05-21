//! Resolution of the three non-owner discovery pointers recorded in the
//! `nimi.json` `pointers` block. Each pointer is a discoverability path, not
//! product readiness truth.

use super::paths::runtime_config_path;
use super::record::ProductPointersRecord;

/// Regenerate the installed factory profile catalog projection and return its
/// absolute path for the `pointers.factoryProfileIndex` discovery pointer.
///
/// The projection is a deterministic read-only derivation of the packaged
/// Platform factory catalog (`factory_profile_index.rs`). It is regenerated
/// here so the pointer never advertises a stale or missing file. It is NOT the
/// Account Default Profile and this call never touches account-scoped records.
fn ensure_factory_profile_index_pointer() -> Result<String, String> {
    Ok(crate::factory_profile_index::ensure_factory_profile_index()?.path)
}

/// Resolve the three non-owner discovery pointers recorded in `nimi.json`
/// `pointers`. Each is a discoverability path, not product readiness truth:
/// - `runtime_config_path`: `~/.nimi/runtime/config.json` (Runtime-owned);
/// - `factory_profile_index`: regenerated factory profile catalog projection;
/// - `app_registry`: regenerated `~/.nimi/apps/registry.json` projection
///   (`apps_registry_projection.rs`), a catalog-only derivation;
/// - `app_packages`: the `~/.nimi/apps/packages.json` path
///   (`apps_packages_projection.rs`); the file is materialized on demand by
///   the Apps bridge projection seam, so only the path is advertised here.
pub(crate) fn resolve_product_pointers() -> Result<ProductPointersRecord, String> {
    Ok(ProductPointersRecord {
        runtime_config_path: Some(runtime_config_path()?),
        factory_profile_index: Some(ensure_factory_profile_index_pointer()?),
        app_registry: Some(crate::apps_registry_projection::ensure_apps_registry()?.path),
        app_packages: Some(
            crate::apps_packages_projection::apps_packages_path()?
                .display()
                .to_string(),
        ),
    })
}
