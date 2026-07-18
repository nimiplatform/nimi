use super::*;

#[napi(js_name = "localAppSessionStatus")]
pub async fn local_app_session_status() -> NativeJsonOutcome {
    let session = match current_or_open_session().await {
        Ok(session) => session,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    match session.session_status().await {
        Ok(status) => NativeJsonOutcome::success(project_session_status(status)),
        Err(error) => {
            clear_session_on_transport_failure(&session, error).await;
            NativeJsonOutcome::error(error)
        }
    }
}

#[napi(js_name = "localAppPermissionStatus")]
pub async fn local_app_permission_status(input: NativePermissionStatusInput) -> NativeJsonOutcome {
    let session = match current_or_open_session().await {
        Ok(session) => session,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    match session
        .permission_status(LocalAppPermissionStatusRequest {
            permission_id: input.permission_id,
        })
        .await
    {
        Ok(status) => NativeJsonOutcome::success(project_permission_status(status)),
        Err(error) => {
            clear_session_on_transport_failure(&session, error).await;
            NativeJsonOutcome::error(error)
        }
    }
}

#[napi(js_name = "localAppPermissionRequest")]
pub async fn local_app_permission_request(
    input: NativePermissionRequestInput,
) -> NativeJsonOutcome {
    let session = match current_or_open_session().await {
        Ok(session) => session,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    match session
        .permission_request(LocalAppPermissionRequest {
            permission_id: input.permission_id,
            reason: input.reason,
        })
        .await
    {
        Ok(status) => NativeJsonOutcome::success(project_permission_status(status)),
        Err(error) => {
            clear_session_on_transport_failure(&session, error).await;
            NativeJsonOutcome::error(error)
        }
    }
}

#[napi(js_name = "localAppStorageReadJson")]
pub async fn local_app_storage_read_json(input: NativeStorageReadInput) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .storage_read_json(LocalAppStorageReadRequest {
                relative_path: input.relative_path,
            })
            .await
            .map(|document| json!({"value": document.value, "sizeBytes": document.size_bytes}))
    })
    .await
}

#[napi(js_name = "localAppStorageWriteJson")]
pub async fn local_app_storage_write_json(input: NativeStorageWriteInput) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .storage_write_json(LocalAppStorageWriteRequest {
                relative_path: input.relative_path,
                value: input.value,
            })
            .await
            .map(|document| json!({"value": document.value, "sizeBytes": document.size_bytes}))
    })
    .await
}

#[napi(js_name = "localAppStorageRemoveJson")]
pub async fn local_app_storage_remove_json(input: NativeStorageRemoveInput) -> NativeJsonOutcome {
    invoke_agent(|session| async move {
        session
            .storage_remove_json(LocalAppStorageRemoveRequest {
                relative_path: input.relative_path,
            })
            .await
            .map(|result| json!({"removed": result.removed}))
    })
    .await
}

async fn invoke_agent<F, Fut>(operation: F) -> NativeJsonOutcome
where
    F: FnOnce(Arc<dyn NimiLocalAppSession>) -> Fut,
    Fut: std::future::Future<Output = Result<JsonValue, LocalAppOperationError>>,
{
    let session = match current_or_open_session().await {
        Ok(session) => session,
        Err(error) => return NativeJsonOutcome::error(error),
    };
    match operation(session.clone()).await {
        Ok(value) => NativeJsonOutcome::success(value),
        Err(error) => {
            clear_session_on_transport_failure(&session, error).await;
            NativeJsonOutcome::error(error)
        }
    }
}

async fn current_or_open_session() -> Result<Arc<dyn NimiLocalAppSession>, LocalAppOperationError> {
    let mut current = LOCAL_APP_SESSION.lock().await;
    if let Some(session) = current.as_ref() {
        return Ok(session.clone());
    }
    let opened = PlatformLocalAppCarrier::default()
        .open_local_app_session()
        .await?;
    let session = Arc::<dyn NimiLocalAppSession>::from(opened);
    *current = Some(session.clone());
    Ok(session)
}

async fn clear_session_on_transport_failure(
    session: &Arc<dyn NimiLocalAppSession>,
    error: LocalAppOperationError,
) {
    if !matches!(
        error.reason_code(),
        LocalAppReasonCode::RuntimeServiceUnavailable
            | LocalAppReasonCode::RuntimeServiceUntrusted
            | LocalAppReasonCode::RuntimeUnauthenticated
            | LocalAppReasonCode::ProcessReplaced
            | LocalAppReasonCode::AccountChanged
            | LocalAppReasonCode::RuntimeRestarted
            | LocalAppReasonCode::Revoked
    ) {
        return;
    }
    let mut current = LOCAL_APP_SESSION.lock().await;
    if current
        .as_ref()
        .is_some_and(|candidate| Arc::ptr_eq(candidate, session))
    {
        *current = None;
    }
}
