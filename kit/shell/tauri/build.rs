use std::path::{Path, PathBuf};

fn main() {
    // Library crate — no tauri_build::build() needed (that's for app binaries)
    configure_windows_test_manifest();
    generate_runtime_proto_client();
}

fn configure_windows_test_manifest() {
    if std::env::var("CARGO_CFG_WINDOWS").is_err() {
        return;
    }
    if std::env::var("CARGO_CFG_TARGET_ENV").ok().as_deref() != Some("msvc") {
        return;
    }

    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR should be set for build.rs"),
    );
    let manifest_path = manifest_dir.join("windows-test-manifest.xml");
    println!("cargo:rerun-if-changed={}", manifest_path.display());
    println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
    println!(
        "cargo:rustc-link-arg=/MANIFESTINPUT:{}",
        manifest_path.display()
    );
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
        "runtime/v1/runtime_service_control.proto",
        "runtime/v1/account.proto",
        "runtime/v1/ai.proto",
        "runtime/v1/local_runtime_asset_catalog.proto",
        "runtime/v1/local_runtime_device_environment.proto",
        "runtime/v1/local_runtime_execution_profile.proto",
        "runtime/v1/local_runtime_recommendation.proto",
        "runtime/v1/local_runtime_engine.proto",
        "runtime/v1/local_runtime.proto",
        "runtime/v1/knowledge.proto",
        "runtime/v1/app.proto",
        "runtime/v1/audit.proto",
        "runtime/v1/agent_common.proto",
        "runtime/v1/memory.proto",
        "runtime/v1/delegated_control.proto",
        "runtime/v1/agent_presentation.proto",
        "runtime/v1/agent_service.proto",
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

    let full_paths: Vec<PathBuf> = proto_files
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
