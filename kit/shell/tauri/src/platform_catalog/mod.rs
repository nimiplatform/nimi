//! Packaged Platform catalog projections for Rust host consumers.
//!
//! The canonical row sources live under `config/platform-*.yaml`.
//! This module exposes generated, read-only projections for Tauri host code that
//! must materialize or verify local Platform projections.

pub mod ai_profile_factory;

#[cfg(test)]
mod tests {
    use super::ai_profile_factory::{
        resolve_factory_ai_profile_alias, PLATFORM_AI_PROFILE_FACTORY_ROWS,
    };

    #[test]
    fn ai_profile_factory_projection_resolves_admitted_aliases() {
        assert_eq!(
            resolve_factory_ai_profile_alias("local-speech")
                .expect("local speech row")
                .source_rule,
            "P-AIPS-002"
        );
        assert!(resolve_factory_ai_profile_alias(" local-speech ").is_some());
        assert!(resolve_factory_ai_profile_alias("").is_none());
        assert!(resolve_factory_ai_profile_alias("missing").is_none());
        let removed_alias = ["local", "speech", "ready"].join("-");
        assert!(resolve_factory_ai_profile_alias(&removed_alias).is_none());
    }

    #[test]
    fn ai_profile_factory_projection_is_the_closed_portable_catalog() {
        assert_eq!(
            PLATFORM_AI_PROFILE_FACTORY_ROWS
                .iter()
                .map(|row| row.alias)
                .collect::<Vec<_>>(),
            vec![
                "cloud-first",
                "local-standard",
                "local-speech",
                "local-gpu",
                "hybrid-recommended",
            ]
        );
        let speech = resolve_factory_ai_profile_alias("local-speech").expect("local speech row");
        assert_eq!(
            speech.capability_set,
            &["text.generate", "audio.transcribe", "audio.synthesize"]
        );
        assert_eq!(
            speech.applicable_scopes,
            &["first-party-app", "scope-bound-apply"]
        );
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
