use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

const UPDATE_EVENT_NAME: &str = "desktop-update://state";
const DEFAULT_UPDATE_ENDPOINT: &str = "https://install.nimi.xyz/desktop/latest.json";

enum UpdateStateEvent {
    Checking,
    Available {
        target_version: Option<String>,
    },
    Idle,
    Downloading {
        target_version: Option<String>,
    },
    Progress {
        target_version: Option<String>,
        chunk_length: u64,
        total_bytes: Option<u64>,
    },
    Downloaded {
        target_version: Option<String>,
    },
    Installing {
        target_version: Option<String>,
    },
    Error {
        message: String,
    },
    ReadyToRestart {
        target_version: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdateState {
    pub status: String,
    pub current_version: String,
    pub target_version: Option<String>,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub last_error: Option<String>,
    pub ready_to_restart: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopUpdateCheckResult {
    pub available: bool,
    pub current_version: String,
    pub target_version: Option<String>,
    pub notes: Option<String>,
    pub pub_date: Option<String>,
}

type PendingInstallFn = Box<dyn Fn(&[u8]) -> Result<(), String> + Send + 'static>;

struct PendingUpdatePayload {
    target_version: String,
    notes: Option<String>,
    pub_date: Option<String>,
    bytes: Vec<u8>,
    install: PendingInstallFn,
}

fn default_state() -> DesktopUpdateState {
    DesktopUpdateState {
        status: "idle".to_string(),
        current_version: String::new(),
        target_version: None,
        downloaded_bytes: 0,
        total_bytes: None,
        last_error: None,
        ready_to_restart: false,
    }
}

fn update_state_store() -> &'static Mutex<DesktopUpdateState> {
    static STATE: OnceLock<Mutex<DesktopUpdateState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(default_state()))
}

fn pending_update_store() -> &'static Mutex<Option<PendingUpdatePayload>> {
    static STORE: OnceLock<Mutex<Option<PendingUpdatePayload>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(None))
}

fn apply_state_event(state: &mut DesktopUpdateState, event: UpdateStateEvent) {
    match event {
        UpdateStateEvent::Checking => {
            state.status = "checking".to_string();
            state.last_error = None;
            state.ready_to_restart = false;
        }
        UpdateStateEvent::Available { target_version } => {
            state.status = "available".to_string();
            state.target_version = target_version;
            state.downloaded_bytes = 0;
            state.total_bytes = None;
            state.ready_to_restart = false;
            state.last_error = None;
        }
        UpdateStateEvent::Idle => {
            state.status = "idle".to_string();
            state.target_version = None;
            state.downloaded_bytes = 0;
            state.total_bytes = None;
            state.ready_to_restart = false;
            state.last_error = None;
        }
        UpdateStateEvent::Downloading { target_version } => {
            state.status = "downloading".to_string();
            state.target_version = target_version;
            state.downloaded_bytes = 0;
            state.total_bytes = None;
            state.last_error = None;
            state.ready_to_restart = false;
        }
        UpdateStateEvent::Progress {
            target_version,
            chunk_length,
            total_bytes,
        } => {
            state.status = "downloading".to_string();
            state.downloaded_bytes = state.downloaded_bytes.saturating_add(chunk_length);
            state.total_bytes = total_bytes;
            state.target_version = target_version;
        }
        UpdateStateEvent::Downloaded { target_version } => {
            state.status = "downloaded".to_string();
            state.target_version = target_version;
        }
        UpdateStateEvent::Installing { target_version } => {
            state.status = "installing".to_string();
            state.target_version = target_version;
        }
        UpdateStateEvent::Error { message } => {
            state.status = "error".to_string();
            state.last_error = Some(message);
        }
        UpdateStateEvent::ReadyToRestart { target_version } => {
            state.status = "readyToRestart".to_string();
            state.ready_to_restart = true;
            state.target_version = target_version;
            state.last_error = None;
        }
    }
}

fn current_release_version() -> Result<String, String> {
    crate::desktop_release::release_info().map(|info| info.desktop_version)
}

fn sync_current_version(state: &mut DesktopUpdateState) -> Result<(), String> {
    state.current_version = current_release_version()?;
    Ok(())
}

fn update_state(update: impl FnOnce(&mut DesktopUpdateState)) -> DesktopUpdateState {
    let snapshot = {
        let mut guard = update_state_store()
            .lock()
            .expect("desktop update state lock poisoned");
        update(&mut guard);
        guard.clone()
    };
    snapshot
}

fn emit_state(app: Option<&AppHandle>, snapshot: &DesktopUpdateState) {
    if let Some(handle) = app {
        let _ = handle.emit(UPDATE_EVENT_NAME, snapshot.clone());
    }
}

fn set_state(
    app: Option<&AppHandle>,
    update: impl FnOnce(&mut DesktopUpdateState),
) -> DesktopUpdateState {
    let snapshot = update_state(update);
    emit_state(app, &snapshot);
    snapshot
}

fn configured_updater_endpoint_raw() -> String {
    std::env::var("NIMI_DESKTOP_UPDATER_ENDPOINT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            option_env!("NIMI_DESKTOP_UPDATER_ENDPOINT")
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| DEFAULT_UPDATE_ENDPOINT.to_string())
}

fn updater_endpoint() -> Result<Url, String> {
    let raw = configured_updater_endpoint_raw();
    Url::parse(raw.as_str()).map_err(|error| format!("DESKTOP_UPDATER_ENDPOINT_INVALID: {error}"))
}

pub fn configured_updater_pubkey() -> Option<String> {
    std::env::var("NIMI_DESKTOP_UPDATER_PUBLIC_KEY")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            option_env!("NIMI_DESKTOP_UPDATER_PUBLIC_KEY")
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
}

pub fn updater_unavailable_reason() -> Option<String> {
    if configured_updater_pubkey().is_none() {
        return Some(
            "DESKTOP_UPDATER_UNAVAILABLE: updater public key is not configured at build time or runtime"
                .to_string(),
        );
    }

    updater_endpoint().err()
}

pub fn updater_available() -> bool {
    updater_unavailable_reason().is_none()
}

fn ensure_updater_available(app: &AppHandle) -> Result<(), String> {
    let _ = app
        .path()
        .resolve("desktop-release-manifest.json", BaseDirectory::Resource)
        .ok();
    if let Some(message) = updater_unavailable_reason() {
        return Err(message);
    }
    Ok(())
}

fn store_pending_update(payload: PendingUpdatePayload) {
    let mut guard = pending_update_store()
        .lock()
        .expect("pending desktop update lock poisoned");
    *guard = Some(payload);
}

fn clear_pending_update() {
    let mut guard = pending_update_store()
        .lock()
        .expect("pending desktop update lock poisoned");
    *guard = None;
}

fn take_pending_update() -> Option<PendingUpdatePayload> {
    pending_update_store()
        .lock()
        .expect("pending desktop update lock poisoned")
        .take()
}

#[cfg(test)]
fn reset_test_update_state() {
    {
        let mut guard = update_state_store()
            .lock()
            .expect("desktop update state lock poisoned");
        *guard = default_state();
    }
    clear_pending_update();
}

pub fn current_state() -> Result<DesktopUpdateState, String> {
    let mut snapshot = update_state_store()
        .lock()
        .expect("desktop update state lock poisoned")
        .clone();
    sync_current_version(&mut snapshot)?;
    Ok(snapshot)
}

fn current_state_with_app(app: Option<&AppHandle>) -> Result<DesktopUpdateState, String> {
    let snapshot = update_state(|state| {
        let _ = sync_current_version(state);
    });
    emit_state(app, &snapshot);
    current_state()
}

fn set_error_state(app: Option<&AppHandle>, message: String) -> String {
    set_state(app, |state| {
        let _ = sync_current_version(state);
        apply_state_event(
            state,
            UpdateStateEvent::Error {
                message: message.clone(),
            },
        );
    });
    message
}

async fn resolve_available_update(app: &AppHandle) -> Result<Option<Update>, String> {
    ensure_updater_available(app)?;
    let updater = app
        .updater_builder()
        .endpoints(vec![updater_endpoint()?])
        .map_err(|error| format!("DESKTOP_UPDATER_BUILD_FAILED: {error}"))?
        .build()
        .map_err(|error| format!("DESKTOP_UPDATER_BUILD_FAILED: {error}"))?;
    updater
        .check()
        .await
        .map_err(|error| format!("DESKTOP_UPDATER_CHECK_FAILED: {error}"))
}

pub async fn check_for_update(app: AppHandle) -> Result<DesktopUpdateCheckResult, String> {
    current_release_version()?;
    clear_pending_update();
    set_state(Some(&app), |state| {
        let _ = sync_current_version(state);
        apply_state_event(state, UpdateStateEvent::Checking);
    });
    match resolve_available_update(&app).await {
        Ok(Some(update)) => {
            let target_version = Some(update.version.clone());
            let notes = update.body.clone();
            let pub_date = update.date.map(|value| value.to_string());
            set_state(Some(&app), |state| {
                let _ = sync_current_version(state);
                apply_state_event(
                    state,
                    UpdateStateEvent::Available {
                        target_version: target_version.clone(),
                    },
                )
            });
            Ok(DesktopUpdateCheckResult {
                available: true,
                current_version: update.current_version.clone(),
                target_version,
                notes,
                pub_date,
            })
        }
        Ok(None) => {
            let current_version = current_release_version()?;
            set_state(Some(&app), |state| {
                let _ = sync_current_version(state);
                apply_state_event(state, UpdateStateEvent::Idle);
            });
            Ok(DesktopUpdateCheckResult {
                available: false,
                current_version,
                target_version: None,
                notes: None,
                pub_date: None,
            })
        }
        Err(error) => Err(set_error_state(Some(&app), error)),
    }
}

pub async fn download_update(app: AppHandle) -> Result<DesktopUpdateCheckResult, String> {
    current_release_version()?;
    clear_pending_update();
    set_state(Some(&app), |state| {
        let _ = sync_current_version(state);
        apply_state_event(state, UpdateStateEvent::Checking);
    });
    let update = match resolve_available_update(&app).await {
        Ok(Some(update)) => update,
        Ok(None) => {
            return Err(set_error_state(
                Some(&app),
                "DESKTOP_UPDATER_NO_UPDATE: no update available".to_string(),
            ));
        }
        Err(error) => return Err(set_error_state(Some(&app), error)),
    };
    let current_version = update.current_version.clone();
    let target_version = Some(update.version.clone());
    let notes = update.body.clone();
    let pub_date = update.date.map(|value| value.to_string());
    set_state(Some(&app), |state| {
        let _ = sync_current_version(state);
        apply_state_event(
            state,
            UpdateStateEvent::Downloading {
                target_version: target_version.clone(),
            },
        )
    });
    let bytes = update
        .download(
            |chunk_length, content_length| {
                set_state(Some(&app), |state| {
                    let _ = sync_current_version(state);
                    apply_state_event(
                        state,
                        UpdateStateEvent::Progress {
                            target_version: target_version.clone(),
                            chunk_length: chunk_length as u64,
                            total_bytes: content_length,
                        },
                    );
                });
            },
            || {
                set_state(Some(&app), |state| {
                    let _ = sync_current_version(state);
                    apply_state_event(
                        state,
                        UpdateStateEvent::Downloaded {
                            target_version: target_version.clone(),
                        },
                    );
                });
            },
        )
        .await
        .map_err(|error| {
            let message = format!("DESKTOP_UPDATER_DOWNLOAD_FAILED: {error}");
            set_error_state(Some(&app), message.clone());
            message
        })?;
    let install_target_version = update.version.clone();
    store_pending_update(PendingUpdatePayload {
        target_version: install_target_version.clone(),
        notes: notes.clone(),
        pub_date: pub_date.clone(),
        bytes,
        install: Box::new(move |payload| {
            update
                .install(payload)
                .map_err(|error| format!("DESKTOP_UPDATER_INSTALL_FAILED: {error}"))
        }),
    });
    Ok(DesktopUpdateCheckResult {
        available: true,
        current_version,
        target_version,
        notes,
        pub_date,
    })
}

fn install_pending_downloaded_update(
    app: Option<&AppHandle>,
) -> Result<DesktopUpdateState, String> {
    let current = current_state()?;
    if current.ready_to_restart {
        return Ok(current);
    }
    let pending = take_pending_update().ok_or_else(|| {
        set_error_state(
            app,
            "DESKTOP_UPDATER_DOWNLOAD_REQUIRED: download an update before installing it"
                .to_string(),
        )
    })?;
    crate::runtime_bridge::stop_daemon().map_err(|error| set_error_state(app, error))?;
    set_state(app, |state| {
        let _ = sync_current_version(state);
        apply_state_event(
            state,
            UpdateStateEvent::Installing {
                target_version: Some(pending.target_version.clone()),
            },
        );
    });
    if let Err(error) = (pending.install)(pending.bytes.as_slice()) {
        let target_version = pending.target_version.clone();
        let notes = pending.notes.clone();
        let pub_date = pending.pub_date.clone();
        store_pending_update(PendingUpdatePayload {
            target_version,
            notes,
            pub_date,
            bytes: pending.bytes,
            install: pending.install,
        });
        return Err(set_error_state(app, error));
    }
    set_state(app, |state| {
        let _ = sync_current_version(state);
        apply_state_event(
            state,
            UpdateStateEvent::ReadyToRestart {
                target_version: Some(pending.target_version.clone()),
            },
        );
    });
    current_state_with_app(app)
}

pub async fn install_update(app: AppHandle) -> Result<DesktopUpdateState, String> {
    if current_state()?.ready_to_restart {
        return current_state_with_app(Some(&app));
    }
    install_pending_downloaded_update(Some(&app))
}

pub fn request_restart(app: AppHandle) -> Result<(), String> {
    app.restart();
}

#[tauri::command]
pub fn desktop_update_state_get() -> Result<DesktopUpdateState, String> {
    current_state()
}

#[tauri::command]
pub async fn desktop_update_check(app: AppHandle) -> Result<DesktopUpdateCheckResult, String> {
    check_for_update(app).await
}

#[tauri::command]
pub async fn desktop_update_download(app: AppHandle) -> Result<DesktopUpdateCheckResult, String> {
    download_update(app).await
}

#[tauri::command]
pub async fn desktop_update_install(app: AppHandle) -> Result<DesktopUpdateState, String> {
    install_update(app).await
}

#[tauri::command]
pub fn desktop_update_restart(app: AppHandle) -> Result<(), String> {
    request_restart(app)
}

#[cfg(test)]
mod tests;
