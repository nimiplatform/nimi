use super::*;

    fn temp_dir(label: &str) -> tempfile::TempDir {
        tempfile::Builder::new()
            .prefix(format!("nimi-bundle-{label}-").as_str())
            .tempdir()
            .expect("tempdir")
    }

    #[test]
    fn scan_bundle_directory_collects_files_entry_and_mmproj() {
        let dir = temp_dir("scan-ok");
        std::fs::write(dir.path().join("model.gguf"), b"weights").expect("write model");
        std::fs::write(dir.path().join("mmproj-BF16.gguf"), b"mmproj").expect("write mmproj");
        std::fs::create_dir_all(dir.path().join("nested")).expect("create nested");
        std::fs::write(dir.path().join("nested").join("readme.txt"), b"note").expect("write note");

        let scan = scan_bundle_directory(dir.path()).expect("scan");
        assert_eq!(
            scan.files,
            vec![
                "mmproj-BF16.gguf".to_string(),
                "model.gguf".to_string(),
                "nested/readme.txt".to_string()
            ]
        );
        assert_eq!(scan.entry_candidates, vec!["model.gguf".to_string()]);
        assert_eq!(scan.mmproj_candidates, vec!["mmproj-BF16.gguf".to_string()]);
    }

    #[test]
    fn scan_bundle_directory_ignores_metadata_sidecars() {
        let dir = temp_dir("scan-ignore-metadata");
        std::fs::write(dir.path().join("model.gguf"), b"weights").expect("write model");
        std::fs::write(dir.path().join("._model.gguf"), b"metadata").expect("write sidecar");
        std::fs::write(dir.path().join(".DS_Store"), b"finder").expect("write ds_store");
        std::fs::create_dir_all(dir.path().join("__MACOSX")).expect("create __MACOSX");
        std::fs::write(
            dir.path().join("__MACOSX").join("._nested.gguf"),
            b"nested-metadata",
        )
        .expect("write nested sidecar");

        let scan = scan_bundle_directory(dir.path()).expect("scan");
        assert_eq!(scan.files, vec!["model.gguf".to_string()]);
        assert_eq!(scan.entry_candidates, vec!["model.gguf".to_string()]);
        assert!(scan.mmproj_candidates.is_empty());
    }

    #[test]
    fn copy_bundle_directory_skips_metadata_sidecars() {
        let source = temp_dir("copy-ignore-src");
        let dest = temp_dir("copy-ignore-dst");
        std::fs::write(source.path().join("model.gguf"), b"weights").expect("write model");
        std::fs::write(source.path().join("._model.gguf"), b"metadata").expect("write sidecar");
        std::fs::create_dir_all(source.path().join("__MACOSX")).expect("create __MACOSX");
        std::fs::write(
            source.path().join("__MACOSX").join("._nested.gguf"),
            b"nested-metadata",
        )
        .expect("write nested sidecar");

        copy_bundle_directory(source.path(), dest.path()).expect("copy");

        assert!(dest.path().join("model.gguf").exists());
        assert!(!dest.path().join("._model.gguf").exists());
        assert!(!dest.path().join("__MACOSX").exists());
    }

    #[test]
    fn require_single_entry_candidate_rejects_ambiguous_bundle() {
        let scan = BundleScan {
            files: vec!["a.gguf".to_string(), "b.gguf".to_string()],
            entry_candidates: vec!["a.gguf".to_string(), "b.gguf".to_string()],
            mmproj_candidates: Vec::new(),
        };
        let error = require_single_entry_candidate(&scan).expect_err("ambiguous");
        assert!(error.contains("LOCAL_AI_BUNDLE_IMPORT_ENTRY_AMBIGUOUS"));
    }

    #[test]
    fn resolve_scaffolded_mmproj_rejects_multiple_candidates() {
        let scan = BundleScan {
            files: vec![
                "model.gguf".to_string(),
                "mmproj-A.gguf".to_string(),
                "mmproj-B.gguf".to_string(),
            ],
            entry_candidates: vec!["model.gguf".to_string()],
            mmproj_candidates: vec!["mmproj-A.gguf".to_string(), "mmproj-B.gguf".to_string()],
        };
        let error = resolve_scaffolded_mmproj(&scan).expect_err("ambiguous mmproj");
        assert!(error.contains("LOCAL_AI_BUNDLE_IMPORT_MMPROJ_AMBIGUOUS"));
    }

    #[test]
    fn scaffold_bundle_manifest_sets_mmproj_engine_config() {
        let dir = temp_dir("manifest");
        let manifest_path = dir.path().join("asset.manifest.json");
        let scan = BundleScan {
            files: vec!["model.gguf".to_string(), "mmproj-BF16.gguf".to_string()],
            entry_candidates: vec!["model.gguf".to_string()],
            mmproj_candidates: vec!["mmproj-BF16.gguf".to_string()],
        };
        let manifest = scaffold_bundle_manifest(
            &manifest_path,
            "gemma-4",
            &["chat".to_string()],
            "llama",
            "http://127.0.0.1:8077/v1",
            &scan,
        )
        .expect("scaffold");
        let llama = manifest
            .get("engine_config")
            .and_then(|value| value.get("llama"))
            .and_then(|value| value.get("mmproj"))
            .and_then(|value| value.as_str())
            .unwrap_or("");
        assert_eq!(llama, "resolved/nimi/local-import-gemma-4/mmproj-BF16.gguf");
    }

    #[test]
    fn normalize_existing_manifest_updates_files_and_mmproj() {
        let dir = temp_dir("normalize");
        let manifest_path = dir.path().join("asset.manifest.json");
        std::fs::write(
            &manifest_path,
            serde_json::json!({
                "schemaVersion": "1.0.0",
                "asset_id": "local-import/gemma-4",
                "kind": "chat",
                "logical_model_id": "nimi/gemma-4",
                "capabilities": ["chat"],
                "engine": "llama",
                "entry": "model.gguf",
                "files": ["model.gguf"],
                "license": "unknown",
                "source": { "repo": "file:///tmp/asset.manifest.json", "revision": "local" },
                "integrity_mode": "local_unverified",
                "hashes": {}
            })
            .to_string(),
        )
        .expect("write manifest");
        let scan = BundleScan {
            files: vec!["model.gguf".to_string(), "mmproj-BF16.gguf".to_string()],
            entry_candidates: vec!["model.gguf".to_string()],
            mmproj_candidates: vec!["mmproj-BF16.gguf".to_string()],
        };
        let identity = BundleManifestIdentity {
            asset_id: "local-import/gemma-4".to_string(),
            logical_model_id: "nimi/gemma-4".to_string(),
            kind: LocalAiAssetKind::Chat,
            engine: "llama".to_string(),
            entry: "model.gguf".to_string(),
        };
        let normalized = normalize_existing_manifest_object(
            &manifest_path,
            &manifest_path,
            &scan,
            &identity,
            true,
        )
        .expect("normalize");
        assert_eq!(
            normalized
                .get("files")
                .and_then(|value| value.as_array())
                .map(|items| items.len())
                .unwrap_or_default(),
            2
        );
        let mmproj = normalized
            .get("engine_config")
            .and_then(|value| value.get("llama"))
            .and_then(|value| value.get("mmproj"))
            .and_then(|value| value.as_str())
            .unwrap_or("");
        assert_eq!(mmproj, "resolved/nimi/gemma-4/mmproj-BF16.gguf");
    }

    #[test]
    fn scaffold_manifest_from_record_preserves_explicit_mmproj_selection() {
        let dir = temp_dir("scaffold-record-mmproj");
        let manifest_path = dir.path().join("asset.manifest.json");
        let scan = BundleScan {
            files: vec![
                "model.gguf".to_string(),
                "mmproj-A.gguf".to_string(),
                "mmproj-B.gguf".to_string(),
            ],
            entry_candidates: vec!["model.gguf".to_string()],
            mmproj_candidates: vec!["mmproj-A.gguf".to_string(), "mmproj-B.gguf".to_string()],
        };
        let record = LocalAiAssetRecord {
            local_asset_id: "asset-local-1".to_string(),
            asset_id: "local-import/gemma-4".to_string(),
            kind: LocalAiAssetKind::Chat,
            capabilities: vec!["chat".to_string(), "text.generate.vision".to_string()],
            logical_model_id: "nimi/gemma-4".to_string(),
            engine: "llama".to_string(),
            entry: "model.gguf".to_string(),
            files: scan.files.clone(),
            license: "unknown".to_string(),
            source: LocalAiAssetSource {
                repo: "file:///tmp/asset.manifest.json".to_string(),
                revision: "local".to_string(),
            },
            integrity_mode: Some(LocalAiIntegrityMode::LocalUnverified),
            hashes: std::collections::HashMap::new(),
            tags: vec![],
            known_total_size_bytes: None,
            endpoint: "http://127.0.0.1:8077/v1".to_string(),
            status: LocalAiAssetStatus::Installed,
            installed_at: String::new(),
            updated_at: String::new(),
            health_detail: None,
            artifact_roles: vec![],
            preferred_engine: None,
            fallback_engines: vec![],
            engine_config: Some(serde_json::json!({
                "llama": {
                    "mmproj": "resolved/nimi/gemma-4/mmproj-B.gguf",
                    "threads": 8
                }
            })),
            recommendation: None,
            metadata: None,
        };

        let manifest = scaffold_manifest_from_record(&manifest_path, &record, &scan)
            .expect("scaffold manifest");
        let engine_config = manifest
            .get("engine_config")
            .and_then(|value| value.as_object())
            .expect("engine_config object");
        let llama = engine_config
            .get("llama")
            .and_then(|value| value.as_object())
            .expect("llama config object");
        assert_eq!(
            llama.get("mmproj").and_then(|value| value.as_str()),
            Some("resolved/nimi/gemma-4/mmproj-B.gguf")
        );
        assert_eq!(
            llama.get("threads").and_then(|value| value.as_i64()),
            Some(8)
        );
    }
