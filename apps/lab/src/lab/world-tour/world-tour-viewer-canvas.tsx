import { useEffect, useRef, useState } from 'react';
import { Button, InlineAlert, Surface } from '@nimiplatform/kit/ui';
import { useTranslation } from '../../shell/i18n/index.js';
import type { ResolvedWorldTourFixture } from './world-tour-shared.js';
import { useLabRendererHost } from '../../renderer/context.js';
import { readWorldTourArchive } from './world-tour-archive.js';
import type { WorldNavigationState, createWorldTourScene } from './world-tour-scene.js';
import { parseWorldTourCameraPreset } from './world-tour-camera.js';
import { WorldTourObjectsPanel } from './world-tour-objects-panel.js';
import type { WorldObjectInstance, WorldCompositionIdentity } from './world-tour-composition.js';

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
  const [navigation, setNavigation] = useState<WorldNavigationState>({ mode: null, available: false, issue: null, pending: true, size: { bodyHeight: 1.7, radius: 0.25 } });
  const [bodyHeight, setBodyHeight] = useState('1.7');
  const [radius, setRadius] = useState('0.25');
  const viewport = useRef<HTMLDivElement>(null);
  const controls = useRef<ReturnType<typeof createWorldTourScene> | null>(null);
  const [editor, setEditor] = useState<{ scene: ReturnType<typeof createWorldTourScene>; identity: WorldCompositionIdentity } | null>(null);
  const [objects, setObjects] = useState<WorldObjectInstance[]>([]), [selectedObject, setSelectedObject] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    let scene: ReturnType<typeof createWorldTourScene> | undefined;
    setReady(false);
    setEditor(null); setObjects([]); setSelectedObject(null);
    setError(null);
    void (async () => {
      const world = await readWorldTourArchive(fixture.archivePath, rendererHost.sdk.storage.assets);
      const { createWorldTourScene } = await import('./world-tour-scene.js');
      if (canceled || !viewport.current) return;
      setTitle(world.displayName);
      scene = createWorldTourScene(viewport.current, world, t('WorldTour.sceneLabel'), state => { if (!canceled) { setNavigation(state); setBodyHeight(String(state.size.bodyHeight)); setRadius(String(state.size.radius)); } },
        items => { if (!canceled) setObjects(items); }, id => { if (!canceled) setSelectedObject(id); });
      controls.current = scene;
      await scene.ready;
      if (!canceled) { setReady(true); if (world.calibrationState === 'calibrated' && world.archiveSha256) setEditor({ scene, identity: { archivePath: fixture.archivePath, archiveSha256: world.archiveSha256 } }); }
    })().catch((cause: unknown) => {
      if (!canceled) setError(t('WorldTour.loadFailed', { detail: cause instanceof Error ? cause.message : String(cause) }));
    });
    return () => { canceled = true; controls.current = null; scene?.dispose(); };
  }, [fixture.archivePath, rendererHost, t]);

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
      const { value } = await rendererHost.sdk.localAppClient.storage.readJson(fixture.viewerPresetPath);
      await controls.current?.applyPose(parseWorldTourCameraPreset(value));
      setMessage(t('WorldTour.presetLoaded'));
    } catch (cause) {
      const missing = typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'not-found';
      setError(missing ? t('WorldTour.noPreset') : t('WorldTour.unsafePreset'));
    }
  }

  const chooseMode = (mode: 'walk' | 'fly') => {
    setError(null); setMessage(null);
    try { controls.current?.setMode(mode); } catch { setError(t('WorldTour.walkUnavailable')); }
  };
  const applySize = async () => {
    setError(null); setMessage(null);
    try { await controls.current?.setBodySize({ bodyHeight: Number(bodyHeight), radius: Number(radius) }); }
    catch { setError(t('WorldTour.bodySizeInvalid')); }
  };
  return (
    <Surface className="world-tour-canvas" material="glass-regular" elevation="floating">
      <div className="world-tour-toolbar">
        <h2>{title || t('WorldTour.viewerTitle')}</h2>
        <div className="lab-actions">
          <Button type="button" tone="secondary" disabled={!ready || !navigation.mode || navigation.pending} onClick={() => { try { controls.current?.reset(); setMessage(null); } catch { setError(t('WorldTour.walkUnavailable')); } }}>{t('WorldTour.resetView')}</Button>
          <Button type="button" tone="secondary" disabled={!ready} onClick={loadPreset}>{t('WorldTour.loadPreset')}</Button>
          <Button type="button" tone="secondary" disabled={!ready || !navigation.mode || navigation.pending} onClick={savePreset}>{t('WorldTour.savePreset')}</Button>
        </div>
      </div>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {message ? <p aria-live="polite" className="world-tour-message">{message}</p> : null}
      <div className="lab-actions world-tour-navigation" aria-label={t('WorldTour.navigation')}>
        <Button tone={navigation.mode === 'walk' ? 'primary' : 'secondary'} disabled={!ready || !navigation.available || navigation.pending} onClick={() => chooseMode('walk')}>{t('WorldTour.walkMode')}</Button>
        <Button tone={navigation.mode === 'fly' ? 'primary' : 'secondary'} disabled={!ready || navigation.pending} onClick={() => chooseMode('fly')}>{t('WorldTour.flyMode')}</Button>
        <span aria-live="polite">{t(navigation.calibrationState === 'uncalibrated' ? 'WorldTour.uncalibratedFlyActive' : navigation.mode === 'walk' ? 'WorldTour.walkActive' : navigation.mode === 'fly' ? 'WorldTour.flyActive' : 'WorldTour.chooseMode')}</span>
        {navigation.calibrationState !== 'uncalibrated' ? <>
        <label>{t('WorldTour.bodyHeight')} <input type="number" aria-label={t('WorldTour.bodyHeight')} min="0.5" max="2.4" step="0.1" value={bodyHeight} disabled={!ready || navigation.pending} onChange={event => setBodyHeight(event.target.value)} /></label>
        <label>{t('WorldTour.bodyRadius')} <input type="number" aria-label={t('WorldTour.bodyRadius')} min="0.1" max="0.4" step="0.01" value={radius} disabled={!ready || navigation.pending} onChange={event => setRadius(event.target.value)} /></label>
        <Button tone="secondary" disabled={!ready || navigation.pending || navigation.issue === 'missing' || navigation.issue === 'invalid'} onClick={() => void applySize()}>{t('WorldTour.applyBodySize')}</Button>
        </> : null}
      </div>
      {ready && navigation.issue ? <InlineAlert tone="warning">{t(navigation.issue === 'uncalibrated' ? 'WorldTour.uncalibratedHelp' : navigation.issue === 'clearance' ? 'WorldTour.noSafeSpawn' : 'WorldTour.colliderUnavailable')}</InlineAlert> : null}
      <p className="world-tour-controls">{t(navigation.mode === 'walk' ? 'WorldTour.walkHelp' : 'WorldTour.controlHelp')}</p>
      <div className="world-tour-scene-workspace">
        <div className="world-tour-viewport" ref={viewport} aria-busy={!ready && !error}>
          {!ready && !error ? <p className="world-tour-loading" role="status">{t('WorldTour.loading')}</p> : null}
        </div>
        {editor ? <WorldTourObjectsPanel key={fixture.archivePath} scene={editor.scene} identity={editor.identity} items={objects} selectedId={selectedObject} /> : null}
      </div>
    </Surface>
  );
}
