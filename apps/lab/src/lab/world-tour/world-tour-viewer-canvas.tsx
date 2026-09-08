import { useEffect, useRef, useState } from 'react';
import { Button, InlineAlert, Surface } from '@nimiplatform/kit/ui';
import { useTranslation } from '../../shell/i18n/index.js';
import type { ResolvedWorldTourFixture } from './world-tour-shared.js';
import { useLabRendererHost } from '../../renderer/context.js';
import { readWorldTourArchive } from './world-tour-archive.js';
import type { createWorldTourScene } from './world-tour-scene.js';
import { parseWorldTourCameraPreset } from './world-tour-camera.js';
import { getLabLocalAppClient } from '../../shell/local-app-runtime-platform.js';

type WorldTourViewerCanvasProps = {
  fixture: ResolvedWorldTourFixture;
};

export function WorldTourViewerCanvas({ fixture }: WorldTourViewerCanvasProps) {
  const rendererHost = useLabRendererHost();
  const { t } = useTranslation();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [ready, setReady] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const controls = useRef<ReturnType<typeof createWorldTourScene> | null>(null);

  useEffect(() => {
    let canceled = false;
    let scene: ReturnType<typeof createWorldTourScene> | undefined;
    setReady(false);
    setError(null);
    void (async () => {
      const world = await readWorldTourArchive(fixture.archivePath);
      const { createWorldTourScene } = await import('./world-tour-scene.js');
      if (canceled || !viewport.current) return;
      setTitle(world.displayName);
      scene = createWorldTourScene(viewport.current, world, t('WorldTour.sceneLabel'));
      controls.current = scene;
      await scene.ready;
      if (!canceled) setReady(true);
    })().catch((cause: unknown) => {
      if (!canceled) setError(t('WorldTour.loadFailed', { detail: cause instanceof Error ? cause.message : String(cause) }));
    });
    return () => { canceled = true; controls.current = null; scene?.dispose(); };
  }, [fixture.archivePath, t]);

  async function savePreset() {
    setError(null);
    setMessage(null);
    if (!controls.current) return;
    const presetJson = JSON.stringify(controls.current.readPose());
    try {
      const response = await rendererHost.app.commands.saveWorldTourViewerPreset({ manifestPath: fixture.manifestPath, presetJson });
      setMessage(t('WorldTour.presetSaved', { path: response.presetPath }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause || t('WorldTour.presetSaveFailed')));
    }
  }

  async function loadPreset() {
    setError(null);
    setMessage(null);
    try {
      const { value } = await getLabLocalAppClient().storage.readJson(fixture.viewerPresetPath);
      controls.current?.applyPose(parseWorldTourCameraPreset(value));
      setMessage(t('WorldTour.presetLoaded'));
    } catch (cause) {
      const missing = typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'not-found';
      setError(missing ? t('WorldTour.noPreset') : t('WorldTour.presetLoadFailed'));
    }
  }

  return (
    <Surface className="world-tour-canvas" material="glass-regular" elevation="floating">
      <div className="world-tour-toolbar">
        <h2>{title || t('WorldTour.viewerTitle')}</h2>
        <div className="lab-actions">
          <Button type="button" tone="secondary" disabled={!ready} onClick={() => { controls.current?.reset(); setMessage(null); }}>{t('WorldTour.resetView')}</Button>
          <Button type="button" tone="secondary" disabled={!ready} onClick={loadPreset}>{t('WorldTour.loadPreset')}</Button>
          <Button type="button" tone="secondary" disabled={!ready} onClick={savePreset}>{t('WorldTour.savePreset')}</Button>
        </div>
      </div>
      <div className="world-tour-viewport" ref={viewport} aria-busy={!ready && !error}>
        {!ready && !error ? <p className="world-tour-loading" role="status">{t('WorldTour.loading')}</p> : null}
      </div>
      <p className="world-tour-controls">{t('WorldTour.controlHelp')}</p>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {message ? <p aria-live="polite" className="world-tour-message">{message}</p> : null}
    </Surface>
  );
}
