#[cfg(test)]
mod runtime_mod_catalog_tests {
    use super::*;
    use std::collections::HashMap;

    fn base_state() -> CatalogStatePayload {
        CatalogStatePayload {
            listed: true,
            yanked: false,
            quarantined: false,
        }
    }

    fn base_publisher(trust_tier: &str) -> CatalogPublisherPayload {
        CatalogPublisherPayload {
            publisher_id: "nimi".to_string(),
            display_name: "Nimi".to_string(),
            trust_tier: trust_tier.to_string(),
        }
    }

    fn base_signer() -> CatalogSignerPayload {
        CatalogSignerPayload {
            signer_id: "nimi.release".to_string(),
            algorithm: "ed25519".to_string(),
            public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=".to_string(),
        }
    }

    fn base_package(trust_tier: &str) -> CatalogPackageRecordPayload {
        CatalogPackageRecordPayload {
            package_id: "world.nimi.demo".to_string(),
            package_type: "desktop-mod".to_string(),
            name: "Demo".to_string(),
            description: "Demo".to_string(),
            publisher: base_publisher(trust_tier),
            state: base_state(),
            channels: HashMap::new(),
            keywords: Vec::new(),
            tags: Vec::new(),
            signers: vec![base_signer()],
            releases: Vec::new(),
        }
    }

    fn base_release(trust_tier: &str) -> CatalogReleaseRecordPayload {
        CatalogReleaseRecordPayload {
            package_type: "desktop-mod".to_string(),
            package_id: "world.nimi.demo".to_string(),
            version: "1.1.0".to_string(),
            channel: "stable".to_string(),
            artifact_url: "https://example.com/demo.zip".to_string(),
            sha256: "a".repeat(64),
            signature: "sig".to_string(),
            signer_id: "nimi.release".to_string(),
            min_desktop_version: "0.1.0".to_string(),
            min_hook_api_version: "v1".to_string(),
            capabilities: vec!["ui.register.ui-extension.app.sidebar.mods".to_string()],
            requires_reconsent_on_capability_increase: false,
            publisher: base_publisher(trust_tier),
            source: CatalogReleaseSourcePayload {
                repo_url: "https://github.com/nimiplatform/nimi-mods".to_string(),
                release_tag: "v1.1.0".to_string(),
            },
            state: base_state(),
            app_mode: None,
            scope_catalog_version: None,
            min_runtime_version: None,
        }
    }

    fn installed_summary_with(trust_tier: &str, capabilities: &[&str]) -> RuntimeLocalManifestSummary {
        RuntimeLocalManifestSummary {
            path: "/mods/world.nimi.demo/mod.manifest.yaml".to_string(),
            id: "world.nimi.demo".to_string(),
            source_id: None,
            source_type: Some("installed".to_string()),
            source_dir: None,
            name: Some("Demo".to_string()),
            version: Some("1.0.0".to_string()),
            entry: None,
            entry_path: None,
            styles: None,
            style_paths: None,
            description: None,
            manifest: Some(serde_json::json!({
                "capabilities": capabilities
            })),
            release_manifest: Some(serde_json::json!({
                "publisher": {
                    "trustTier": trust_tier
                }
            })),
        }
    }

    #[test]
    fn compare_semver_like_orders_versions() {
        assert!(compare_semver_like("0.1.0", "0.2.0").is_lt());
        assert!(compare_semver_like("1.0.0", "1.0.0").is_eq());
        assert!(compare_semver_like("1.2.0", "1.1.9").is_gt());
    }

    #[test]
    fn trust_tier_default_auto_update_is_stable_only() {
        assert!(trust_tier_default_auto_update("official", "stable"));
        assert!(trust_tier_default_auto_update("verified", "stable"));
        assert!(!trust_tier_default_auto_update("verified", "beta"));
        assert!(!trust_tier_default_auto_update("community", "stable"));
    }

    #[test]
    fn evaluate_catalog_consent_reports_capability_increase_and_advisories() {
        let package = base_package("official");
        let mut release = base_release("official");
        release.capabilities.push("runtime.execute".to_string());
        release.requires_reconsent_on_capability_increase = true;
        let installed_summary =
            installed_summary_with("official", &["ui.register.ui-extension.app.sidebar.mods"]);

        let consent = evaluate_catalog_consent(
            &package,
            &release,
            &["ADV-1".to_string()],
            Some(&installed_summary),
        );

        assert!(consent.requires_user_consent);
        assert_eq!(
            consent.consent_reasons,
            vec!["advisory-review".to_string(), "capability-increase".to_string()]
        );
        assert_eq!(consent.added_capabilities, vec!["runtime.execute".to_string()]);
    }

    #[test]
    fn evaluate_catalog_consent_detects_trust_tier_downgrade() {
        let package = base_package("verified");
        let release = base_release("verified");
        let installed_summary =
            installed_summary_with("official", &["ui.register.ui-extension.app.sidebar.mods"]);

        let consent = evaluate_catalog_consent(&package, &release, &[], Some(&installed_summary));
        assert!(consent.requires_user_consent);
        assert_eq!(consent.consent_reasons, vec!["trust-tier-downgrade".to_string()]);
        assert!(consent.added_capabilities.is_empty());
    }

    #[test]
    fn validate_catalog_release_rejects_revoked_package() {
        let package = base_package("official");
        let release = base_release("official");
        let revocations = CatalogRevocationsPayload {
            items: vec![CatalogRevocationRecordPayload {
                scope: "package".to_string(),
                target_id: release.package_id.clone(),
                reason: "compromised".to_string(),
            }],
        };
        let advisories = CatalogAdvisoriesPayload { items: Vec::new() };
        let error = validate_catalog_release(&package, &release, &revocations, &advisories)
            .expect_err("revoked package should fail");
        assert!(error.contains("撤销列表"));
    }

    #[test]
    fn validate_catalog_release_rejects_blocked_advisory() {
        let package = base_package("official");
        let release = base_release("official");
        let revocations = CatalogRevocationsPayload { items: Vec::new() };
        let advisories = CatalogAdvisoriesPayload {
            items: vec![CatalogAdvisoryRecordPayload {
                advisory_id: "ADV-1".to_string(),
                package_id: release.package_id.clone(),
                version: Some(release.version.clone()),
                action: "block".to_string(),
                severity: "high".to_string(),
                title: "Blocked".to_string(),
                summary: "Blocked release".to_string(),
            }],
        };
        let error = validate_catalog_release(&package, &release, &revocations, &advisories)
            .expect_err("blocked advisory should fail");
        assert!(error.contains("阻断公告"));
    }

    #[test]
    fn validate_catalog_release_rejects_incompatible_desktop_version() {
        let package = base_package("official");
        let mut release = base_release("official");
        release.min_desktop_version = "9.9.9".to_string();
        let error = validate_catalog_release(
            &package,
            &release,
            &CatalogRevocationsPayload { items: Vec::new() },
            &CatalogAdvisoriesPayload { items: Vec::new() },
        )
        .expect_err("incompatible desktop version should fail");
        assert!(error.contains("Desktop 版本不兼容"));
    }

    #[test]
    fn validate_catalog_release_rejects_unknown_signer() {
        let mut package = base_package("official");
        package.signers = Vec::new();
        let release = base_release("official");
        let error = validate_catalog_release(
            &package,
            &release,
            &CatalogRevocationsPayload { items: Vec::new() },
            &CatalogAdvisoriesPayload { items: Vec::new() },
        )
        .expect_err("unknown signer should fail");
        assert!(error.contains("未找到 signer"));
    }

    #[test]
    fn validate_catalog_release_rejects_invalid_signature_payload() {
        let package = base_package("official");
        let mut release = base_release("official");
        release.signature = "not-base64".to_string();
        let error = validate_catalog_release(
            &package,
            &release,
            &CatalogRevocationsPayload { items: Vec::new() },
            &CatalogAdvisoriesPayload { items: Vec::new() },
        )
        .expect_err("invalid signature should fail");
        assert!(error.contains("signature"));
    }
}
