use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::runtime_bridge::RuntimeBridgeDaemonStatus;

use super::menu::MenuBarMenuHandles;

const HEALTH_STALE_AFTER: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuBarProviderSummary {
    pub healthy: u32,
    pub unhealthy: u32,
    pub unknown: u32,
    pub total: u32,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuBarRuntimeHealthSummary {
    pub status: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct MenuBarShellStateSnapshot {
    pub window_visible: bool,
    pub daemon_status: Option<RuntimeBridgeDaemonStatus>,
    pub runtime_health: MenuBarRuntimeHealthSummary,
    pub provider_summary: Option<MenuBarProviderSummary>,
    pub action_in_flight: Option<String>,
    pub last_updated_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct MenuBarPresentation {
    pub status_header: String,
    pub runtime_line: String,
    pub detail_line: String,
    pub providers_line: String,
    pub grpc_line: String,
    pub pid_line: String,
    pub managed_line: String,
    pub last_check_line: String,
    pub start_enabled: bool,
    pub restart_enabled: bool,
    pub stop_enabled: bool,
    pub refresh_enabled: bool,
}

#[derive(Default)]
pub struct MenuBarShellStore {
    inner: Mutex<MenuBarShellInner>,
}

struct MenuBarShellInner {
    state: MenuBarShellStateSnapshot,
    renderer_synced_at: Option<Instant>,
    quit_pending: bool,
    handles: Option<MenuBarMenuHandles>,
}

impl Default for MenuBarShellInner {
    fn default() -> Self {
        Self {
            state: MenuBarShellStateSnapshot {
                window_visible: true,
                ..MenuBarShellStateSnapshot::default()
            },
            renderer_synced_at: None,
            quit_pending: false,
            handles: None,
        }
    }
}

impl MenuBarShellStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_handles(&self, handles: MenuBarMenuHandles) {
        let mut inner = self
            .inner
            .lock()
            .expect("menu bar shell state lock poisoned");
        inner.handles = Some(handles);
    }

    pub fn set_window_visible(&self, visible: bool) {
        let mut inner = self
            .inner
            .lock()
            .expect("menu bar shell state lock poisoned");
        inner.state.window_visible = visible;
    }

    pub fn set_daemon_status(&self, status: RuntimeBridgeDaemonStatus) {
        let mut inner = self
            .inner
            .lock()
            .expect("menu bar shell state lock poisoned");
        inner.state.last_error = status.last_error.clone();
        inner.state.daemon_status = Some(status);
    }

    pub fn set_action_in_flight(&self, action: Option<&str>) {
        let mut inner = self
            .inner
            .lock()
            .expect("menu bar shell state lock poisoned");
        inner.state.action_in_flight = action.map(|value| value.to_string());
    }

    pub fn sync_renderer_health(
        &self,
        runtime_health: MenuBarRuntimeHealthSummary,
        provider_summary: Option<MenuBarProviderSummary>,
        updated_at: Option<String>,
    ) {
        let mut inner = self
            .inner
            .lock()
            .expect("menu bar shell state lock poisoned");
        inner.state.runtime_health = runtime_health;
        inner.state.provider_summary = provider_summary;
        inner.state.last_updated_at = updated_at;
        inner.renderer_synced_at = Some(Instant::now());
    }

    pub fn mark_quit_pending(&self, pending: bool) {
        let mut inner = self
            .inner
            .lock()
            .expect("menu bar shell state lock poisoned");
        inner.quit_pending = pending;
    }

    pub fn quit_pending(&self) -> bool {
        self.inner
            .lock()
            .expect("menu bar shell state lock poisoned")
            .quit_pending
    }

    pub fn with_handles<F>(&self, callback: F)
    where
        F: FnOnce(&MenuBarMenuHandles, &MenuBarShellStateSnapshot, bool, bool),
    {
        let inner = self
            .inner
            .lock()
            .expect("menu bar shell state lock poisoned");
        if let Some(handles) = inner.handles.as_ref() {
            let renderer_stale = inner
                .renderer_synced_at
                .map(|value| value.elapsed() > HEALTH_STALE_AFTER)
                .unwrap_or(true);
            callback(handles, &inner.state, renderer_stale, inner.quit_pending);
        }
    }
}

impl MenuBarShellStateSnapshot {
    pub fn presentation(&self, renderer_stale: bool, quit_pending: bool) -> MenuBarPresentation {
        let daemon = self.daemon_status.as_ref();
        let running = daemon.map(|status| status.running).unwrap_or(false);
        let managed = daemon.map(|status| status.managed).unwrap_or(false);
        let launch_mode = daemon
            .map(|status| status.launch_mode.trim().to_uppercase())
            .unwrap_or_else(|| "INVALID".to_string());

        let status_header = if quit_pending {
            "Nimi is quitting".to_string()
        } else if matches!(self.action_in_flight.as_deref(), Some("stop")) {
            "Nimi Runtime is stopping".to_string()
        } else if matches!(self.action_in_flight.as_deref(), Some("start" | "restart")) {
            "Nimi Runtime is starting".to_string()
        } else if running
            && !renderer_stale
            && self.runtime_health.status.as_deref() == Some("DEGRADED")
        {
            "Nimi Runtime is degraded".to_string()
        } else if running {
            "Nimi Runtime is running".to_string()
        } else if launch_mode == "INVALID" {
            "Nimi Runtime unavailable".to_string()
        } else {
            "Nimi Runtime is stopped".to_string()
        };

        let runtime_line = if matches!(self.action_in_flight.as_deref(), Some("stop")) {
            "Runtime: STOPPING".to_string()
        } else if matches!(self.action_in_flight.as_deref(), Some("start" | "restart")) {
            "Runtime: STARTING".to_string()
        } else if !renderer_stale {
            match self.runtime_health.status.as_deref() {
                Some(value) if !value.trim().is_empty() => format!("Runtime: {}", value.trim()),
                _ if running => "Runtime: READY".to_string(),
                _ if launch_mode == "INVALID" => "Runtime: UNAVAILABLE".to_string(),
                _ => "Runtime: STOPPED".to_string(),
            }
        } else if running {
            "Runtime: READY".to_string()
        } else if launch_mode == "INVALID" {
            "Runtime: UNAVAILABLE".to_string()
        } else {
            "Runtime: STOPPED".to_string()
        };

        let providers_line = if renderer_stale {
            "Providers: stale".to_string()
        } else if let Some(summary) = self.provider_summary.as_ref() {
            format!(
                "Providers: {} healthy / {} unhealthy / {} unknown",
                summary.healthy, summary.unhealthy, summary.unknown
            )
        } else {
            "Providers: pending".to_string()
        };

        let detail_line = if !renderer_stale {
            self.runtime_health
                .reason
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!("Detail: {}", value.trim()))
        } else {
            None
        }
        .or_else(|| {
            self.last_error
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!("Detail: {}", value.trim()))
        })
        .unwrap_or_else(|| {
            if self.window_visible {
                "Window: visible".to_string()
            } else {
                "Window: hidden".to_string()
            }
        });

        let grpc_line = format!(
            "gRPC: {}",
            daemon
                .map(|status| status.grpc_addr.as_str())
                .unwrap_or("127.0.0.1:46371")
        );
        let pid_line = format!(
            "PID: {}",
            daemon
                .and_then(|status| status.pid)
                .map(|value| value.to_string())
                .unwrap_or_else(|| "-".to_string())
        );
        let managed_line = if managed {
            "Managed by Desktop".to_string()
        } else {
            "External Runtime".to_string()
        };
        let last_check_line = format!(
            "Last check: {}",
            self.last_updated_at
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("-")
        );

        let busy = self.action_in_flight.is_some() || quit_pending;
        let start_enabled = !busy && !running && launch_mode != "INVALID";
        let restart_enabled = !busy && running && managed;
        let stop_enabled = !busy && running && managed;
        let refresh_enabled = !busy;

        MenuBarPresentation {
            status_header,
            runtime_line,
            detail_line,
            providers_line,
            grpc_line,
            pid_line,
            managed_line,
            last_check_line,
            start_enabled,
            restart_enabled,
            stop_enabled,
            refresh_enabled,
        }
    }
}
