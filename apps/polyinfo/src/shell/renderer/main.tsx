import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { bindRuntimeI18n } from '@nimiplatform/sdk/mod';
import { installSdkTauriRuntimeHook } from '@runtime/tauri-api';
import './styles.css';
import { App } from './App.js';

installSdkTauriRuntimeHook();
bindRuntimeI18n(null);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
