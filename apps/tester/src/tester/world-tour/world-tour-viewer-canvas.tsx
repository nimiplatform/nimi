import { useState } from 'react';
import { Button, Surface } from '@nimiplatform/kit/ui';
import { saveWorldTourRenderAcceptance, saveWorldTourViewerPreset, type ResolvedWorldTourFixture } from './world-tour-shared.js';

type WorldTourViewerCanvasProps = {
  fixture: ResolvedWorldTourFixture;
};

export function WorldTourViewerCanvas({ fixture }: WorldTourViewerCanvasProps) {
  const [message, setMessage] = useState<string | null>(null);

  async function savePreset() {
    const presetJson = JSON.stringify({ camera: 'inspection-default', savedAt: new Date().toISOString() });
    const response = await saveWorldTourViewerPreset({ manifestPath: fixture.manifestPath, presetJson });
    setMessage(`Preset saved: ${response.presetPath}`);
  }

  async function acceptRender(status: 'passed' | 'failed') {
    await saveWorldTourRenderAcceptance({
      manifestPath: fixture.manifestPath,
      renderer: 'spark-2.0',
      status,
      acceptedAt: new Date().toISOString(),
      note: 'Manual standalone viewer acceptance.',
    });
    setMessage(`Render acceptance recorded: ${status}`);
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
          <Button type="button" tone="primary" onClick={() => void acceptRender('passed')}>Mark passed</Button>
          <Button type="button" tone="secondary" onClick={() => void acceptRender('failed')}>Mark failed</Button>
        </div>
        {message ? <p className="tester-panel__summary">{message}</p> : null}
      </div>
    </Surface>
  );
}
