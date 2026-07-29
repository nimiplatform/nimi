use serde::Deserialize;
use std::sync::OnceLock;

pub const PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID: &str = "platform_ai_profile_factory_catalog";
pub const PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION: u32 = 1;
pub const PLATFORM_AI_PROFILE_SELECTION_POLICY_REF: &str = "P-AIPS-004";

#[derive(Debug, Clone, Deserialize)]
pub struct PlatformAIProfileFactoryRow {
    pub alias: String,
    pub privacy_posture: String,
    pub compute_posture: String,
    pub capability_set: Vec<String>,
    pub routing_policy: String,
    pub host_capability_profile_refs: Vec<String>,
    pub local_compute_pack_refs: Vec<String>,
    pub dependency_family_refs: Vec<String>,
    pub materialization_confirmation_required: bool,
    pub applicable_scopes: Vec<String>,
    pub first_run_install_levels: Vec<String>,
    pub source_rule: String,
}

#[derive(Debug, Deserialize)]
struct PlatformAIProfileFactoryCatalog {
    version: u32,
    catalog_id: String,
    profiles: Vec<PlatformAIProfileFactoryRow>,
}

static FACTORY_CATALOG: OnceLock<Result<PlatformAIProfileFactoryCatalog, String>> = OnceLock::new();

fn factory_catalog() -> Result<&'static PlatformAIProfileFactoryCatalog, String> {
    FACTORY_CATALOG
        .get_or_init(|| {
            let catalog: PlatformAIProfileFactoryCatalog = serde_yaml::from_str(include_str!(
                "../../../../config/platform-ai-profile-factory-catalog.yaml"
            ))
            .map_err(|error| format!("Platform AIProfile factory catalog is invalid: {error}"))?;
            if catalog.version != PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION
                || catalog.catalog_id != PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID
            {
                return Err(
                    "Platform AIProfile factory catalog identity or version is invalid".to_string(),
                );
            }
            Ok(catalog)
        })
        .as_ref()
        .map_err(Clone::clone)
}

pub fn resolve_factory_ai_profile_alias(
    alias: &str,
) -> Result<Option<&'static PlatformAIProfileFactoryRow>, String> {
    let normalized = alias.trim();
    if normalized.is_empty() {
        return Ok(None);
    }
    Ok(factory_catalog()?
        .profiles
        .iter()
        .find(|row| row.alias == normalized))
}

pub fn verify_first_run_factory_ai_profile(
    alias: &str,
    install_level: &str,
) -> Result<&'static PlatformAIProfileFactoryRow, String> {
    let normalized_level = install_level.trim();
    let Some(row) = resolve_factory_ai_profile_alias(alias)? else {
        return Err(format!(
            "selected aiProfileAlias is not admitted in Platform factory catalog: {}",
            alias.trim()
        ));
    };
    if !row
        .applicable_scopes
        .iter()
        .any(|scope| scope == "first-run")
    {
        return Err(format!(
            "aiProfileAlias is not admitted for first-run: {}",
            row.alias
        ));
    }
    if !row
        .first_run_install_levels
        .iter()
        .any(|level| level == normalized_level)
    {
        return Err(format!(
            "aiProfileAlias {} is not admitted for first-run install level {}",
            row.alias, normalized_level
        ));
    }
    if row.compute_posture == "cloud-only"
        || row.routing_policy == "cloud-first"
        || row.routing_policy == "hybrid-explicit"
        || row
            .capability_set
            .iter()
            .any(|capability| capability == "video.generate")
    {
        return Err(format!(
            "aiProfileAlias {} is not an admitted local first-run baseline",
            row.alias
        ));
    }
    Ok(row)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_first_run_rows_from_the_platform_catalog() {
        assert!(verify_first_run_factory_ai_profile("local-speech-ready", "minimal").is_ok());
        assert!(verify_first_run_factory_ai_profile("local-gpu", "recommended").is_ok());
        assert!(verify_first_run_factory_ai_profile("cloud-first", "minimal").is_err());
    }
}
