#[cfg(test)]
mod tests {
    use super::{
        aggregate_progress, build_hf_download_url, build_manifest_from_install_request,
        control_to_error, hf_download_base_url, is_disk_full_io_error, is_hf_repo,
        normalize_expected_hash, normalize_hf_repo_slug, normalize_install_files,
        normalize_relative_file_path, resolve_expected_file_hash, sha256_hex,
        sha256_hex_streaming, HfDownloadControl,
    };
    use crate::local_runtime::types::LocalAiInstallRequest;
    use std::io::Write;

    #[test]
    fn hf_repo_detection_accepts_hf_protocol_and_urls() {
        assert!(is_hf_repo("hf://meta-llama/Llama-3.1-8B-Instruct"));
        assert!(is_hf_repo(
            "https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct"
        ));
        assert!(is_hf_repo("meta-llama/Llama-3.1-8B-Instruct"));
        assert!(!is_hf_repo("https://example.com/model.bin"));
        assert!(!is_hf_repo(""));
    }

    #[test]
    fn normalize_hf_repo_slug_extracts_org_and_model() {
        assert_eq!(
            normalize_hf_repo_slug("hf://meta-llama/Llama-3.1-8B-Instruct"),
            Some("meta-llama/Llama-3.1-8B-Instruct".to_string())
        );
        assert_eq!(
            normalize_hf_repo_slug(
                "https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct/resolve/main/model.gguf"
            ),
            Some("meta-llama/Llama-3.1-8B-Instruct".to_string())
        );
        assert_eq!(normalize_hf_repo_slug(""), None);
    }

    #[test]
    fn hf_download_url_uses_revision_and_entry_path() {
        let url = build_hf_download_url("meta-llama/Llama-3.1-8B-Instruct", "main", "model.gguf");
        let base = hf_download_base_url();
        assert_eq!(
            url,
            format!("{base}/meta-llama/Llama-3.1-8B-Instruct/resolve/main/model.gguf")
        );
    }

    #[test]
    fn normalize_install_files_uses_multifile_and_keeps_entry_first() {
        let request = LocalAiInstallRequest {
            model_id: "m".to_string(),
            repo: "hf://org/model".to_string(),
            revision: None,
            capabilities: None,
            engine: None,
            entry: Some("weights/model.safetensors".to_string()),
            files: Some(vec![
                "config.json".to_string(),
                "weights/model.safetensors".to_string(),
                "tokenizer.json".to_string(),
                "config.json".to_string(),
            ]),
            license: None,
            hashes: None,
            endpoint: None,
            provider_hints: None,
        };

        let (entry, files) = normalize_install_files(&request).expect("normalized files");
        assert_eq!(entry, "weights/model.safetensors");
        assert_eq!(files[0], "weights/model.safetensors");
        assert_eq!(files.len(), 3);
    }

    #[test]
    fn resolve_expected_file_hash_reads_exact_key() {
        let mut hashes = std::collections::HashMap::new();
        hashes.insert("a.bin".to_string(), "sha256:abc123".to_string());
        let request = LocalAiInstallRequest {
            model_id: "m".to_string(),
            repo: "hf://org/model".to_string(),
            revision: None,
            capabilities: None,
            engine: None,
            entry: Some("a.bin".to_string()),
            files: Some(vec!["a.bin".to_string()]),
            license: None,
            hashes: Some(hashes),
            endpoint: None,
            provider_hints: None,
        };
        assert_eq!(
            resolve_expected_file_hash(&request, "a.bin"),
            Some("abc123".to_string())
        );
    }

    #[test]
    fn build_manifest_from_install_request_writes_multifile_hashes() {
        let request = LocalAiInstallRequest {
            model_id: "hf:test/model".to_string(),
            repo: "hf://test/model".to_string(),
            revision: Some("main".to_string()),
            capabilities: Some(vec!["tts".to_string()]),
            engine: Some("localai".to_string()),
            entry: Some("model.safetensors".to_string()),
            files: Some(vec![
                "model.safetensors".to_string(),
                "config.json".to_string(),
            ]),
            license: Some("apache-2.0".to_string()),
            hashes: None,
            endpoint: None,
            provider_hints: None,
        };
        let hashes = std::collections::HashMap::from([
            ("model.safetensors".to_string(), "sha256:111".to_string()),
            ("config.json".to_string(), "sha256:222".to_string()),
        ]);
        let manifest = build_manifest_from_install_request(
            &request,
            "model.safetensors",
            &vec!["model.safetensors".to_string(), "config.json".to_string()],
            &hashes,
        )
        .expect("manifest");

        assert_eq!(manifest.entry, "model.safetensors");
        assert_eq!(manifest.files.len(), 2);
        assert_eq!(
            manifest.hashes.get("config.json"),
            Some(&"sha256:222".to_string())
        );
    }

    #[test]
    fn aggregate_progress_merges_file_progress_into_session_totals() {
        let progress = super::HfDownloadProgress {
            phase: "download".to_string(),
            bytes_received: 200,
            bytes_total: Some(500),
            speed_bytes_per_sec: None,
            eta_seconds: None,
            message: None,
        };
        let (bytes_received, bytes_total) = aggregate_progress(100, Some(1000), &progress);
        assert_eq!(bytes_received, 300);
        assert_eq!(bytes_total, Some(1000));

        let (dynamic_received, dynamic_total) = aggregate_progress(100, None, &progress);
        assert_eq!(dynamic_received, 300);
        assert_eq!(dynamic_total, Some(600));
    }

    // --- K-LOCAL-026 normalize_relative_file_path ---

    #[test]
    fn normalize_relative_file_path_rejects_absolute_path() {
        let result = normalize_relative_file_path("/etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("absolute path"));
    }

    #[test]
    fn normalize_relative_file_path_rejects_parent_traversal() {
        let result = normalize_relative_file_path("../../../etc");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("parent traversal"));
    }

    #[test]
    fn normalize_relative_file_path_converts_backslash() {
        assert_eq!(
            normalize_relative_file_path("subdir\\model.bin"),
            Ok("subdir/model.bin".to_string())
        );
    }

    #[test]
    fn normalize_relative_file_path_rejects_empty() {
        let result = normalize_relative_file_path("");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[test]
    fn normalize_relative_file_path_accepts_nested() {
        assert_eq!(
            normalize_relative_file_path("speech_tokenizer/model.safetensors"),
            Ok("speech_tokenizer/model.safetensors".to_string())
        );
    }

    // --- K-LOCAL-024 normalize_expected_hash ---

    #[test]
    fn normalize_expected_hash_strips_sha256_prefix() {
        assert_eq!(normalize_expected_hash("sha256:ABC123"), "abc123");
    }

    #[test]
    fn normalize_expected_hash_handles_plain_hex() {
        assert_eq!(normalize_expected_hash("  abc123  "), "abc123");
    }

    // --- download URL ---

    #[test]
    fn build_hf_download_url_encodes_spaces() {
        let url = build_hf_download_url("org/model", "main", "my model.gguf");
        assert!(url.contains("my%20model.gguf"));
        let base = hf_download_base_url();
        assert!(url.starts_with(&base));
    }

    // --- hf_download_base_url ---

    #[test]
    fn hf_download_base_url_returns_valid_https_url() {
        let base = hf_download_base_url();
        assert!(
            base.starts_with("https://") || base.starts_with("http://"),
            "base URL must start with https:// or http://, got: {base}"
        );
        assert!(
            !base.ends_with('/'),
            "base URL must not end with trailing slash, got: {base}"
        );
    }

    // --- sha256_hex_streaming ---

    #[test]
    fn sha256_hex_streaming_matches_sha256_hex_for_same_content() {
        let content = b"hello world test content for streaming sha256 verification";
        let expected = sha256_hex(content);

        let dir = std::env::temp_dir().join("nimi-test-sha256-streaming");
        let _ = std::fs::create_dir_all(&dir);
        let file_path = dir.join("test-sha256.bin");
        {
            let mut file = std::fs::File::create(&file_path).expect("create temp file");
            file.write_all(content).expect("write temp file");
        }

        let streaming_result = sha256_hex_streaming(&file_path).expect("streaming hash");
        assert_eq!(streaming_result, expected);

        let _ = std::fs::remove_file(&file_path);
        let _ = std::fs::remove_dir(&dir);
    }

    #[test]
    fn sha256_hex_streaming_handles_empty_file() {
        let expected = sha256_hex(b"");

        let dir = std::env::temp_dir().join("nimi-test-sha256-empty");
        let _ = std::fs::create_dir_all(&dir);
        let file_path = dir.join("empty.bin");
        std::fs::File::create(&file_path).expect("create empty file");

        let streaming_result = sha256_hex_streaming(&file_path).expect("streaming hash");
        assert_eq!(streaming_result, expected);

        let _ = std::fs::remove_file(&file_path);
        let _ = std::fs::remove_dir(&dir);
    }

    #[test]
    fn sha256_hex_streaming_returns_error_for_missing_file() {
        let result = sha256_hex_streaming(std::path::Path::new("/nonexistent/path/file.bin"));
        assert!(result.is_err());
    }

    // --- retry / timeout constants ---

    #[test]
    fn hf_retry_backoff_has_eight_entries() {
        assert_eq!(super::HF_RETRY_BACKOFF_MS.len(), 8);
        assert_eq!(super::HF_RETRY_BACKOFF_MS[0], 300);
        assert_eq!(super::HF_RETRY_BACKOFF_MS[7], 180_000);
    }

    #[test]
    fn control_to_error_maps_pause_and_cancel() {
        assert!(control_to_error(HfDownloadControl::Continue).is_none());
        let pause = control_to_error(HfDownloadControl::Pause).unwrap_or_default();
        assert!(pause.starts_with("LOCAL_AI_HF_DOWNLOAD_PAUSED"));
        let cancel = control_to_error(HfDownloadControl::Cancel).unwrap_or_default();
        assert!(cancel.starts_with("LOCAL_AI_HF_DOWNLOAD_CANCELLED"));
    }

    #[test]
    fn disk_full_error_detection_matches_common_errno() {
        let err_unix = std::io::Error::from_raw_os_error(28);
        assert!(is_disk_full_io_error(&err_unix));
        let err_windows = std::io::Error::from_raw_os_error(112);
        assert!(is_disk_full_io_error(&err_windows));
        let other = std::io::Error::from_raw_os_error(5);
        assert!(!is_disk_full_io_error(&other));
    }
}
