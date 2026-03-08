use std::path::{Path, PathBuf};

fn main() {
    tauri_build::build();
    generate_runtime_proto_client();
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
    if let Err(error) = tonic_build::configure()
        .build_client(true)
        .build_server(false)
        .build_transport(true)
        .out_dir(out_dir)
        .compile_protos(&full_paths, &includes)
    {
        panic!("failed to compile runtime proto for rust bridge: {error}");
    }
}
