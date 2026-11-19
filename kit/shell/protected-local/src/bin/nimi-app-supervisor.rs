#[cfg(target_os = "macos")]
#[tokio::main(flavor = "current_thread")]
async fn main() -> std::process::ExitCode {
    match nimi_shell_protected_local::run_macos_app_supervisor().await {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("Nimi App Supervisor: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}
#[cfg(not(target_os = "macos"))]
fn main() {
    std::process::exit(78);
}
