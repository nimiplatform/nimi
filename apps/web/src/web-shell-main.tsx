import React from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider, applyNimiThemeAttributes } from '@nimiplatform/kit/ui';
import { desktopCanonicalRendererFactory } from '@nimiplatform/desktop/renderer/factory';
import { createDesktopProductionBindings } from '@nimiplatform/desktop/renderer/production-bindings';
import { createDesktopProductionRendererHost } from '@nimiplatform/desktop/renderer/production-host';
import '@nimiplatform/desktop/renderer/styles';
import { installBundledImportMetaEnv } from './import-meta-env.js';
import './web-styles.css';

installBundledImportMetaEnv(import.meta.env);
applyNimiThemeAttributes({ scheme: 'light', accentPack: 'nimi-accent' });

const mountElement = document.getElementById('root');
if (!mountElement) {
  throw new Error('Missing #root mount node');
}

const host = createDesktopProductionRendererHost({
  opaqueScopePrefix: 'nimi-desktop-product',
  renderer: mountElement,
});
let instance: ReturnType<typeof desktopCanonicalRendererFactory.createInstance>;
try {
  const bindings = createDesktopProductionBindings(host.binding.facade);
  instance = desktopCanonicalRendererFactory.createInstance(bindings);
} catch (error) {
  host.dispose();
  throw error;
}

const root = createRoot(mountElement);
root.render(
  <React.StrictMode>
    <NimiThemeProvider accentPack="nimi-accent" defaultScheme="light">
      {instance.surfaces.main.render()}
    </NimiThemeProvider>
  </React.StrictMode>,
);

let disposed = false;
globalThis.addEventListener('pagehide', () => {
  if (disposed) return;
  disposed = true;
  root.unmount();
  instance.dispose();
  host.dispose();
}, { once: true });
