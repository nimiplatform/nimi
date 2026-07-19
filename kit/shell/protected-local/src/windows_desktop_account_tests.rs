use super::*;

#[test]
fn account_status_request_binds_host_owned_caller_and_metadata() {
    let request = build_request(DesktopAccountSessionStatusRequest {
        app_id: " nimi.desktop ".to_string(),
        app_instance_id: " nimi.desktop.local-first-party ".to_string(),
        device_id: " desktop-shell ".to_string(),
    })
    .expect("host-owned account request");
    let caller = request.get_ref().caller.as_ref().expect("account caller");
    assert_eq!(caller.app_id, "nimi.desktop");
    assert_eq!(caller.app_instance_id, "nimi.desktop.local-first-party");
    assert_eq!(caller.device_id, "desktop-shell");
    assert_eq!(caller.mode, AccountCallerMode::DesktopShell as i32);
    for (key, expected) in [
        ("x-nimi-source-host", DESKTOP_ACCOUNT_SOURCE_HOST),
        ("x-nimi-caller-kind", DESKTOP_ACCOUNT_CALLER_KIND),
        ("x-nimi-app-id", caller.app_id.as_str()),
        ("x-nimi-app-instance-id", caller.app_instance_id.as_str()),
        ("x-nimi-device-id", caller.device_id.as_str()),
    ] {
        assert_eq!(
            request
                .metadata()
                .get(key)
                .and_then(|value| value.to_str().ok()),
            Some(expected),
            "metadata {key}",
        );
    }
}

#[test]
fn account_status_request_rejects_non_metadata_safe_host_identity() {
    assert!(build_request(DesktopAccountSessionStatusRequest {
        app_id: "nimi.desktop".to_string(),
        app_instance_id: "desktop\ninstance".to_string(),
        device_id: "desktop-shell".to_string(),
    })
    .is_err());
}

#[test]
fn realm_unary_carrier_deadline_preserves_runtime_timeout_classification_margin() {
    assert_eq!(
        realm_unary_carrier_timeout(1),
        std::time::Duration::from_millis(5_001)
    );
    assert_eq!(
        realm_unary_carrier_timeout(MAX_ACCOUNT_CALL_TIMEOUT_MS),
        std::time::Duration::from_millis(305_000)
    );
}

#[test]
fn account_callback_pair_is_exact_bounded_loopback() {
    assert_eq!(
        validate_callback_pair(
            "http://127.0.0.1:4100/oauth/callback".to_string(),
            "http://127.0.0.1:4100".to_string(),
        )
        .expect("callback pair"),
        (
            "http://127.0.0.1:4100/oauth/callback".to_string(),
            "http://127.0.0.1:4100".to_string(),
        )
    );
    for (redirect, origin) in [
        (
            "https://127.0.0.1:4100/oauth/callback",
            "https://127.0.0.1:4100",
        ),
        (
            "http://realm.test:4100/oauth/callback",
            "http://realm.test:4100",
        ),
        ("http://127.0.0.1:4100/other", "http://127.0.0.1:4100"),
        (
            "http://127.0.0.1:51000/oauth/callback",
            "http://127.0.0.1:51000",
        ),
        (
            "http://127.0.0.1:4100/oauth/callback?code=x",
            "http://127.0.0.1:4100",
        ),
        (
            "http://127.0.0.1:4100/oauth/callback",
            "http://127.0.0.1:4101",
        ),
    ] {
        assert!(validate_callback_pair(redirect.to_string(), origin.to_string()).is_err());
    }
}

#[test]
fn authorization_url_is_bound_to_the_exact_attempt() {
    assert!(authorization_url_matches_attempt(
            "https://realm.test/api/auth/oauth/authorize?state=state-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A4100%2Foauth%2Fcallback",
            "http://127.0.0.1:4100/oauth/callback",
            "state-1",
        ));
    assert!(!authorization_url_matches_attempt(
            "https://realm.test/api/auth/oauth/authorize?state=state-1&state=forged&redirect_uri=http%3A%2F%2F127.0.0.1%3A4100%2Foauth%2Fcallback",
            "http://127.0.0.1:4100/oauth/callback",
            "state-1",
        ));
}

#[test]
fn account_event_subscription_bounds_only_the_open_handshake() {
    assert_eq!(
        ACCOUNT_EVENT_SUBSCRIBE_OPEN_TIMEOUT,
        std::time::Duration::from_secs(30)
    );
    let request = protected_request(SubscribeAccountSessionEventsRequest {
        caller: Some(desktop_account_caller().expect("desktop account caller")),
        after_sequence: 17,
    })
    .expect("account event request");
    assert!(request.metadata().get("grpc-timeout").is_none());
}

#[test]
fn projects_the_initial_zero_sequence_snapshot() {
    let event = project_event(AccountSessionEvent {
        sequence: 0,
        event_type: AccountEventType::AccountStatus as i32,
        delivery_kind: AccountSessionDeliveryKind::Snapshot as i32,
        snapshot: Some(AccountSessionSnapshot {
            sequence: 0,
            state: AccountSessionState::Anonymous as i32,
            reason_code: ACTION_EXECUTED,
            account_reason_code: ACTION_EXECUTED,
            account_projection: None,
        }),
        ..Default::default()
    })
    .expect("initial account snapshot");

    assert_eq!(event.sequence, 0);
    assert_eq!(
        event.delivery_kind,
        DesktopAccountSessionDeliveryKind::Snapshot
    );
    assert_eq!(event.state, DesktopAccountSessionState::Anonymous);
}

#[test]
fn rejects_unknown_account_event_enums() {
    let baseline = AccountSessionEvent {
        sequence: 1,
        event_type: AccountEventType::AccountStatus as i32,
        delivery_kind: AccountSessionDeliveryKind::Snapshot as i32,
        snapshot: Some(AccountSessionSnapshot {
            sequence: 1,
            state: AccountSessionState::Anonymous as i32,
            reason_code: ACTION_EXECUTED,
            account_reason_code: ACTION_EXECUTED,
            account_projection: None,
        }),
        ..Default::default()
    };
    let mut unknown_event_type = baseline.clone();
    unknown_event_type.event_type = i32::MAX;
    assert!(project_event(unknown_event_type).is_err());

    let mut unknown_reason = baseline;
    unknown_reason
        .snapshot
        .as_mut()
        .expect("snapshot")
        .reason_code = i32::MAX;
    assert!(project_event(unknown_reason).is_err());

    let mut unspecified_event = AccountSessionEvent {
        sequence: 1,
        event_type: AccountEventType::Unspecified as i32,
        delivery_kind: AccountSessionDeliveryKind::Snapshot as i32,
        snapshot: Some(AccountSessionSnapshot {
            sequence: 1,
            state: AccountSessionState::Anonymous as i32,
            reason_code: ACTION_EXECUTED,
            account_reason_code: ACTION_EXECUTED,
            account_projection: None,
        }),
        ..Default::default()
    };
    assert!(project_event(unspecified_event.clone()).is_err());
    unspecified_event.event_type = AccountEventType::AccountStatus as i32;
    unspecified_event.delivery_kind = AccountSessionDeliveryKind::Live as i32;
    unspecified_event.replay_truncated = true;
    assert!(project_event(unspecified_event).is_err());
}

#[test]
fn projects_only_renderer_safe_account_fields() {
    let status = project_response(GetAccountSessionStatusResponse {
        reason_code: ACTION_EXECUTED,
        account_reason_code: ACTION_EXECUTED,
        accepted: true,
        snapshot: Some(AccountSessionSnapshot {
            sequence: 17,
            state: AccountSessionState::Authenticated as i32,
            reason_code: ACTION_EXECUTED,
            account_reason_code: ACTION_EXECUTED,
            account_projection: Some(AccountProjection {
                account_id: "account-1".to_string(),
                display_name: "Nimi User".to_string(),
                realm_environment_id: "realm-1".to_string(),
                workspace_memberships: Vec::new(),
            }),
        }),
    })
    .expect("account projection");

    assert_eq!(status.state, DesktopAccountSessionState::Authenticated);
    assert_eq!(
        status.account_projection,
        Some(DesktopAccountProjection {
            account_id: "account-1".to_string(),
            display_name: "Nimi User".to_string(),
            realm_environment_id: "realm-1".to_string(),
        })
    );
}

#[test]
fn rejects_inert_or_incomplete_account_responses() {
    for response in [
        GetAccountSessionStatusResponse {
            reason_code: PRINCIPAL_UNAUTHORIZED,
            account_reason_code: 10,
            ..Default::default()
        },
        GetAccountSessionStatusResponse {
            reason_code: ACTION_EXECUTED,
            account_reason_code: ACTION_EXECUTED,
            accepted: true,
            ..Default::default()
        },
        GetAccountSessionStatusResponse {
            reason_code: ACTION_EXECUTED,
            account_reason_code: ACTION_EXECUTED,
            accepted: true,
            snapshot: Some(AccountSessionSnapshot {
                sequence: 1,
                state: AccountSessionState::Unspecified as i32,
                reason_code: ACTION_EXECUTED,
                account_reason_code: ACTION_EXECUTED,
                account_projection: None,
            }),
        },
    ] {
        assert!(project_response(response).is_err());
    }
}
