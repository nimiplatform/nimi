use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR")?);
    let repo_root = manifest_dir.join("../../..");
    let proto_root = repo_root.join("proto");
    let entrypoint = proto_root.join("runtime/v1/local_runtime_device_environment.proto");
    let protoc = protoc_bin_vendored::protoc_bin_path()?;
    let protoc_include = protoc_bin_vendored::include_path()?;

    std::env::set_var("PROTOC", protoc);
    prost_build::Config::new().compile_protos(
        std::slice::from_ref(&entrypoint),
        &[proto_root.clone(), protoc_include],
    )?;

    println!(
        "cargo:rerun-if-changed={}",
        proto_root.join("runtime/v1").display()
    );
    Ok(())
}
