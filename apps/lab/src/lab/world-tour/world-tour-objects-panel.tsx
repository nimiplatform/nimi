import { useEffect, useRef, useState } from 'react';
import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import type { NimiLocalAppAssetsClient } from '@nimiplatform/sdk/app';
import { useTranslation } from '../../shell/i18n/index.js';
import { useLabRendererHost } from '../../renderer/context.js';
import type { createWorldTourScene } from './world-tour-scene.js';
import { OBJECT_MAX_BYTES, loadWorldObject, type LoadedWorldObject } from './world-tour-object-asset.js';
import { checkCompositionBudget, objectDigest, readWorldComposition, readWorldObjectAsset, saveWorldComposition, validateObjectTransform,
  type WorldComposition, type WorldCompositionIdentity, type WorldObjectInstance } from './world-tour-composition.js';

type Props = { scene: ReturnType<typeof createWorldTourScene>; identity: WorldCompositionIdentity; items: WorldObjectInstance[]; selectedId: string | null };
type NumericFields = { position: string[]; rotation: string[]; scale: string[] };

export function WorldTourObjectsPanel({ scene, identity, items, selectedId }: Props) {
  const host = useLabRendererHost(); const { t } = useTranslation();
  const [baseline, setBaseline] = useState<WorldComposition | null>(null), [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [tool, setTool] = useState<'translate' | 'rotate' | 'scale'>('translate');
  const selected = items.find(x => x.id === selectedId);
  const [fields, setFields] = useState<NumericFields>({ position: ['0', '0', '0'], rotation: ['0', '0', '0'], scale: ['1', '1', '1'] });
  const dirty = loaded && JSON.stringify(items) !== JSON.stringify(baseline?.instances ?? []);
  const storage = host.sdk.localAppClient.storage;
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, [scene]);
  const explain = (cause: unknown) => {
    const code = cause instanceof Error ? cause.message : '';
    const key = code === 'world-object-limit' ? 'objectLimits' : code === 'world-object-external' ? 'objectExternal' : code === 'world-object-unsupported' ? 'objectUnsupported' :
      code === 'world-composition-conflict' ? 'sceneConflict' : code === 'world-composition-invalid' ? 'sceneInvalid' : code === 'world-object-missing' ? 'objectMissing' : 'objectInvalid';
    return t(`WorldTour.${key}`);
  };
  useEffect(() => { if (selected) setFields({ position: selected.transform.position.map(String), rotation: selected.transform.rotation.map(String), scale: selected.transform.scale.map(String) }); }, [selectedId, JSON.stringify(selected?.transform)]);
  useEffect(() => {
    let active = true; setLoaded(false); setBaseline(null); setError(''); setMessage('');
    const models = new Map<string, LoadedWorldObject>();
    void (async () => {
      const doc = await readWorldComposition(storage, identity);
      for (const item of doc?.instances ?? []) if (!models.has(item.asset.relativePath)) models.set(item.asset.relativePath, await loadWorldObject(await readWorldObjectAsset(item.asset, host.sdk.storage.assets)));
      if (!active) { models.forEach(x => x.dispose()); return; }
      scene.objects.replace(doc?.instances ?? [], models); models.clear(); setBaseline(doc); setLoaded(true);
    })().catch(cause => { models.forEach(x => x.dispose()); if (active) setError(explain(cause)); });
    return () => { active = false; };
  }, [scene, identity.archivePath, identity.archiveSha256, storage]);

  async function importFile(file: File | undefined) {
    if (!file) return; setBusy(true); setError(''); setMessage('');
    let model: LoadedWorldObject | undefined;
    try {
      if (!file.size) throw new Error('world-object-invalid');
      if (file.size > OBJECT_MAX_BYTES) throw new Error('world-object-limit');
      if (!file.name.toLowerCase().endsWith('.glb')) throw new Error('world-object-unsupported');
      const bytes = new Uint8Array(await file.arrayBuffer()); model = await loadWorldObject(bytes);
      if (!live.current) throw new Error('world-object-unavailable');
      const sha256 = await objectDigest(bytes), relativePath = `world-tour/objects/${sha256.slice(7)}.glb`;
      const instance: WorldObjectInstance = { id: crypto.randomUUID(), name: file.name.slice(0, 80), asset: { relativePath, sha256, sizeBytes: bytes.length }, transform: scene.suggestedObjectTransform() };
      const prospective = new Map(scene.objects.models); prospective.set(relativePath, model);
      checkCompositionBudget([...scene.objects.read(), instance], prospective);
      let existing: Awaited<ReturnType<NimiLocalAppAssetsClient['stat']>> | undefined;
      try { existing = await host.sdk.storage.assets.stat(relativePath); } catch (cause) { if (!cause || typeof cause !== 'object' || !('code' in cause) || cause.code !== 'not-found') throw cause; }
      const saved = existing ?? await host.sdk.storage.assets.write({ relativePath, body: bytes, mediaType: 'model/gltf-binary', overwrite: false });
      if (!live.current) throw new Error('world-object-unavailable');
      if (saved.sha256 !== sha256 || saved.sizeBytes !== bytes.length || saved.mediaType !== 'model/gltf-binary') throw new Error('world-object-missing');
      scene.objects.installModel(relativePath, model); model = undefined; scene.objects.add(instance);
    } catch (cause) { model?.dispose(); setError(explain(cause)); }
    finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const items = scene.objects.read();
      for (const item of new Map(items.map(x => [x.asset.relativePath, x])).values()) {
        const stat = await host.sdk.storage.assets.stat(item.asset.relativePath);
        if (stat.sha256 !== item.asset.sha256 || stat.sizeBytes !== item.asset.sizeBytes || stat.mediaType !== 'model/gltf-binary') throw new Error('world-object-missing');
      }
      const saved = await saveWorldComposition(storage, identity, items, baseline); setBaseline(saved); setMessage(t('WorldTour.sceneSaved'));
    }
    catch (cause) { setError(cause instanceof Error && cause.message === 'world-composition-conflict' ? explain(cause) : t('WorldTour.sceneSaveFailed')); }
    finally { setBusy(false); }
  }
  async function reload() {
    setBusy(true); setError(''); setMessage(''); const models = new Map<string, LoadedWorldObject>();
    try {
      const doc = await readWorldComposition(storage, identity);
      for (const item of doc?.instances ?? []) if (!models.has(item.asset.relativePath)) models.set(item.asset.relativePath, await loadWorldObject(await readWorldObjectAsset(item.asset, host.sdk.storage.assets)));
      scene.objects.replace(doc?.instances ?? [], models); models.clear(); setBaseline(doc); setLoaded(true); setMessage(t('WorldTour.sceneLoaded'));
    } catch (cause) { models.forEach(x => x.dispose()); setError(explain(cause)); }
    finally { setBusy(false); }
  }
  const applyFields = () => {
    if (!selected) return; setError(''); setMessage('');
    try { scene.objects.update(selected.id, validateObjectTransform(Object.fromEntries(Object.entries(fields).map(([key, values]) => [key, values.map(x => x.trim() ? Number(x) : NaN)])))); }
    catch { setError(t('WorldTour.objectTransformInvalid')); }
  };
  const dimensions = selected ? scene.objects.dimensions(selected.id) : null;
  return <aside className="world-tour-objects" aria-label={t('WorldTour.objectsTitle')}>
    <div className="world-tour-objects-heading"><h3>{t('WorldTour.objectsTitle')}</h3><span role="status">{t(!loaded ? error ? 'WorldTour.sceneUnavailable' : 'WorldTour.sceneLoading' : dirty ? 'WorldTour.sceneDirty' : baseline ? 'WorldTour.sceneClean' : 'WorldTour.sceneNone')}</span></div>
    <label className="world-tour-object-file">{t('WorldTour.importObject')}<input type="file" accept=".glb,model/gltf-binary" aria-label={t('WorldTour.importObject')} disabled={!loaded || busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void importFile(file); }} /></label>
    <p className="world-tour-object-note">{t('WorldTour.objectImportHelp')}</p>
    {busy ? <p role="status">{t('WorldTour.sceneWorking')}</p> : null}
    <ul className="world-tour-object-list">
      {items.map(item => <li key={item.id}><button type="button" aria-pressed={selectedId === item.id} onClick={() => scene.objects.select(item.id)}>{item.name}</button></li>)}
    </ul>
    {!items.length && loaded ? <p className="world-tour-object-note">{t('WorldTour.objectsEmpty')}</p> : null}
    {selected ? <>
      <p className="world-tour-object-dimensions">{t('WorldTour.objectDimensions', { size: dimensions?.map(x => x.toFixed(2)).join(' × ') })}</p>
      <div className="lab-actions" role="group" aria-label={t('WorldTour.objectTools')}>{(['translate', 'rotate', 'scale'] as const).map(mode => <Button key={mode} aria-pressed={tool === mode} tone={tool === mode ? 'primary' : 'secondary'} disabled={busy} onClick={() => { setTool(mode); scene.objects.setTool(mode); }}>{t(`WorldTour.objectTool${mode}`)}</Button>)}</div>
      <p className="world-tour-object-note">{t('WorldTour.objectDragHelp')}</p>
      {(['position', 'rotation', 'scale'] as const).map(group => <fieldset key={group} className="world-tour-object-transform"><legend>{t(`WorldTour.object${group}`)}</legend><div>{['X', 'Y', 'Z'].map((axis, index) => <label key={axis}>{axis}<input type="number" aria-label={t(`WorldTour.object${group}`) + ' ' + axis} step={group === 'rotation' ? '5' : '0.1'} value={fields[group][index]} disabled={busy} onChange={event => setFields(current => ({ ...current, [group]: current[group].map((value, i) => i === index ? event.target.value : value) }))} /></label>)}</div></fieldset>)}
      <div className="lab-actions"><Button tone="secondary" disabled={busy} onClick={applyFields}>{t('WorldTour.applyObjectTransform')}</Button><Button tone="secondary" disabled={busy} onClick={() => { scene.objects.remove(selected.id); setMessage(''); setError(''); }}>{t('WorldTour.removeObject')}</Button></div>
    </> : null}
    <p className="world-tour-object-note">{t('WorldTour.objectCollisionHelp')}</p>
    <div className="lab-actions"><Button disabled={!loaded || busy || !dirty} onClick={() => void save()}>{t('WorldTour.saveScene')}</Button><Button tone="secondary" disabled={busy} onClick={() => void reload()}>{t('WorldTour.loadScene')}</Button></div>
    <p className="world-tour-object-note">{t('WorldTour.sceneUnsavedHelp')}</p>
    {error ? <InlineAlert tone="warning">{error}</InlineAlert> : null}
    {message ? <p role="status">{message}</p> : null}
  </aside>;
}
