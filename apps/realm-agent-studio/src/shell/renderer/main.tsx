import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { installStudioTauriRuntimeHook } from './app-shell/tauri-runtime-hook.js';
import './styles.css';

installStudioTauriRuntimeHook();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('REALM_AGENT_STUDIO_ROOT_MISSING');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
