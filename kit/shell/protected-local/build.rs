use std::path::PathBuf;

fn main() {
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let proto_root = manifest.join("../../../proto");
    let auth_proto = proto_root.join("runtime/v1/auth.proto");
    let app_proto = proto_root.join("runtime/v1/app.proto");
    let protoc = protoc_bin_vendored::protoc_bin_path().expect("vendored protoc");
    std::env::set_var("PROTOC", protoc);
    tonic_prost_build::configure()
        .build_client(true)
        .build_server(false)
        .compile_protos(&[auth_proto, app_proto], &[proto_root])
        .expect("compile protected Runtime auth protocol");
    println!("cargo:rerun-if-changed=../../../proto/runtime/v1/auth.proto");
    println!("cargo:rerun-if-changed=../../../proto/runtime/v1/app.proto");
    println!("cargo:rerun-if-changed=../../../proto/runtime/v1/common.proto");
}
