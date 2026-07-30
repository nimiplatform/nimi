# Desktop account profile native library

Private macOS arm64 Node-API projection used only by the Nimi Desktop Electron
main process. It provides ordinary account profile library CRUD with strict
schema validation and atomic file writes through the same Rust implementation
used on Windows. It is not a renderer API and does not expose Runtime transport,
credentials, readiness evidence, or mutable product-control authority.
