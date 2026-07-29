# Desktop product-control native core

Private macOS arm64 Node-API projection used only by the Nimi Desktop Electron
main process. It materializes and verifies Desktop-owned first-run records
through the same Rust implementation used on Windows. It is not a renderer API
and does not expose Runtime transport, credentials, or mutable authority.
