use std::{
    fs,
    path::{Path, PathBuf},
};

fn runtime_proto_files(root: &Path) -> Vec<String> {
    let mut files = fs::read_dir(root.join("runtime/v1"))
        .expect("read Runtime proto directory")
        .filter_map(|entry| {
            let entry = entry.expect("read Runtime proto entry");
            let path = entry.path();
            (path.extension().and_then(|value| value.to_str()) == Some("proto")).then(|| {
                entry
                    .file_name()
                    .into_string()
                    .expect("UTF-8 Runtime proto filename")
            })
        })
        .collect::<Vec<_>>();
    files.sort();
    files
}

fn verify_packaged_runtime_protos(canonical_root: &Path, packaged_root: &Path) {
    let canonical_files = runtime_proto_files(canonical_root);
    let packaged_files = runtime_proto_files(packaged_root);
    assert_eq!(
        packaged_files, canonical_files,
        "packaged Runtime proto inventory drifted from the repository canonical inventory"
    );
    for file_name in canonical_files {
        let relative = Path::new("runtime/v1").join(file_name);
        let canonical =
            fs::read(canonical_root.join(&relative)).expect("read canonical Runtime proto");
        let packaged =
            fs::read(packaged_root.join(&relative)).expect("read packaged Runtime proto");
        assert_eq!(
            packaged,
            canonical,
            "packaged Runtime proto drifted: {}",
            relative.display()
        );
    }
}

fn main() {
    println!("cargo:rerun-if-env-changed=NIMI_WINDOWS_PRODUCTION_SIGNER_CERT_SHA256");
    println!("cargo:rerun-if-env-changed=NIMI_MACOS_TEAM_ID");
    let target = std::env::var("TARGET").expect("target triple");
    if target.contains("apple-darwin") {
        let mut native = cc::Build::new();
        native
            .file("src/macos_native.m")
            .flag("-fobjc-arc")
            .flag("-mmacosx-version-min=13.0")
            .warnings_into_errors(true);
        if std::env::var_os("CARGO_FEATURE_MACOS_LOCAL_DEVELOPMENT").is_some() {
            native.define("NIMI_MACOS_LOCAL_DEVELOPMENT", "1");
        }
        if std::env::var_os("CARGO_FEATURE_MACOS_SOURCE_LOCAL_DEVELOPMENT").is_some() {
            native.define("NIMI_MACOS_SOURCE_LOCAL_DEVELOPMENT", "1");
        }
        native.compile("nimi_protected_local_macos");
        println!("cargo:rustc-link-lib=framework=CoreFoundation");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=Security");
        println!("cargo:rustc-link-lib=framework=ServiceManagement");
        println!("cargo:rustc-link-lib=bsm");
        println!("cargo:rerun-if-changed=src/macos_native.m");
        println!("cargo:rerun-if-changed=src/macos_profile.h");
    }
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let proto_root = manifest.join("proto");
    let canonical_proto_root = manifest.join("../../../proto");
    if canonical_proto_root.join("runtime/v1").is_dir() {
        verify_packaged_runtime_protos(&canonical_proto_root, &proto_root);
    }
    let auth_proto = proto_root.join("runtime/v1/auth.proto");
    let runtime_service_control_proto = proto_root.join("runtime/v1/runtime_service_control.proto");
    let app_proto = proto_root.join("runtime/v1/app.proto");
    let artifact_proto = proto_root.join("runtime/v1/artifact_service.proto");
    let account_proto = proto_root.join("runtime/v1/account.proto");
    let development_proto = proto_root.join("runtime/v1/development.proto");
    let agent_source_materialization_proto =
        proto_root.join("runtime/v1/agent_source_materialization.proto");
    let agent_proto = proto_root.join("runtime/v1/agent_service.proto");
    let ai_proto = proto_root.join("runtime/v1/ai.proto");
    let ai_realtime_proto = proto_root.join("runtime/v1/ai_realtime.proto");
    let realm_realtime_proto = proto_root.join("runtime/v1/realm_realtime.proto");
    let local_runtime_proto = proto_root.join("runtime/v1/local_runtime.proto");
    let protoc = protoc_bin_vendored::protoc_bin_path().expect("vendored protoc");
    std::env::set_var("PROTOC", protoc);
    tonic_prost_build::configure()
        .build_client(true)
        .build_server(false)
        .compile_protos(
            &[
                auth_proto,
                runtime_service_control_proto,
                app_proto,
                artifact_proto,
                account_proto,
                development_proto,
                agent_source_materialization_proto,
                agent_proto,
                ai_proto,
                ai_realtime_proto,
                realm_realtime_proto,
                local_runtime_proto,
            ],
            &[proto_root.clone()],
        )
        .expect("compile protected Runtime auth protocol");
    let carrier_probe_proto = manifest.join("testdata/carrier_probe.proto");
    tonic_prost_build::configure()
        .build_client(true)
        .build_server(true)
        .compile_protos(&[carrier_probe_proto.clone()], &[manifest.clone()])
        .expect("compile protected Runtime carrier probe protocol");
    println!("cargo:rerun-if-changed={}", carrier_probe_proto.display());
    println!(
        "cargo:rerun-if-changed={}",
        proto_root.join("runtime/v1").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        canonical_proto_root.join("runtime/v1").display()
    );
}
