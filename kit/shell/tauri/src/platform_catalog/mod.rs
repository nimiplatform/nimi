//! Packaged Platform catalog projections for Rust host consumers.
//!
//! The canonical row sources live under `config/platform-*.yaml`.
//! This module exposes generated, read-only projections for Tauri host code that
//! must materialize or verify local Platform projections.

pub mod ai_profile_factory;
pub mod nimi_app_registry;

#[cfg(test)]
mod tests {
    use super::ai_profile_factory::{
        resolve_factory_ai_profile_alias, verify_first_run_factory_ai_profile,
        PLATFORM_AI_PROFILE_FACTORY_ROWS,
    };

    #[test]
    fn ai_profile_factory_projection_resolves_admitted_aliases() {
        assert_eq!(
            resolve_factory_ai_profile_alias("local-speech-ready")
                .expect("local speech row")
                .source_rule,
            "P-AIPS-002"
        );
        assert!(resolve_factory_ai_profile_alias(" local-speech-ready ").is_some());
        assert!(resolve_factory_ai_profile_alias("").is_none());
        assert!(resolve_factory_ai_profile_alias("missing").is_none());
    }

    #[test]
    fn first_run_verification_admits_only_local_install_level_baselines() {
        assert_eq!(
            verify_first_run_factory_ai_profile("local-speech-ready", "minimal")
                .expect("minimal baseline")
                .alias,
            "local-speech-ready"
        );
        assert_eq!(
            verify_first_run_factory_ai_profile("local-gpu", "recommended")
                .expect("recommended baseline")
                .alias,
            "local-gpu"
        );

        for alias in ["cloud-first", "hybrid-recommended", "local-standard"] {
            assert!(
                verify_first_run_factory_ai_profile(alias, "minimal").is_err(),
                "{alias} must not be an admitted local first-run baseline"
            );
        }
        assert!(verify_first_run_factory_ai_profile("local-gpu", "minimal").is_err());
        assert!(verify_first_run_factory_ai_profile("missing", "minimal").is_err());
    }

    #[test]
    fn generated_factory_rows_do_not_carry_provider_or_model_authority() {
        assert!(!PLATFORM_AI_PROFILE_FACTORY_ROWS.is_empty());
        for row in PLATFORM_AI_PROFILE_FACTORY_ROWS {
            assert_eq!(row.source_rule, "P-AIPS-002");
            assert!(row
                .local_compute_pack_refs
                .iter()
                .all(|value| !value.contains("model.")));
            assert!(row
                .dependency_family_refs
                .iter()
                .all(|value| !value.contains("provider.")));
        }
    }
}
