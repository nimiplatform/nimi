# Desktop product-control native core

Private Windows x64 Node-API projection used only by the Nimi Desktop Electron
main process. It materializes and verifies Desktop-owned first-run evidence via
the shared Product Control Rust core. It is not a renderer API and does not
expose Runtime transport, credentials, or mutable authority.

`nimi_desktop_product_control.node` is a generated, signed build output and is
intentionally excluded from Git. On Windows x64, provision the local development
signing identity once with `pnpm provision:windows-dev-trust`, then build it with
`pnpm --filter @nimiplatform/desktop build:windows:product-control-native`.
Desktop Electron development and the native smoke test rebuild it automatically.
