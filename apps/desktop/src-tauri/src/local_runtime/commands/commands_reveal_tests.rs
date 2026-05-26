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
    use super::{copy_file_with_progress, extract_reason_code};

    #[test]
    fn install_preflight_preserves_reason_code_prefix() {
        let reason = extract_reason_code("LOCAL_AI_PROVIDER_TIMEOUT: provider timeout");
        assert_eq!(reason, "LOCAL_AI_PROVIDER_TIMEOUT");
    }

    // --- copy_file_with_progress tests ---

    #[test]
    fn copy_file_with_progress_copies_content() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let src = tmp.path().join("source.gguf");
        let dst = tmp.path().join("dest.gguf");
        let content = b"hello world model data for sha256 test";
        std::fs::write(&src, content).expect("write source");

        copy_file_with_progress(
            std::fs::File::open(&src).expect("open source"),
            &dst,
            |_| {},
            || Ok(()),
        )
        .expect("copy should succeed");

        let copied = std::fs::read(&dst).expect("read dest");
        assert_eq!(copied, content);
    }

    #[test]
    fn copy_file_with_progress_handles_empty_file() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let src = tmp.path().join("empty.bin");
        let dst = tmp.path().join("empty_copy.bin");
        std::fs::write(&src, b"").expect("write empty source");

        copy_file_with_progress(
            std::fs::File::open(&src).expect("open source"),
            &dst,
            |_| {},
            || Ok(()),
        )
        .expect("copy should succeed for empty file");

        let copied = std::fs::read(&dst).expect("read dest");
        assert!(copied.is_empty());
    }

    #[test]
    fn copy_file_with_progress_handles_large_content_across_multiple_chunks() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let src = tmp.path().join("large.bin");
        let dst = tmp.path().join("large_copy.bin");
        // 200KB = ~3 chunks of 64KB buffer
        let content = vec![0xABu8; 200 * 1024];
        std::fs::write(&src, &content).expect("write large source");

        copy_file_with_progress(
            std::fs::File::open(&src).expect("open source"),
            &dst,
            |_| {},
            || Ok(()),
        )
        .expect("copy should succeed");

        let copied = std::fs::read(&dst).expect("read dest");
        assert_eq!(copied.len(), content.len());
        assert_eq!(copied, content);
    }

    #[test]
    fn copy_file_with_progress_progress_callback_invoked() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let src = tmp.path().join("progress.bin");
        let dst = tmp.path().join("progress_copy.bin");
        let content = vec![0x42u8; 128 * 1024]; // 128KB = 2 chunks
        std::fs::write(&src, &content).expect("write source");

        let mut progress_calls = Vec::new();
        copy_file_with_progress(
            std::fs::File::open(&src).expect("open source"),
            &dst,
            |bytes_copied| {
                progress_calls.push(bytes_copied);
            },
            || Ok(()),
        )
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
    }

    #[test]
    fn copy_file_with_progress_stops_at_cancel_boundary() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let src = tmp.path().join("cancel.bin");
        let dst = tmp.path().join("cancel_copy.bin");
        let content = vec![0x7Fu8; 128 * 1024];
        std::fs::write(&src, &content).expect("write source");

        let progress_calls = std::cell::Cell::new(0usize);
        let result = copy_file_with_progress(
            std::fs::File::open(&src).expect("open source"),
            &dst,
            |_| {
                progress_calls.set(progress_calls.get() + 1);
            },
            || {
                if progress_calls.get() > 0 {
                    Err("LOCAL_AI_BACKGROUND_IMPORT_CANCELLED: test cancel".to_string())
                } else {
                    Ok(())
                }
            },
        );

        let error = result.expect_err("copy should stop after cancellation");
        assert!(
            error.starts_with("LOCAL_AI_BACKGROUND_IMPORT_CANCELLED"),
            "error should preserve cancellation reason, got: {error}"
        );
    }

    #[test]
    fn copy_file_with_progress_fails_on_missing_source() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let src = tmp.path().join("nonexistent.gguf");

        let error = std::fs::File::open(&src).expect_err("missing source should fail at open");
        assert_eq!(error.kind(), std::io::ErrorKind::NotFound);
    }

    #[test]
    fn copy_file_with_progress_fails_on_invalid_dest_path() {
        let tmp = tempfile::tempdir().expect("create temp dir");
        let src = tmp.path().join("source.bin");
        std::fs::write(&src, b"data").expect("write source");
        // Dest inside a non-existent directory
        let dst = tmp.path().join("no-such-dir").join("deep").join("dest.bin");

        let result = copy_file_with_progress(
            std::fs::File::open(&src).expect("open source"),
            &dst,
            |_| {},
            || Ok(()),
        );
        let error = result.expect_err("should fail for invalid dest path");
        assert!(
            error.contains("LOCAL_AI_FILE_IMPORT_WRITE_FAILED"),
            "error should contain reason code, got: {error}"
        );
    }
}
