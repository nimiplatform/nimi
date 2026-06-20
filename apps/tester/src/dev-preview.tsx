// App-owned developer preview entry for visual evidence capture only.
// Renders TesterWorkbench inside the same theme providers as the production
// shell. The workbench still talks to the real SDK/Runtime; in a browser
// preview without Tauri the runtime inspection surfaces typed unavailable.
// This file is NOT part of the product runtime path and is only mounted via
// /dev-preview.html during local screenshot capture.

import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AmbientBackground, NimiThemeProvider, TooltipProvider } from '@nimiplatform/kit/ui';
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
      text: 'Text Studio',
      'text.generate': 'Text Studio',
      chat: 'Chat Stream',
      'chat.stream': 'Chat Stream',
      embed: 'Embeddings',
      'text.embed': 'Embeddings',
      image: 'Image Generate',
      'image.generate': 'Image Generate',
      video: 'Video Generate',
      'video.generate': 'Video Generate',
      tts: 'Speech Synthesis',
      'audio.synthesize': 'Speech Synthesis',
      stt: 'Speech Transcribe',
      'audio.transcribe': 'Speech Transcribe',
      'speech-bundle': 'Speech Bundle',
      world: 'World Tour',
      'ui-recipes': 'UI Recipes',
    };
    const label = map[section];
    if (!label) return;
    const tryClick = () => {
      // Capability cards live in the Console rail; section buttons live in the
      // dock. Both expose aria-labels, so a document-wide lookup resolves either.
      const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${CSS.escape(label)}"]`);
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
    <AmbientBackground
      variant="mesh"
      className="app-shell"
      data-testid="nimi-tester-dev-preview-shell"
    >
      <TesterWorkbench title="Nimi Lab" />
    </AmbientBackground>
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
