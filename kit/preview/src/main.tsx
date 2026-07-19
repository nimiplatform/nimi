import React from 'react';
import { createRoot } from 'react-dom/client';
import { NimiThemeProvider, NimiMotionProvider, TooltipProvider } from '@nimiplatform/kit/ui';
import { PreviewApp, parsePreviewParams } from './app.js';
import './styles.css';

const params = parsePreviewParams(new URLSearchParams(window.location.search));

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <NimiThemeProvider accentPack="nimi-accent" scheme={params.scheme} density={params.density}>
      <NimiMotionProvider>
        <TooltipProvider>
          <PreviewApp params={params} />
        </TooltipProvider>
      </NimiMotionProvider>
    </NimiThemeProvider>
  </React.StrictMode>,
);
