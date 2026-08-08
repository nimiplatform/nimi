import { useState } from 'react';
import { Button, InlineAlert, Surface } from '@nimiplatform/kit/ui';
import { useTranslation } from '../../shell/i18n/index.js';
import type { ResolvedWorldTourFixture } from './world-tour-shared.js';
import { useTesterRendererHost } from '../../renderer/context.js';

type WorldTourViewerCanvasProps = {
  fixture: ResolvedWorldTourFixture;
};

export function WorldTourViewerCanvas({ fixture }: WorldTourViewerCanvasProps) {
  const rendererHost = useTesterRendererHost();
  const { t } = useTranslation();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function savePreset() {
    setError(null);
    setMessage(null);
    const presetJson = JSON.stringify({ camera: 'inspection-default', savedAt: new Date(rendererHost.clock.now()).toISOString() });
    try {
      const response = await rendererHost.app.commands.saveWorldTourViewerPreset({ manifestPath: fixture.manifestPath, presetJson });
      setMessage(t('WorldTour.presetSaved', { path: response.presetPath }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause || t('WorldTour.presetSaveFailed')));
    }
  }

  return (
    <Surface className="world-tour-canvas" material="glass-regular" tone="hero" elevation="floating">
      <div className="world-tour-canvas__mesh" aria-hidden="true" />
      <div className="world-tour-canvas__content">
        <p className="eyebrow">{t('WorldTour.canvasEyebrow')}</p>
        <h2>{t('WorldTour.fixtureTitle')}</h2>
        <pre className="tester-json">{JSON.stringify(fixture, null, 2)}</pre>
        <div className="tester-actions">
          <Button type="button" tone="secondary" onClick={savePreset}>{t('WorldTour.savePreset')}</Button>
        </div>
        {error ? (
          <InlineAlert tone="danger">{error}</InlineAlert>
        ) : null}
        {message ? <p aria-live="polite" className="m-0 leading-normal text-[var(--nimi-text-secondary)]">{message}</p> : null}
      </div>
    </Surface>
  );
}
