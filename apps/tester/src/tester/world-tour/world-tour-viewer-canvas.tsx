import { useState } from 'react';
import { Button, Surface } from '@nimiplatform/kit/ui';
import type { ResolvedWorldTourFixture } from './world-tour-shared.js';
import { useTesterRendererHost } from '../../renderer/context.js';

type WorldTourViewerCanvasProps = {
  fixture: ResolvedWorldTourFixture;
};

export function WorldTourViewerCanvas({ fixture }: WorldTourViewerCanvasProps) {
  const rendererHost = useTesterRendererHost();
  const [message, setMessage] = useState<string | null>(null);

  async function savePreset() {
    const presetJson = JSON.stringify({ camera: 'inspection-default', savedAt: new Date(rendererHost.clock.now()).toISOString() });
    const response = await rendererHost.app.commands.saveWorldTourViewerPreset({ manifestPath: fixture.manifestPath, presetJson });
    setMessage(`Preset saved: ${response.presetPath}`);
  }

  return (
    <Surface className="world-tour-canvas" material="glass-regular" tone="hero" elevation="floating">
      <div className="world-tour-canvas__mesh" aria-hidden="true" />
      <div className="world-tour-canvas__content">
        <p className="eyebrow">Standalone World Viewer</p>
        <h2>World-tour fixture</h2>
        <pre className="tester-json">{JSON.stringify(fixture, null, 2)}</pre>
        <div className="tester-actions">
          <Button type="button" tone="secondary" onClick={savePreset}>Save preset</Button>
        </div>
        {message ? <p className="m-0 leading-normal text-[var(--nimi-text-secondary)]">{message}</p> : null}
      </div>
    </Surface>
  );
}
