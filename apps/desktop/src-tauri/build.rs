use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.icns");
    println!("cargo:rerun-if-changed=resources/desktop-release-manifest.json");
    println!("cargo:rerun-if-changed=resources/runtime");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-env-changed=NIMI_DESKTOP_UPDATER_PUBLIC_KEY");
    println!("cargo:rerun-if-env-changed=NIMI_DESKTOP_UPDATER_ENDPOINT");
    validate_desktop_release_resources();
    tauri_build::build();
}

fn validate_desktop_release_resources() {
    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR should be set for build.rs"),
    );
    let cargo_version =
        std::env::var("CARGO_PKG_VERSION").expect("CARGO_PKG_VERSION should be set for build.rs");
    let resources_root = manifest_dir.join("resources");
    let manifest_path = resources_root.join("desktop-release-manifest.json");
    let manifest = read_json_object(&manifest_path).unwrap_or_else(|error| panic!("{error}"));
    let expected_fields = [
        "builtAt",
        "channel",
        "commit",
        "desktopReleaseId",
        "desktopVersion",
    ];
    let mut actual_fields = manifest.keys().map(String::as_str).collect::<Vec<_>>();
    actual_fields.sort_unstable();
    if actual_fields != expected_fields {
        panic!(
            "{} must contain only Desktop-owned release fields: {}",
            manifest_path.display(),
            expected_fields.join(", ")
        );
    }
    let desktop_version = required_string(&manifest, "desktopVersion", &manifest_path)
        .unwrap_or_else(|error| panic!("{error}"));
    if desktop_version != cargo_version {
        panic!(
            "{} desktopVersion mismatch: expected {}, got {}",
            manifest_path.display(),
            cargo_version,
            desktop_version
        );
    }
    for field in ["desktopReleaseId", "channel", "commit", "builtAt"] {
        required_string(&manifest, field, &manifest_path).unwrap_or_else(|error| panic!("{error}"));
    }

    let tauri_config_path = manifest_dir.join("tauri.conf.json");
    let tauri_config =
        read_json_object(&tauri_config_path).unwrap_or_else(|error| panic!("{error}"));
    let bundle_resources = tauri_config
        .get("bundle")
        .and_then(serde_json::Value::as_object)
        .and_then(|bundle| bundle.get("resources"))
        .and_then(serde_json::Value::as_array)
        .unwrap_or_else(|| {
            panic!(
                "{} bundle.resources is missing",
                tauri_config_path.display()
            )
        });
    if bundle_resources.iter().any(|entry| {
        entry.as_str().is_some_and(|value| {
            value == "resources/runtime" || value.starts_with("resources/runtime/")
        })
    }) {
        panic!("Tauri Desktop must not bundle Runtime resources");
    }
    let runtime_root = resources_root.join("runtime");
    let payloads = list_runtime_payloads(&runtime_root).unwrap_or_else(|error| panic!("{error}"));
    if !payloads.is_empty() {
        panic!(
            "Tauri Desktop contains forbidden Runtime payloads:\n- {}",
            payloads
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join("\n- ")
        );
    }
}

fn list_runtime_payloads(root: &Path) -> Result<Vec<PathBuf>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut payloads = Vec::new();
    for entry in std::fs::read_dir(root)
        .map_err(|error| format!("failed to read {}: {error}", root.display()))?
    {
        let entry =
            entry.map_err(|error| format!("failed to read {} entry: {error}", root.display()))?;
        let path = entry.path();
        if entry
            .file_type()
            .map_err(|error| format!("failed to inspect {}: {error}", path.display()))?
            .is_dir()
        {
            payloads.extend(list_runtime_payloads(&path)?);
            continue;
        }
        let name = entry.file_name();
        if name != ".gitignore" && name != ".gitkeep" {
            payloads.push(path);
        }
    }
    payloads.sort();
    Ok(payloads)
}

fn read_json_object(path: &Path) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    let value: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))?;
    value
        .as_object()
        .cloned()
        .ok_or_else(|| format!("expected {} to contain a JSON object", path.display()))
}

fn required_string(
    payload: &serde_json::Map<String, serde_json::Value>,
    field: &str,
    path: &Path,
) -> Result<String, String> {
    payload
        .get(field)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("missing non-empty `{field}` in {}", path.display()))
}
