# Desktop product-control native core

Private Windows x64 Node-API projection used only by the Nimi Desktop Electron
main process. It materializes and verifies Desktop-owned first-run evidence via
the same Rust implementation consumed by the Tauri shell. It is not a renderer
API and does not expose Runtime transport, credentials, or mutable authority.
