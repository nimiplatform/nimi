use super::*;

#[test]
fn run_guard_rejects_a_pre_cancelled_supervisor() {
    let (cancel_tx, cancel_rx) = watch::channel(false);
    assert!(ensure_run_active(&cancel_tx).is_ok());
    drop(cancel_rx);
    cancel_tx.send_replace(true);
    assert_eq!(
        ensure_run_active(&cancel_tx).unwrap_err(),
        RUN_CANCELLED_REASON
    );
}

#[tokio::test]
async fn cancellation_preempts_supervisor_waits() {
    let (cancel_tx, mut cancel_rx) = watch::channel(false);
    let wait =
        tokio::spawn(async move { wait_or_cancel(&mut cancel_rx, Duration::from_secs(30)).await });
    tokio::task::yield_now().await;
    cancel_tx.send_replace(true);
    let result = tokio::time::timeout(Duration::from_secs(1), wait)
        .await
        .expect("cancellation must preempt the wait")
        .expect("wait task");
    assert_eq!(result.unwrap_err(), RUN_CANCELLED_REASON);
}

#[cfg(target_os = "windows")]
#[test]
fn electron_cli_receives_a_drive_path_after_canonical_identity_validation() {
    assert_eq!(
        electron_cli_path(Path::new(r"\\?\D:\project\dist-electron\main.js"))
            .expect("projected Electron entry"),
        r"D:\project\dist-electron\main.js"
    );
    assert_eq!(
        electron_cli_path(Path::new(r"D:\project\dist-electron\main.js"))
            .expect("ordinary Electron entry"),
        r"D:\project\dist-electron\main.js"
    );
    assert!(electron_cli_path(Path::new(r"\\server\share\main.js")).is_err());
    assert!(electron_cli_path(Path::new(r"\\?\UNC\server\share\main.js")).is_err());
}

#[cfg(not(target_os = "windows"))]
#[test]
fn electron_cli_receives_an_absolute_native_path_after_identity_validation() {
    assert_eq!(
        electron_cli_path(Path::new(
            "/Applications/Nimi.app/Contents/Resources/main.js"
        ))
        .expect("projected Electron entry"),
        "/Applications/Nimi.app/Contents/Resources/main.js"
    );
    assert!(electron_cli_path(Path::new("dist-electron/main.js")).is_err());
}

#[cfg(not(target_os = "windows"))]
#[test]
fn path_containment_is_case_sensitive_and_component_aware() {
    let root = Path::new("/Users/test/project");
    assert!(ensure_path_within(root, Path::new("/Users/test/project/dist/main.js")).is_ok());
    assert!(ensure_path_within(root, Path::new("/Users/test/project-copy/main.js")).is_err());
    assert!(ensure_path_within(root, Path::new("/Users/test/Project/main.js")).is_err());
}

#[cfg(feature = "dev-kernel-checkpoint")]
#[test]
fn dev_kernel_agent_selector_is_opaque_and_strict() {
    assert!(
        validate_dev_kernel_agent_id("local-agent:runtime-1f2e3d4c5b6a79800123456789abcdef")
            .is_ok()
    );
    assert!(validate_dev_kernel_agent_id("nimi.zhiyu").is_err());
    assert!(
        validate_dev_kernel_agent_id("local-agent:runtime-1f2e3d4c5b6a79800123456789abcdeg")
            .is_err()
    );
    assert!(
        validate_dev_kernel_agent_id("local-agent:runtime-1f2e3d4c5b6a79800123456789abcde")
            .is_err()
    );
}
