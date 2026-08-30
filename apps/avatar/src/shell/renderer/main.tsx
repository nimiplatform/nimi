// IMPORTANT: i18n is imported FIRST so its synchronous init runs before any
// component module that calls t() / useTranslation() at module evaluation
// time. The r021 and r022 ready and degraded surfaces
// rely on i18n being ready at first paint — no loading flash, no async
// fallback path.
import './i18n/index.js';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider } from '@nimiplatform/kit/ui';
import { installNimiShellRuntimeBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import { App } from './App.js';
import { t } from './i18n/index.js';
import './app.css';

installNimiShellRuntimeBridge();

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
