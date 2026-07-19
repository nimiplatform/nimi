use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-env-changed=NIMI_WINDOWS_PRODUCTION_SIGNER_CERT_SHA256");
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
    let proto_root = manifest.join("../../../proto");
    let auth_proto = proto_root.join("runtime/v1/auth.proto");
    let runtime_service_control_proto = proto_root.join("runtime/v1/runtime_service_control.proto");
    let app_proto = proto_root.join("runtime/v1/app.proto");
    let artifact_proto = proto_root.join("runtime/v1/artifact_service.proto");
    let account_proto = proto_root.join("runtime/v1/account.proto");
    let development_proto = proto_root.join("runtime/v1/development.proto");
    let agent_proto = proto_root.join("runtime/v1/agent_service.proto");
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
                agent_proto,
                local_runtime_proto,
            ],
            &[proto_root],
        )
        .expect("compile protected Runtime auth protocol");
    println!("cargo:rerun-if-changed=../../../proto/runtime/v1/auth.proto");
    println!("cargo:rerun-if-changed=../../../proto/runtime/v1/runtime_service_control.proto");
    println!("cargo:rerun-if-changed=../../../proto/runtime/v1/app.proto");
    println!("cargo:rerun-if-changed=../../../proto/runtime/v1/artifact_service.proto");
    println!("cargo:rerun-if-changed=../../../proto/runtime/v1/account.proto");
    println!("cargo:rerun-if-changed=../../../proto/runtime/v1/development.proto");
    println!("cargo:rerun-if-changed=../../../proto/runtime/v1/agent_service.proto");
    println!("cargo:rerun-if-changed=../../../proto/runtime/v1/local_runtime.proto");
    println!("cargo:rerun-if-changed=../../../proto/runtime/v1/common.proto");
}
