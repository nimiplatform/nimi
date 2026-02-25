import React, { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { initI18n } from '@renderer/i18n';
import './web-styles.css';

const App = lazy(async () => {
  const mod = await import('@renderer/App');
  return { default: mod.default };
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root mount node');
}

void initI18n().finally(() => {
  createRoot(rootElement).render(
    <Suspense fallback={null}>
      <App />
    </Suspense>,
  );
});
