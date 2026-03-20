use super::{
    apply_state_event, clear_pending_update, configured_updater_endpoint_raw,
    configured_updater_pubkey, current_state, default_state, install_pending_downloaded_update,
    reset_test_update_state, set_error_state, set_state, store_pending_update,
    sync_current_version, updater_available, updater_unavailable_reason, PendingUpdatePayload,
    UpdateStateEvent, DEFAULT_UPDATE_ENDPOINT,
};
use crate::desktop_release::{reset_test_state, set_test_release_version};
use crate::runtime_bridge::{channel_invalidation_count, reset_channel_invalidation_count};
use crate::test_support::with_env;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

fn with_update_test_lock(run: impl FnOnce()) {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    let _guard = LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .expect("desktop update test lock poisoned");
    run();
}

fn with_release_version(run: impl FnOnce()) {
    with_env(
        &[
            ("NIMI_RUNTIME_BRIDGE_MODE", Some("RUNTIME")),
            (
                "NIMI_DESKTOP_UPDATER_ENDPOINT",
                Some("https://install.nimi.xyz/desktop/latest.json"),
            ),
        ],
        || {
            reset_test_state();
            set_test_release_version("0.1.0");
            reset_test_update_state();
            run();
            reset_test_update_state();
            reset_test_state();
        },
    );
}

#[test]
fn checking_resets_error_and_restart_flag() {
    with_update_test_lock(|| {
        let mut state = default_state();
        state.last_error = Some("boom".to_string());
        state.ready_to_restart = true;

        apply_state_event(&mut state, UpdateStateEvent::Checking);

        assert_eq!(state.status, "checking");
        assert_eq!(state.last_error, None);
        assert!(!state.ready_to_restart);
    });
}

#[test]
fn progress_accumulates_downloaded_bytes_and_preserves_target() {
    with_update_test_lock(|| {
        let mut state = default_state();
        apply_state_event(
            &mut state,
            UpdateStateEvent::Downloading {
                target_version: Some("1.2.3".to_string()),
            },
        );
        apply_state_event(
            &mut state,
            UpdateStateEvent::Progress {
                target_version: Some("1.2.3".to_string()),
                chunk_length: 128,
                total_bytes: Some(1024),
            },
        );
        apply_state_event(
            &mut state,
            UpdateStateEvent::Progress {
                target_version: Some("1.2.3".to_string()),
                chunk_length: 256,
                total_bytes: Some(1024),
            },
        );

        assert_eq!(state.status, "downloading");
        assert_eq!(state.target_version.as_deref(), Some("1.2.3"));
        assert_eq!(state.downloaded_bytes, 384);
        assert_eq!(state.total_bytes, Some(1024));
    });
}

#[test]
fn error_sets_error_state_and_message() {
    with_update_test_lock(|| {
        let mut state = default_state();

        apply_state_event(
            &mut state,
            UpdateStateEvent::Error {
                message: "DESKTOP_UPDATER_INSTALL_FAILED: boom".to_string(),
            },
        );

        assert_eq!(state.status, "error");
        assert_eq!(
            state.last_error.as_deref(),
            Some("DESKTOP_UPDATER_INSTALL_FAILED: boom")
        );
    });
}

#[test]
fn installing_sets_installing_state_and_preserves_target() {
    with_update_test_lock(|| {
        let mut state = default_state();

        apply_state_event(
            &mut state,
            UpdateStateEvent::Installing {
                target_version: Some("2.0.0".to_string()),
            },
        );

        assert_eq!(state.status, "installing");
        assert_eq!(state.target_version.as_deref(), Some("2.0.0"));
    });
}

#[test]
fn ready_to_restart_sets_flag_and_clears_error() {
    with_update_test_lock(|| {
        let mut state = default_state();
        state.last_error = Some("boom".to_string());

        apply_state_event(
            &mut state,
            UpdateStateEvent::ReadyToRestart {
                target_version: Some("9.9.9".to_string()),
            },
        );

        assert_eq!(state.status, "readyToRestart");
        assert_eq!(state.target_version.as_deref(), Some("9.9.9"));
        assert!(state.ready_to_restart);
        assert_eq!(state.last_error, None);
    });
}

#[test]
fn configured_updater_pubkey_prefers_runtime_env() {
    with_update_test_lock(|| {
        with_env(
            &[("NIMI_DESKTOP_UPDATER_PUBLIC_KEY", Some("runtime-pubkey"))],
            || {
                assert_eq!(
                    configured_updater_pubkey().as_deref(),
                    Some("runtime-pubkey")
                );
            },
        );
    });
}

#[test]
fn updater_availability_reports_missing_pubkey() {
    with_update_test_lock(|| {
        with_env(&[("NIMI_DESKTOP_UPDATER_PUBLIC_KEY", None)], || {
            assert!(!updater_available());
            assert!(updater_unavailable_reason()
                .unwrap_or_default()
                .contains("DESKTOP_UPDATER_UNAVAILABLE"));
        });
    });
}

#[test]
fn configured_updater_endpoint_prefers_runtime_env() {
    with_update_test_lock(|| {
        with_env(
            &[(
                "NIMI_DESKTOP_UPDATER_ENDPOINT",
                Some("https://install.nimi.xyz/desktop/latest.json"),
            )],
            || {
                assert_eq!(
                    configured_updater_endpoint_raw(),
                    "https://install.nimi.xyz/desktop/latest.json"
                );
            },
        );
    });
}

#[test]
fn configured_updater_endpoint_falls_back_to_default() {
    with_update_test_lock(|| {
        with_env(&[("NIMI_DESKTOP_UPDATER_ENDPOINT", None)], || {
            assert_eq!(configured_updater_endpoint_raw(), DEFAULT_UPDATE_ENDPOINT);
        });
    });
}

#[test]
fn default_updater_endpoint_uses_install_domain() {
    with_update_test_lock(|| {
        assert_eq!(
            DEFAULT_UPDATE_ENDPOINT,
            "https://install.nimi.xyz/desktop/latest.json"
        );
    });
}

#[test]
fn updater_availability_reports_invalid_endpoint() {
    with_update_test_lock(|| {
        with_env(
            &[
                ("NIMI_DESKTOP_UPDATER_PUBLIC_KEY", Some("runtime-pubkey")),
                ("NIMI_DESKTOP_UPDATER_ENDPOINT", Some("not-a-url")),
            ],
            || {
                assert!(!updater_available());
                assert!(updater_unavailable_reason()
                    .unwrap_or_default()
                    .contains("DESKTOP_UPDATER_ENDPOINT_INVALID"));
            },
        );
    });
}

#[test]
fn updater_unavailable_error_transitions_state_from_checking_to_error() {
    with_update_test_lock(|| {
        with_release_version(|| {
            set_state(None, |state| {
                let _ = sync_current_version(state);
                apply_state_event(state, UpdateStateEvent::Checking);
            });
            let error = set_error_state(None, updater_unavailable_reason().unwrap_or_default());

            let state = current_state().expect("state");
            assert_eq!(state.status, "error");
            assert_eq!(state.last_error.as_deref(), Some(error.as_str()));
        });
    });
}

#[test]
fn invalid_endpoint_error_transitions_state_from_checking_to_error() {
    with_update_test_lock(|| {
        with_env(
            &[
                ("NIMI_RUNTIME_BRIDGE_MODE", Some("RUNTIME")),
                ("NIMI_DESKTOP_UPDATER_PUBLIC_KEY", Some("runtime-pubkey")),
                ("NIMI_DESKTOP_UPDATER_ENDPOINT", Some("not-a-url")),
            ],
            || {
                reset_test_state();
                set_test_release_version("0.1.0");
                reset_test_update_state();
                set_state(None, |state| {
                    let _ = sync_current_version(state);
                    apply_state_event(state, UpdateStateEvent::Checking);
                });
                let error = set_error_state(None, updater_unavailable_reason().unwrap_or_default());

                let state = current_state().expect("state");
                assert_eq!(state.status, "error");
                assert_eq!(state.last_error.as_deref(), Some(error.as_str()));
                reset_test_update_state();
                reset_test_state();
            },
        );
    });
}

#[test]
fn current_state_fails_close_without_release_metadata() {
    with_update_test_lock(|| {
        reset_test_state();
        reset_test_update_state();
        assert!(current_state().is_err());
    });
}

#[test]
fn install_requires_downloaded_payload() {
    with_update_test_lock(|| {
        with_release_version(|| {
            clear_pending_update();
            let error = install_pending_downloaded_update(None)
                .err()
                .unwrap_or_default();
            assert!(error.contains("DESKTOP_UPDATER_DOWNLOAD_REQUIRED"));
        });
    });
}

#[test]
fn install_consumes_cached_payload_and_marks_ready_to_restart() {
    with_update_test_lock(|| {
        with_release_version(|| {
            clear_pending_update();
            reset_channel_invalidation_count();
            let installed = Arc::new(AtomicBool::new(false));
            let installed_flag = installed.clone();
            store_pending_update(PendingUpdatePayload {
                target_version: "2.0.0".to_string(),
                notes: Some("notes".to_string()),
                pub_date: Some("2026-03-15T00:00:00Z".to_string()),
                bytes: vec![1, 2, 3],
                install: Box::new(move |payload| {
                    assert_eq!(payload, [1, 2, 3]);
                    installed_flag.store(true, Ordering::Relaxed);
                    Ok(())
                }),
            });

            let state = install_pending_downloaded_update(None).expect("install should succeed");
            assert!(installed.load(Ordering::Relaxed));
            assert_eq!(state.status, "readyToRestart");
            assert_eq!(state.target_version.as_deref(), Some("2.0.0"));
            assert!(state.ready_to_restart);
            assert!(channel_invalidation_count() >= 1);
        });
    });
}

#[test]
fn failed_install_restores_cached_payload_and_sets_error_state() {
    with_update_test_lock(|| {
        with_release_version(|| {
            clear_pending_update();
            store_pending_update(PendingUpdatePayload {
                target_version: "2.0.0".to_string(),
                notes: None,
                pub_date: None,
                bytes: vec![4, 5, 6],
                install: Box::new(|_| Err("DESKTOP_UPDATER_INSTALL_FAILED: boom".to_string())),
            });

            let error = install_pending_downloaded_update(None)
                .err()
                .unwrap_or_default();
            assert!(error.contains("DESKTOP_UPDATER_INSTALL_FAILED"));

            let state = current_state().expect("state");
            assert_eq!(state.status, "error");
            assert_eq!(
                state.last_error.as_deref(),
                Some("DESKTOP_UPDATER_INSTALL_FAILED: boom")
            );
        });
    });
}
