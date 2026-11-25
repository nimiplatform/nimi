// IMPORTANT: i18n is imported FIRST so its synchronous init runs before any
// component module that calls t() / useTranslation() at module evaluation
// time. The r021 and r022 ready and degraded surfaces
// rely on i18n being ready at first paint — no loading flash, no async
// fallback path.
import './i18n/index.js';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider, type NimiThemeScheme } from '@nimiplatform/kit/ui';
import { installNimiShellRuntimeBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import { App } from './App.js';
import { t } from './i18n/index.js';
import { hasAvatarHostRuntime, listenAvatarHostEvent } from './app-shell/avatar-host-bridge.js';
import { bindAvatarRendererRootLifecycle } from './app-shell/renderer-root-lifecycle.js';
import './app.css';

function resolveSystemScheme(): NimiThemeScheme {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

function AvatarThemeRoot() {
  const [scheme, setScheme] = useState<NimiThemeScheme>(resolveSystemScheme);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setScheme(media.matches ? 'dark' : 'light');
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  return (
    <NimiThemeProvider accentPack="nimi-accent" scheme={scheme}>
      <App />
    </NimiThemeProvider>
  );
}

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
const root = createRoot(container);
const rootLifecycle = bindAvatarRendererRootLifecycle({
  target: window,
  unmount: () => root.unmount(),
  ...(hasAvatarHostRuntime() ? {
    listenClosing: (handler: () => void) => listenAvatarHostEvent('avatar://host-closing', handler),
  } : {}),
});
if (await rootLifecycle.ready) root.render(<AvatarThemeRoot />);
