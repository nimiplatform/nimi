// App-owned developer preview entry for visual evidence capture only.
// Renders TesterWorkbench inside the same theme providers as the production
// shell. The workbench still talks to the real SDK/Runtime; in a browser
// preview without Tauri the runtime inspection surfaces typed unavailable.
// This file is NOT part of the product runtime path and is only mounted via
// /dev-preview.html during local screenshot capture.

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider, TooltipProvider } from '@nimiplatform/kit/ui';
import './styles.css';
import './shell/auth/auth-i18n.js';
import { TesterWorkbench } from './tester/tester-workbench.js';

function DevPreview() {
  const [section, setSection] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSection(params.get('section'));
  }, []);

  useEffect(() => {
    if (!section) return;
    const map: Record<string, string> = {
      'app-lab': 'App Lab',
      'ai-capabilities': 'AI Capabilities',
      'ui-recipes': 'UI Recipes',
      runs: 'Runs',
      artifacts: 'Artifacts',
      'runtime-trace': 'Runtime Trace',
      'boundary-checks': 'Boundary Checks',
      settings: 'Settings',
    };
    const label = map[section];
    if (!label) return;
    const tryClick = () => {
      const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.workbench-side-nav__item'))
        .find((node) => (node.textContent || '').trim() === label);
      if (!button) return false;
      button.click();
      return true;
    };
    if (tryClick()) return;
    const handle = window.setInterval(() => {
      if (tryClick()) window.clearInterval(handle);
    }, 80);
    window.setTimeout(() => window.clearInterval(handle), 4000);
  }, [section]);

  return (
    <div className="app-shell" data-testid="nimi-tester-dev-preview-shell">
      <div className="app-shell__body">
        <TesterWorkbench title="Nimi App Lab" />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <NimiThemeProvider accentPack="nimi-accent">
      <TooltipProvider>
        <DevPreview />
      </TooltipProvider>
    </NimiThemeProvider>
  </React.StrictMode>,
);
