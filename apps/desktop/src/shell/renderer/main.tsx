import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { bindRuntimeI18n } from '@nimiplatform/sdk/mod/i18n';
import { i18n, initI18n } from '@renderer/i18n';
import '@renderer/styles.css';

const App = lazy(async () => {
  const mod = await import('@renderer/App');
  return { default: mod.default };
});

if (!import.meta.env.DEV) {
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('ROOT_MOUNT_NODE_MISSING');
}

bindRuntimeI18n(i18n);

initI18n().finally(() => {
  createRoot(rootElement).render(
    <Suspense fallback={null}>
      <App />
    </Suspense>,
  );
});
