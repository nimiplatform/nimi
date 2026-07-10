use super::*;

#[tokio::test]
async fn real_validation_sidecar_write_failure_is_host_internal_through_command_wrapper() {
    let nonce = Utc::now().timestamp_nanos_opt().unwrap_or(0);
    let root = std::env::temp_dir().join(format!("nimi-agent-center-host-io-{nonce}"));
    let roots = crate::runtime_app_storage::test_standard_app_storage_roots(&root);
    let avatar_ref = "live2d_cccccccccccc";
    let asset_dir = avatar_asset_dir(&roots, "account_1", "local-agent:ren", "live2d", avatar_ref)
        .expect("scoped avatar fixture path");
    fs::create_dir_all(asset_dir.join(VALIDATION_FILE_NAME))
        .expect("validation sidecar directory collision");

    let error = commands::avatar_asset_validate(roots, avatar_validate_payload(avatar_ref))
        .await
        .expect_err("validation sidecar write collision must fail");
    let envelope = assert_error_code(
        error,
        "host-internal-error",
        "tauri-agent-center-host-operation-failed",
    );
    assert!(envelope["details"]["cause"]
        .as_str()
        .is_some_and(|cause| cause.contains("failed to write Avatar asset validation sidecar")));
    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn blocking_join_failure_uses_complete_standard_envelope() {
    let error = commands::run_agent_center_resource_blocking("agent_center_test_panic", || {
        panic!("simulated blocking worker panic");
        #[allow(unreachable_code)]
        Ok::<(), commands::AgentCenterHostError>(())
    })
    .await
    .expect_err("blocking panic must fail closed");
    let envelope = parse_standard_error(error);
    assert_eq!(envelope["code"], "host-internal-error");
    assert_eq!(
        envelope["reasonCode"],
        "tauri-agent-center-blocking-task-failed"
    );
    assert_eq!(envelope["source"], "tauri");
}
