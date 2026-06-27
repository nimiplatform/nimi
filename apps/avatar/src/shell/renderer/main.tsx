// IMPORTANT: i18n is imported FIRST so its synchronous init runs before any
// component module that calls t() / useTranslation() at module evaluation
// time. Wave 2 / app-shell-contract.md K-NAV-SHELL-COMPANION-* + DEGRADED-* all
// rely on i18n being ready at first paint — no loading flash, no async
// fallback path.
import './i18n/index.js';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider } from '@nimiplatform/kit/ui';
import { installNimiShellRuntimeBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import { App } from './App.js';
import { t } from './i18n/index.js';
import { installCreateImageBitmapSuspendForTauri } from './vrm/vrm-tauri-quirks.js';
import { installAvatarElectronSdkAcceptanceProbe } from './app-shell/avatar-electron-sdk-acceptance.js';
import './app.css';

installNimiShellRuntimeBridge();
installAvatarElectronSdkAcceptanceProbe();

// Install the Tauri WKWebView createImageBitmap quirk-shim before any VRM /
// Three.js code runs. Forces GLTFLoader's stable `<img>` fallback path for
// every texture decode (not just inside loadVrmFromManifest) — see
// vrm-tauri-quirks.ts for the full rationale.
installCreateImageBitmapSuspendForTauri();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Nimi Avatar: root container missing — index.html must include <div id="root"></div>');
}

if (typeof document !== 'undefined') {
  document.title = t('Avatar.shell.document_title');
}

// StrictMode is intentionally NOT used: it double-mounts effects in dev,
// which destroys + recreates the WebGL context between mounts. Our VRM
// instance cache hands the same VRM object back on mount #2, but its
// blob-backed textures have already had their object URLs revoked by
// GLTFLoader during the first canvas teardown — the second mount then
// fails to re-upload the textures and the renderer enters Context Lost.
// Three.js / R3F + cached GPU resources are not StrictMode-friendly.
createRoot(container).render(
  <NimiThemeProvider accentPack="nimi-accent" defaultScheme="light">
    <App />
  </NimiThemeProvider>,
);
