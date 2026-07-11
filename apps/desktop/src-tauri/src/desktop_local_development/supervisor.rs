use super::{
    plan::DevelopmentShellPlan, AuthorityRefresh, DesktopLocalDevelopmentRuntime, RunContext,
};
use nimi_shell_tauri::capabilities::runtime::{
    self as runtime_bridge, LocalDevelopmentEndRunRequest, LocalDevelopmentLaunchRequest,
};
use notify::{RecursiveMode, Watcher};
use std::{path::Path, process::Stdio, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, BufReader},
    process::{Child, Command},
    sync::mpsc,
};

const RENDERER_READY_TIMEOUT: Duration = Duration::from_secs(60);
const HOST_HEALTH_INTERVAL: Duration = Duration::from_secs(2);
const SOURCE_REBUILD_DEBOUNCE: Duration = Duration::from_millis(450);

pub(super) async fn run(runtime: DesktopLocalDevelopmentRuntime, run: Arc<RunContext>) {
    let result = match run.plan.shell.clone() {
        DevelopmentShellPlan::Electron { .. } => run_electron(runtime.clone(), run.clone()).await,
        DevelopmentShellPlan::Tauri { .. } => run_tauri(runtime.clone(), run.clone()).await,
    };
    let current = run.status().await;
    if current.state == "pending-approval" {
        return;
    }
    let authorization_id = run.authorization_id().await.ok();
    if let Some(authorization_id) = authorization_id {
        let _ = runtime_bridge::terminate_local_development_host(run.supervisor_run_id);
        let _ = runtime_bridge::end_local_development_run(LocalDevelopmentEndRunRequest {
            authorization_id,
            supervisor_run_id: run.supervisor_run_id,
        })
        .await;
    }
    let current = run.status().await;
    if matches!(
        current.state.as_str(),
        "revoked" | "denied" | "project-changed"
    ) {
        return;
    }
    if *run.cancel_tx.borrow() {
        run.set_state("stopped", "Development run stopped", None, false)
            .await;
    } else if let Err(reason) = result {
        run.fail("failed", &reason, false).await;
    } else {
        run.set_state("stopped", "Development host exited", None, false)
            .await;
    }
    // Keep the terminal status addressable by the CLI until Desktop exits.
    let _ = runtime;
}

async fn run_electron(
    runtime: DesktopLocalDevelopmentRuntime,
    run: Arc<RunContext>,
) -> Result<(), String> {
    run.set_state(
        "building",
        "Building Electron main and preload",
        None,
        false,
    )
    .await;
    run_package_script(run.clone(), "build:electron").await?;
    let mut renderer = spawn_package_script(run.clone(), "dev:renderer").await?;
    if let Err(error) = wait_for_renderer(&run.plan.renderer_origin, &mut renderer).await {
        let _ = renderer.kill().await;
        return Err(error);
    }
    if let Err(error) = launch_electron_host(run.clone()).await {
        record_launch_error(&run, &error).await;
    }

    let source_root = run.plan.project_root.join("src-electron");
    let (watch_tx, mut watch_rx) = mpsc::unbounded_channel();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if event.is_ok() {
            let _ = watch_tx.send(());
        }
    })
    .map_err(|_| "local-development-supervisor-required".to_string())?;
    watcher
        .watch(&source_root, RecursiveMode::Recursive)
        .map_err(|_| "local-development-supervisor-required".to_string())?;
    let mut health = tokio::time::interval(HOST_HEALTH_INTERVAL);
    let mut cancel = run.cancel_tx.subscribe();
    loop {
        tokio::select! {
            changed = cancel.changed() => {
                if changed.is_err() || *cancel.borrow() {
                    break;
                }
            }
            status = renderer.wait() => {
                return Err(renderer_exit_reason(status));
            }
            _ = watch_rx.recv() => {
                tokio::time::sleep(SOURCE_REBUILD_DEBOUNCE).await;
                while watch_rx.try_recv().is_ok() {}
                run.set_state("restarting", "Rebuilding Electron main and preload", None, true).await;
                match run_package_script(run.clone(), "build:electron").await {
                    Ok(()) => {
                        if let Err(error) = launch_electron_host(run.clone()).await {
                            record_launch_error(&run, &error).await;
                        }
                    }
                    Err(error) => {
                        run.set_state("build-failed", &error, Some("local-development-build-failed"), true).await;
                    }
                }
            }
            _ = health.tick() => {
                match runtime.refresh_authority(run.clone()).await {
                    AuthorityRefresh::ApprovalRequired | AuthorityRefresh::Terminal => break,
                    AuthorityRefresh::RuntimeUnavailable => {}
                    AuthorityRefresh::Active => {
                        if let Ok(false) = runtime_bridge::local_development_host_running(run.supervisor_run_id) {
                            run.set_state("restarting", "Restarting supervised Electron host", None, true).await;
                            if let Err(error) = launch_electron_host(run.clone()).await {
                                record_launch_error(&run, &error).await;
                            }
                        }
                    }
                }
            }
        }
    }
    let _ = renderer.kill().await;
    let _ = renderer.wait().await;
    drop(watcher);
    Ok(())
}

async fn run_tauri(
    runtime: DesktopLocalDevelopmentRuntime,
    run: Arc<RunContext>,
) -> Result<(), String> {
    if !matches!(run.plan.shell, DevelopmentShellPlan::Tauri { .. }) {
        return Err("local-development-supervisor-required".to_string());
    }
    run.set_state("building", "Starting the supervised renderer", None, false)
        .await;
    let mut renderer = spawn_package_script(run.clone(), "dev:renderer").await?;
    if let Err(error) = wait_for_renderer(&run.plan.renderer_origin, &mut renderer).await {
        let _ = renderer.kill().await;
        return Err(error);
    }
    run.set_state(
        "building",
        "Building the supervised Tauri host",
        None,
        false,
    )
    .await;
    build_tauri_host(run.clone()).await?;
    launch_tauri_host(run.clone()).await?;

    let source_root = run.plan.project_root.join("src-tauri");
    let (watch_tx, mut watch_rx) = mpsc::unbounded_channel();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if event.as_ref().is_ok_and(is_tauri_source_event) {
            let _ = watch_tx.send(());
        }
    })
    .map_err(|_| "local-development-supervisor-required".to_string())?;
    watcher
        .watch(&source_root, RecursiveMode::Recursive)
        .map_err(|_| "local-development-supervisor-required".to_string())?;
    let mut cancel = run.cancel_tx.subscribe();
    let mut health = tokio::time::interval(HOST_HEALTH_INTERVAL);
    loop {
        tokio::select! {
            changed = cancel.changed() => {
                let _ = changed;
                let _ = runtime_bridge::terminate_local_development_host(run.supervisor_run_id);
                let _ = renderer.kill().await;
                let _ = renderer.wait().await;
                break Ok(());
            }
            status = renderer.wait() => {
                return Err(renderer_exit_reason(status));
            }
            _ = watch_rx.recv() => {
                tokio::time::sleep(SOURCE_REBUILD_DEBOUNCE).await;
                while watch_rx.try_recv().is_ok() {}
                let _ = runtime_bridge::terminate_local_development_host(run.supervisor_run_id);
                run.set_state("building", "Rebuilding the supervised Tauri host", None, true).await;
                match build_tauri_host(run.clone()).await {
                    Ok(()) => {
                        if let Err(error) = launch_tauri_host(run.clone()).await {
                            record_launch_error(&run, &error).await;
                        }
                    }
                    Err(error) => {
                        run.set_state("build-failed", &error, Some("local-development-build-failed"), true).await;
                    }
                }
            }
            _ = health.tick() => {
                match runtime.refresh_authority(run.clone()).await {
                    AuthorityRefresh::ApprovalRequired | AuthorityRefresh::Terminal => {
                        let _ = renderer.kill().await;
                        let _ = renderer.wait().await;
                        break Ok(());
                    }
                    AuthorityRefresh::RuntimeUnavailable => {}
                    AuthorityRefresh::Active => {
                        let status = run.status().await;
                        let host_missing = status.host_generation > 0
                            && matches!(runtime_bridge::local_development_host_running(run.supervisor_run_id), Ok(false));
                        if host_missing {
                            run.set_state("restarting", "Restarting the supervised Tauri host", None, true).await;
                            if let Err(error) = relaunch_last_tauri_host(run.clone()).await {
                                record_launch_error(&run, &error).await;
                            }
                        }
                    }
                }
            }
        }
    }
}

async fn build_tauri_host(run: Arc<RunContext>) -> Result<(), String> {
    let DevelopmentShellPlan::Tauri {
        cargo_manifest,
        cargo_package,
        ..
    } = &run.plan.shell
    else {
        return Err("local-development-supervisor-required".to_string());
    };
    let target_dir = run.plan.project_root.join("src-tauri").join("target");
    let mut command = Command::new(if cfg!(windows) { "cargo.exe" } else { "cargo" });
    command
        .current_dir(&run.plan.project_root)
        .args([
            "build",
            "--manifest-path",
            cargo_manifest.to_string_lossy().as_ref(),
            "--bin",
            cargo_package,
        ])
        .env("CARGO_TARGET_DIR", &target_dir)
        .env("CARGO_TERM_PROGRESS_WHEN", "never")
        .kill_on_drop(true)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|_| "local-development-build-failed".to_string())?;
    attach_child_logs(run, &mut child, "tauri:build");
    let status = child
        .wait()
        .await
        .map_err(|_| "local-development-build-failed".to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "local-development-build-failed-{}",
            status.code().unwrap_or(-1)
        ))
    }
}

async fn launch_tauri_host(run: Arc<RunContext>) -> Result<(), String> {
    let DevelopmentShellPlan::Tauri {
        host_executable, ..
    } = &run.plan.shell
    else {
        return Err("local-development-supervisor-required".to_string());
    };
    let executable = std::fs::canonicalize(host_executable)
        .map_err(|_| "local-development-project-changed".to_string())?;
    ensure_path_within(&run.plan.project_root, &executable)?;
    let arguments = Vec::new();
    *run.last_tauri_launch.write().await = Some((executable.clone(), arguments.clone()));
    run.set_state(
        "starting",
        "Starting the supervised Tauri host",
        None,
        false,
    )
    .await;
    let outcome = runtime_bridge::launch_local_development_host(LocalDevelopmentLaunchRequest {
        authorization_id: run.authorization_id().await?,
        supervisor_run_id: run.supervisor_run_id,
        shell_kind: run.plan.shell.kind(),
        host_executable_path: executable,
        renderer_origin: run.plan.renderer_origin.clone(),
        host_arguments: arguments,
        working_directory: run.plan.project_root.clone(),
    })
    .await
    .map_err(|error| error.reason_code().as_str().to_string())?;
    run.mark_running(outcome.process_id).await;
    Ok(())
}

async fn relaunch_last_tauri_host(run: Arc<RunContext>) -> Result<(), String> {
    let (host_executable_path, host_arguments) = run
        .last_tauri_launch
        .read()
        .await
        .clone()
        .ok_or_else(|| "local-development-supervisor-required".to_string())?;
    let outcome = runtime_bridge::launch_local_development_host(LocalDevelopmentLaunchRequest {
        authorization_id: run.authorization_id().await?,
        supervisor_run_id: run.supervisor_run_id,
        shell_kind: run.plan.shell.kind(),
        host_executable_path,
        renderer_origin: run.plan.renderer_origin.clone(),
        host_arguments,
        working_directory: run.plan.project_root.clone(),
    })
    .await
    .map_err(|error| error.reason_code().as_str().to_string())?;
    run.mark_running(outcome.process_id).await;
    Ok(())
}

async fn launch_electron_host(run: Arc<RunContext>) -> Result<(), String> {
    let DevelopmentShellPlan::Electron {
        electron_executable,
        main_entry,
    } = &run.plan.shell
    else {
        return Err("local-development-supervisor-required".to_string());
    };
    if !main_entry.is_file() {
        return Err("local-development-project-changed".to_string());
    }
    let canonical_main = std::fs::canonicalize(main_entry)
        .map_err(|_| "local-development-project-changed".to_string())?;
    ensure_path_within(&run.plan.project_root, &canonical_main)?;
    let authorization_id = run.authorization_id().await?;
    let outcome = runtime_bridge::launch_local_development_host(LocalDevelopmentLaunchRequest {
        authorization_id,
        supervisor_run_id: run.supervisor_run_id,
        shell_kind: run.plan.shell.kind(),
        host_executable_path: electron_executable.clone(),
        renderer_origin: run.plan.renderer_origin.clone(),
        host_arguments: vec![
            canonical_main.to_string_lossy().into_owned(),
            format!("--nimi-dev-renderer-url={}", run.plan.renderer_origin),
        ],
        working_directory: run.plan.project_root.clone(),
    })
    .await
    .map_err(|error| error.reason_code().as_str().to_string())?;
    run.mark_running(outcome.process_id).await;
    Ok(())
}

async fn record_launch_error(run: &RunContext, reason: &str) {
    match reason {
        "runtime-service-unavailable" => {
            run.fail("runtime-unavailable", reason, true).await;
        }
        "local-development-reapproval-required"
        | "local-development-authorization-required"
        | "principal-unauthorized" => {
            run.set_state("authorization-required", reason, Some(reason), true)
                .await;
        }
        "local-development-project-changed" => {
            run.fail("project-changed", reason, false).await;
        }
        _ => run.fail("failed", reason, false).await,
    }
}

async fn run_package_script(run: Arc<RunContext>, script: &str) -> Result<(), String> {
    let mut child = spawn_package_script(run.clone(), script).await?;
    let status = child
        .wait()
        .await
        .map_err(|_| "local-development-build-failed".to_string())?;
    if !status.success() {
        return Err(format!(
            "local-development-build-failed-{}",
            status.code().unwrap_or(-1)
        ));
    }
    Ok(())
}

async fn spawn_package_script(run: Arc<RunContext>, script: &str) -> Result<Child, String> {
    let mut command = corepack_command();
    command
        .current_dir(&run.plan.project_root)
        .args(["pnpm", "run", script])
        .kill_on_drop(true)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|_| "local-development-supervisor-required".to_string())?;
    attach_child_logs(run, &mut child, script);
    Ok(child)
}

fn attach_child_logs(run: Arc<RunContext>, child: &mut Child, label: &str) {
    if let Some(stdout) = child.stdout.take() {
        spawn_log_reader(run.clone(), stdout, format!("{label}:stdout"));
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_log_reader(run, stderr, format!("{label}:stderr"));
    }
}

fn spawn_log_reader<R>(run: Arc<RunContext>, reader: R, stream: String)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            run.log(&stream, line).await;
        }
    });
}

fn corepack_command() -> Command {
    Command::new(if cfg!(windows) {
        "corepack.cmd"
    } else {
        "corepack"
    })
}

fn renderer_exit_reason(status: std::io::Result<std::process::ExitStatus>) -> String {
    match status {
        Ok(status) => format!(
            "local-development-dev-server-exited-{}",
            status.code().unwrap_or(-1)
        ),
        Err(_) => "local-development-dev-server-uncontrolled".to_string(),
    }
}

async fn wait_for_renderer(origin: &str, renderer: &mut Child) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|_| "local-development-dev-server-uncontrolled".to_string())?;
    let deadline = tokio::time::Instant::now() + RENDERER_READY_TIMEOUT;
    loop {
        if let Some(status) = renderer
            .try_wait()
            .map_err(|_| "local-development-dev-server-uncontrolled".to_string())?
        {
            return Err(format!(
                "local-development-dev-server-exited-{}",
                status.code().unwrap_or(-1)
            ));
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("local-development-dev-server-unavailable".to_string());
        }
        match client.get(origin).send().await {
            Ok(response) if response.status().as_u16() < 500 => {
                tokio::time::sleep(Duration::from_millis(250)).await;
                if let Some(status) = renderer
                    .try_wait()
                    .map_err(|_| "local-development-dev-server-uncontrolled".to_string())?
                {
                    return Err(format!(
                        "local-development-dev-server-exited-{}",
                        status.code().unwrap_or(-1)
                    ));
                }
                return Ok(());
            }
            _ => tokio::time::sleep(Duration::from_millis(350)).await,
        }
    }
}

fn ensure_path_within(root: &Path, path: &Path) -> Result<(), String> {
    let root = root
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();
    let path = path
        .to_string_lossy()
        .replace('/', "\\")
        .to_ascii_lowercase();
    if path
        .strip_prefix(&root)
        .is_some_and(|suffix| suffix.starts_with('\\'))
    {
        return Ok(());
    }
    Err("local-development-project-changed".to_string())
}

fn is_tauri_source_event(event: &notify::Event) -> bool {
    event.paths.iter().any(|path| {
        if path.components().any(|component| {
            component
                .as_os_str()
                .to_string_lossy()
                .eq_ignore_ascii_case("target")
        }) {
            return false;
        }
        matches!(
            path.extension().and_then(|value| value.to_str()),
            Some("rs" | "toml" | "json")
        )
    })
}
