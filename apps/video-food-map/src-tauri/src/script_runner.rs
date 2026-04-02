use std::env;
use std::path::PathBuf;

pub fn repo_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .join("../../..")
        .canonicalize()
        .map_err(|error| format!("failed to resolve repo root: {error}"))
}

pub fn app_root() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .join("..")
        .canonicalize()
        .map_err(|error| format!("failed to resolve app root: {error}"))
}

pub fn normalize_path_env() -> String {
    let base = env::var("PATH").unwrap_or_default();
    let mut prefixes = vec![
        "/usr/local/bin".to_string(),
        "/opt/homebrew/bin".to_string(),
    ];
    if !base.trim().is_empty() {
        prefixes.push(base);
    }
    prefixes.join(":")
}

fn tsx_binary_candidates() -> Result<Vec<PathBuf>, String> {
    let repo_root = repo_root()?;
    let app_root = app_root()?;
    Ok(vec![
        app_root.join("node_modules/.bin/tsx"),
        repo_root.join("apps/realm-drift/node_modules/.bin/tsx"),
        repo_root.join("node_modules/.bin/tsx"),
    ])
}

fn find_existing_path(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.exists()).cloned()
}

pub fn best_command_path() -> Result<PathBuf, String> {
    let candidates = tsx_binary_candidates()?;
    find_existing_path(&candidates).ok_or_else(|| {
        format!(
            "tsx binary not found; looked in: {}",
            candidates
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )
    })
}
