import React from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider, TooltipProvider } from '@nimiplatform/kit/ui';
import { installNimiShellRuntimeBridge } from '@nimiplatform/kit/shell/renderer/bridge';
import './styles.css';
import './shell/auth/auth-i18n.js';
import { App } from './shell/App.js';

// Platform bootstrap (Kit-owned): install the scoped runtime-transport bridge
// (invoke + event listen) before any runtime/platform client is constructed, so
// SDK streaming (chat.stream) can subscribe to bridge events. No-op outside the
// Tauri webview. The app does not know the hook details — that contract lives in
// @nimiplatform/kit.
installNimiShellRuntimeBridge();

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <NimiThemeProvider accentPack="nimi-accent">
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </NimiThemeProvider>
  </React.StrictMode>,
);
