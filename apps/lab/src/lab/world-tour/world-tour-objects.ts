import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { checkCompositionBudget, validateObjectTransform, type WorldObjectInstance, type WorldObjectTransform } from './world-tour-composition.js';
import type { LoadedWorldObject } from './world-tour-object-asset.js';

export function createWorldObjectLayer(scene: THREE.Scene, camera: THREE.Camera, canvas: HTMLCanvasElement,
  changed: (instances: WorldObjectInstance[]) => void, selected: (id: string | null) => void, interacting: (active: boolean) => void) {
  const models = new Map<string, LoadedWorldObject>(), items = new Map<string, { instance: WorldObjectInstance; group: THREE.Group }>();
  const root = new THREE.Group(); scene.add(root);
  const gizmo = new TransformControls(camera, canvas); gizmo.setSize(0.85); const helper = gizmo.getHelper(); scene.add(helper);
  const outline = new THREE.BoxHelper(root, 0x1476d4); outline.visible = false; scene.add(outline);
  let selection: string | null = null, disposed = false;
  const snapshot = () => [...items.values()].map(({ instance }) => JSON.parse(JSON.stringify(instance)) as WorldObjectInstance);
  const updateOutline = () => { const group = selection ? items.get(selection)?.group : undefined; outline.visible = Boolean(group); if (group) outline.setFromObject(group); };
  const select = (id: string | null) => {
    if (gizmo.dragging) cancelInteraction();
    selection = id && items.has(id) ? id : null;
    const group = selection ? items.get(selection)!.group : undefined;
    if (group) gizmo.attach(group); else gizmo.detach();
    updateOutline(); selected(selection);
  };
  const apply = (group: THREE.Group, transform: WorldObjectTransform) => {
    group.position.fromArray(transform.position); group.rotation.set(...transform.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]); group.scale.fromArray(transform.scale); group.updateMatrixWorld(true);
  };
  const update = (id: string, transform: WorldObjectTransform) => {
    const item = items.get(id); if (!item || disposed) throw new Error('world-object-missing');
    item.instance.transform = validateObjectTransform(transform); apply(item.group, item.instance.transform); updateOutline(); changed(snapshot());
  };
  const drag = (event: { value: unknown }) => interacting(Boolean(event.value));
  const objectChange = () => {
    const item = selection ? items.get(selection) : undefined; if (!item || disposed) return;
    try { update(item.instance.id, { position: item.group.position.toArray(), rotation: [item.group.rotation.x, item.group.rotation.y, item.group.rotation.z].map(THREE.MathUtils.radToDeg) as [number, number, number], scale: item.group.scale.toArray() }); }
    catch { apply(item.group, item.instance.transform); }
  };
  gizmo.addEventListener('dragging-changed', drag); gizmo.addEventListener('objectChange', objectChange);
  const addGroup = (instance: WorldObjectInstance) => {
    const model = models.get(instance.asset.relativePath); if (!model) throw new Error('world-object-missing');
    const group = model.root.clone(true); group.traverse(node => { node.userData.worldObjectInstance = instance.id; });
    apply(group, instance.transform); root.add(group); items.set(instance.id, { instance: JSON.parse(JSON.stringify(instance)), group });
  };
  let pointer: { x: number; y: number } | null = null;
  let capturedPointer: number | null = null;
  const cancelInteraction = () => {
    const id = capturedPointer;
    capturedPointer = null; pointer = null;
    // Keep the last validated transform/dirty state; end the gesture rather
    // than resetting the object to its starting pose.
    gizmo.pointerUp(null);
    interacting(false);
    if (id !== null && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  };
  const down = (event: PointerEvent) => {
    if (event.button === 0) { capturedPointer = event.pointerId; pointer = { x: event.clientX, y: event.clientY }; }
  };
  const beforeUp = (event: PointerEvent) => {
    if (event.pointerId !== capturedPointer) return;
    // Three releases capture before its pointerUp. Retire the id in capture
    // phase so that synchronous lostpointercapture cannot end that gesture twice.
    capturedPointer = null;
    if (gizmo.dragging) pointer = null;
  };
  const interrupted = (event: PointerEvent) => { if (event.pointerId === capturedPointer) cancelInteraction(); };
  const visibility = () => { if (document.visibilityState !== 'visible') cancelInteraction(); };
  const up = (event: PointerEvent) => {
    const start = pointer; pointer = null;
    if (!start || gizmo.dragging || gizmo.axis || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
    const rect = canvas.getBoundingClientRect(), ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = ray.intersectObject(root, true).find(x => typeof x.object.userData.worldObjectInstance === 'string');
    select(hit ? hit.object.userData.worldObjectInstance : null);
  };
  canvas.addEventListener('pointerdown', down, true); canvas.addEventListener('pointerup', beforeUp, true); canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', interrupted); canvas.addEventListener('lostpointercapture', interrupted); canvas.addEventListener('blur', cancelInteraction);
  window.addEventListener('blur', cancelInteraction); document.addEventListener('visibilitychange', visibility);
  return {
    read: snapshot, models, select, update, interceptPointer: () => Boolean(gizmo.axis || gizmo.dragging),
    setTool: (mode: 'translate' | 'rotate' | 'scale') => { gizmo.setMode(mode); gizmo.setSpace(mode === 'translate' ? 'world' : 'local'); },
    installModel: (path: string, model: LoadedWorldObject) => { if (disposed) { model.dispose(); throw new Error('world-object-unavailable'); } if (models.has(path)) model.dispose(); else models.set(path, model); },
    add: (instance: WorldObjectInstance) => { if (disposed) throw new Error('world-object-unavailable'); checkCompositionBudget([...snapshot(), instance], models); addGroup(instance); select(instance.id); changed(snapshot()); },
    remove: (id: string) => {
      const item = items.get(id); if (!item) return; if (selection === id) select(null); root.remove(item.group); items.delete(id);
      if (![...items.values()].some(x => x.instance.asset.relativePath === item.instance.asset.relativePath)) { models.get(item.instance.asset.relativePath)?.dispose(); models.delete(item.instance.asset.relativePath); }
      changed(snapshot());
    },
    replace: (instances: WorldObjectInstance[], loaded: Map<string, LoadedWorldObject>) => {
      if (disposed) throw new Error('world-object-unavailable');
      checkCompositionBudget(instances, loaded); select(null); root.clear(); models.forEach(x => x.dispose()); models.clear(); items.clear();
      loaded.forEach((model, path) => models.set(path, model)); instances.forEach(addGroup); changed(snapshot());
    },
    dimensions: (id: string): [number, number, number] | null => {
      const item = items.get(id); return item ? new THREE.Box3().setFromObject(item.group).getSize(new THREE.Vector3()).toArray() : null;
    },
    dispose: () => {
      if (disposed) return; cancelInteraction(); disposed = true; select(null);
      canvas.removeEventListener('pointerdown', down, true); canvas.removeEventListener('pointerup', beforeUp, true); canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', interrupted); canvas.removeEventListener('lostpointercapture', interrupted); canvas.removeEventListener('blur', cancelInteraction);
      window.removeEventListener('blur', cancelInteraction); document.removeEventListener('visibilitychange', visibility);
      gizmo.removeEventListener('dragging-changed', drag); gizmo.removeEventListener('objectChange', objectChange);
      gizmo.dispose(); outline.geometry.dispose(); (outline.material as THREE.Material).dispose(); models.forEach(x => x.dispose()); models.clear(); items.clear(); scene.remove(root, helper, outline);
    },
  };
}
