// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-002a
export function assertDesktopHostSupport(profileRef) {
  if (profileRef === 'tauri-pnpm-vite') {
    throw new Error('tauri-pnpm-vite is unsupported in this release. Use the original Tauri toolchain or explicitly migrate the App to Electron.');
  }
}
