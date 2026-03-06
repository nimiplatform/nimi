fn reveal_path_in_os(path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("reveal failed: {e}"))?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| format!("reveal failed: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path.parent().unwrap_or(path))
            .spawn()
            .map_err(|e| format!("reveal failed: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{copy_and_hash_file, extract_reason_code, run_install_preflight_with};
    use crate::local_runtime::types::LocalAiInstallRequest;

    fn install_request_fixture(engine: Option<&str>) -> LocalAiInstallRequest {
        LocalAiInstallRequest {
            model_id: "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign".to_string(),
            repo: "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign".to_string(),
            revision: Some("main".to_string()),
            capabilities: Some(vec!["tts".to_string()]),
            engine: engine.map(|value| value.to_string()),
            entry: Some("model.safetensors".to_string()),
            files: None,
            license: Some("apache-2.0".to_string()),
            hashes: None,
            endpoint: Some("http://127.0.0.1:1234/v1".to_string()),
            provider_hints: None,
        }
    }

    #[test]
    fn install_preflight_runs_for_localai_engine() {
        let request = install_request_fixture(Some("localai"));
        let result = run_install_preflight_with(&request, |engine| {
            assert_eq!(engine, "localai");
            Err("LOCAL_AI_SERVICE_UNREACHABLE: service unreachable".to_string())
        });
        let error = result.expect_err("preflight error should bubble");
        assert!(error.contains("LOCAL_AI_SERVICE_UNREACHABLE"));
    }

    #[test]
    fn install_preflight_runs_for_explicit_engine() {
        let request = install_request_fixture(Some("localai"));
        let result = run_install_preflight_with(&request, |engine| {
            assert_eq!(engine, "localai");
            Ok(())
        });
        assert!(result.is_ok());
    }

    #[test]
    fn install_preflight_preserves_reason_code_prefix() {
        let reason = extract_reason_code("LOCAL_AI_PROVIDER_TIMEOUT: provider timeout");
        assert_eq!(reason, "LOCAL_AI_PROVIDER_TIMEOUT");
    }

    // --- copy_and_hash_file tests ---

    #[test]
    fn copy_and_hash_file_copies_content_and_produces_correct_sha256() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let src = tmp.path().join("source.gguf");
        let dst = tmp.path().join("dest.gguf");
        let content = b"hello world model data for sha256 test";
        std::fs::write(&src, content).expect("write source");

        let hash = copy_and_hash_file(&src, &dst, content.len() as u64, |_| {})
            .expect("copy should succeed");

        // Verify content was copied
        let copied = std::fs::read(&dst).expect("read dest");
        assert_eq!(copied, content);

        // Verify SHA256 hash
        use sha2::{Digest, Sha256};
        let expected = format!("sha256:{:x}", Sha256::digest(content));
        assert_eq!(hash, expected);
    }

    #[test]
    fn copy_and_hash_file_handles_empty_file() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let src = tmp.path().join("empty.bin");
        let dst = tmp.path().join("empty_copy.bin");
        std::fs::write(&src, b"").expect("write empty source");

        let hash =
            copy_and_hash_file(&src, &dst, 0, |_| {}).expect("copy should succeed for empty file");

        let copied = std::fs::read(&dst).expect("read dest");
        assert!(copied.is_empty());

        use sha2::{Digest, Sha256};
        let expected = format!("sha256:{:x}", Sha256::digest(b""));
        assert_eq!(hash, expected);
    }

    #[test]
    fn copy_and_hash_file_handles_large_content_across_multiple_chunks() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let src = tmp.path().join("large.bin");
        let dst = tmp.path().join("large_copy.bin");
        // 200KB = ~3 chunks of 64KB buffer
        let content = vec![0xABu8; 200 * 1024];
        std::fs::write(&src, &content).expect("write large source");

        let hash = copy_and_hash_file(&src, &dst, content.len() as u64, |_| {})
            .expect("copy should succeed");

        let copied = std::fs::read(&dst).expect("read dest");
        assert_eq!(copied.len(), content.len());
        assert_eq!(copied, content);

        use sha2::{Digest, Sha256};
        let expected = format!("sha256:{:x}", Sha256::digest(&content));
        assert_eq!(hash, expected);
    }

    #[test]
    fn copy_and_hash_file_progress_callback_invoked() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let src = tmp.path().join("progress.bin");
        let dst = tmp.path().join("progress_copy.bin");
        let content = vec![0x42u8; 128 * 1024]; // 128KB = 2 chunks
        std::fs::write(&src, &content).expect("write source");

        let mut progress_calls = Vec::new();
        let hash = copy_and_hash_file(&src, &dst, content.len() as u64, |bytes_copied| {
            progress_calls.push(bytes_copied);
        })
        .expect("copy should succeed");

        // Should have at least 2 progress callbacks (2 chunks)
        assert!(
            progress_calls.len() >= 2,
            "expected >= 2 progress calls, got {}",
            progress_calls.len()
        );
        // Progress should be monotonically increasing
        for window in progress_calls.windows(2) {
            assert!(
                window[1] >= window[0],
                "progress should be monotonically increasing"
            );
        }
        // Final progress should equal total bytes
        assert_eq!(
            *progress_calls.last().unwrap(),
            content.len() as u64,
            "last progress should equal total bytes"
        );
        assert!(hash.starts_with("sha256:"));
    }

    #[test]
    fn copy_and_hash_file_fails_on_missing_source() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let src = tmp.path().join("nonexistent.gguf");
        let dst = tmp.path().join("dest.gguf");

        let result = copy_and_hash_file(&src, &dst, 0, |_| {});
        let error = result.expect_err("should fail for missing source");
        assert!(
            error.contains("LOCAL_AI_FILE_IMPORT_READ_FAILED"),
            "error should contain reason code, got: {error}"
        );
    }

    #[test]
    fn copy_and_hash_file_fails_on_invalid_dest_path() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let src = tmp.path().join("source.bin");
        std::fs::write(&src, b"data").expect("write source");
        // Dest inside a non-existent directory
        let dst = tmp.path().join("no-such-dir").join("deep").join("dest.bin");

        let result = copy_and_hash_file(&src, &dst, 4, |_| {});
        let error = result.expect_err("should fail for invalid dest path");
        assert!(
            error.contains("LOCAL_AI_FILE_IMPORT_WRITE_FAILED"),
            "error should contain reason code, got: {error}"
        );
    }
}
