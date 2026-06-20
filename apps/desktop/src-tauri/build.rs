use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.icns");
    validate_release_resource_versions();
    tauri_build::build();
    println!("cargo:rerun-if-changed=resources/desktop-release-manifest.json");
    println!("cargo:rerun-if-changed=resources/runtime");
    println!("cargo:rerun-if-env-changed=NIMI_DESKTOP_UPDATER_PUBLIC_KEY");
    println!("cargo:rerun-if-env-changed=NIMI_DESKTOP_UPDATER_ENDPOINT");
}

fn validate_release_resource_versions() {
    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR should be set for build.rs"),
    );
    let cargo_version =
        std::env::var("CARGO_PKG_VERSION").expect("CARGO_PKG_VERSION should be set for build.rs");
    let resources_root = manifest_dir.join("resources");
    let desktop_release_path = resources_root.join("desktop-release-manifest.json");
    let runtime_manifest_path = resources_root.join("runtime").join("manifest.json");

    let desktop_release =
        read_json_object(&desktop_release_path).unwrap_or_else(|error| panic!("{error}"));
    let runtime_manifest =
        read_json_object(&runtime_manifest_path).unwrap_or_else(|error| panic!("{error}"));

    let desktop_version =
        required_string(&desktop_release, "desktopVersion", &desktop_release_path)
            .unwrap_or_else(|error| panic!("{error}"));
    let runtime_version =
        required_string(&desktop_release, "runtimeVersion", &desktop_release_path)
            .unwrap_or_else(|error| panic!("{error}"));
    let runtime_manifest_version =
        required_string(&runtime_manifest, "version", &runtime_manifest_path)
            .unwrap_or_else(|error| panic!("{error}"));

    let mut violations = Vec::new();
    if desktop_version != cargo_version {
        violations.push(format!(
            "{} desktopVersion mismatch: expected {}, got {}",
            desktop_release_path.display(),
            cargo_version,
            desktop_version
        ));
    }
    if runtime_version != cargo_version {
        violations.push(format!(
            "{} runtimeVersion mismatch: expected {}, got {}",
            desktop_release_path.display(),
            cargo_version,
            runtime_version
        ));
    }
    if runtime_manifest_version != cargo_version {
        violations.push(format!(
            "{} version mismatch: expected {}, got {}",
            runtime_manifest_path.display(),
            cargo_version,
            runtime_manifest_version
        ));
    }

    if !violations.is_empty() {
        panic!(
            "desktop release resource version sync failed:\n- {}",
            violations.join("\n- ")
        );
    }
}

fn read_json_object(path: &Path) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    let value: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse {}: {error}", path.display()))?;
    match value {
        serde_json::Value::Object(object) => Ok(object),
        _ => Err(format!(
            "expected {} to contain a JSON object",
            path.display()
        )),
    }
}

fn required_string(
    payload: &serde_json::Map<String, serde_json::Value>,
    field: &str,
    path: &Path,
) -> Result<String, String> {
    let value = payload
        .get(field)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("missing non-empty `{field}` in {}", path.display()))?;
    Ok(value.to_string())
}
