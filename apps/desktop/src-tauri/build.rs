use std::path::{Path, PathBuf};

fn main() {
    validate_release_resource_versions();
    tauri_build::build();
    println!("cargo:rerun-if-changed=resources/desktop-release-manifest.json");
    println!("cargo:rerun-if-changed=resources/runtime");
    println!("cargo:rerun-if-env-changed=NIMI_DESKTOP_UPDATER_PUBLIC_KEY");
    println!("cargo:rerun-if-env-changed=NIMI_DESKTOP_UPDATER_ENDPOINT");
    generate_runtime_proto_client();
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

fn generate_runtime_proto_client() {
    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR should be set for build.rs"),
    );
    let proto_root = manifest_dir.join("../../../proto");
    if !proto_root.exists() {
        return;
    }

    let proto_files = [
        "runtime/v1/common.proto",
        "runtime/v1/auth.proto",
        "runtime/v1/grant.proto",
        "runtime/v1/ai.proto",
        "runtime/v1/workflow.proto",
        "runtime/v1/model.proto",
        "runtime/v1/knowledge.proto",
        "runtime/v1/app.proto",
        "runtime/v1/audit.proto",
    ];

    for relative in proto_files {
        let full = proto_root.join(relative);
        println!("cargo:rerun-if-changed={}", full.display());
    }

    let protoc = match protoc_bin_vendored::protoc_bin_path() {
        Ok(path) => path,
        Err(error) => {
            panic!("failed to resolve vendored protoc: {error}");
        }
    };
    unsafe {
        std::env::set_var("PROTOC", protoc);
    }

    let out_dir = Path::new("src/runtime_bridge/generated");
    if let Err(error) = std::fs::create_dir_all(out_dir) {
        panic!("failed to create runtime bridge generated dir: {error}");
    }

    let full_paths: Vec<PathBuf> = [
        "runtime/v1/common.proto",
        "runtime/v1/auth.proto",
        "runtime/v1/grant.proto",
        "runtime/v1/ai.proto",
        "runtime/v1/workflow.proto",
        "runtime/v1/model.proto",
        "runtime/v1/knowledge.proto",
        "runtime/v1/app.proto",
        "runtime/v1/audit.proto",
    ]
    .iter()
    .map(|relative| proto_root.join(relative))
    .collect();

    let includes = [proto_root];
    if let Err(error) = tonic_prost_build::configure()
        .build_client(true)
        .build_server(false)
        .build_transport(true)
        .out_dir(out_dir)
        .compile_protos(&full_paths, &includes)
    {
        panic!("failed to compile runtime proto for rust bridge: {error:?}");
    }
}
