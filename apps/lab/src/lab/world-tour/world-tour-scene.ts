import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import type { WorldTourArchive } from './world-tour-archive.js';
import { assertWorldCameraArchive, type WorldTourCameraPreset } from './world-tour-camera.js';
import { loadWorldCollisionGeometry, type WorldCollisionGeometry } from './world-tour-collider.js';
import { createWorldWalk, validateWorldBodySize, type WorldBodySize } from './world-tour-walk.js';
import { createWorldObjectLayer } from './world-tour-objects.js';
import type { WorldObjectInstance, WorldObjectTransform } from './world-tour-composition.js';

export type WorldNavigationState = { mode: 'walk' | 'fly' | null; available: boolean; issue: 'missing' | 'invalid' | 'clearance' | null; size: WorldBodySize; pending: boolean };

export function createWorldTourScene(container: HTMLElement, world: WorldTourArchive, label: string, onNavigation?: (state: WorldNavigationState) => void,
  onObjects?: (items: WorldObjectInstance[]) => void, onSelection?: (id: string | null) => void) {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setClearColor(0x17201d);
  const canvas = renderer.domElement; canvas.tabIndex = 0; canvas.setAttribute('aria-label', label); container.appendChild(canvas);
  const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(65, 1, 0.03, 1000);
  const spark = new SparkRenderer({ renderer }); scene.add(spark);
  const splat = new SplatMesh({ fileBytes: world.splatBytes, fileName: 'world.spz' });
  splat.scale.setScalar(world.metricScaleFactor); splat.rotation.x = Math.PI; splat.position.y = world.groundPlaneOffset; scene.add(splat);
  const origin = new THREE.Vector3(0, world.groundPlaneOffset, 0); camera.position.copy(origin);
  let geometry: WorldCollisionGeometry | undefined;
  let walk: Awaited<ReturnType<typeof createWorldWalk>> | undefined;
  let size: WorldBodySize = { bodyHeight: 1.7, radius: 0.25 };
  let mode: 'walk' | 'fly' | null = null;
  let issue: WorldNavigationState['issue'] = world.colliderBytes ? null : 'missing';
  let pending = true, disposed = false, frame = 0;
  const keys = new Set<string>();
  const controls = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight']);
  let drag: { id: number; x: number; y: number } | null = null;
  const clearInput = () => { const captured = drag; drag = null; keys.clear(); if (captured && canvas.hasPointerCapture(captured.id)) canvas.releasePointerCapture(captured.id); };
  let objectDragging = false;
  const objects = createWorldObjectLayer(scene, camera, canvas, items => onObjects?.(items), id => onSelection?.(id), active => { objectDragging = active; clearInput(); });
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9ab2, 2));
  const objectLight = new THREE.DirectionalLight(0xffffff, 2); objectLight.position.set(2, 5, 3); scene.add(objectLight);
  const readNavigation = (): WorldNavigationState => ({ mode, available: Boolean(walk?.available), issue, size: { ...size }, pending });
  const changed = () => onNavigation?.(readNavigation());
  const reset = () => {
    clearInput();
    if (mode === 'walk') camera.position.copy(walk!.reset());
    else if (mode === 'fly') camera.position.copy(walk?.safeFlightEye ?? origin);
    else throw new Error('world-navigation-mode-required');
    camera.quaternion.identity(); camera.fov = 65; camera.updateProjectionMatrix();
  };
  const setMode = (next: 'walk' | 'fly') => {
    if (disposed || pending) throw new Error('world-navigation-not-ready');
    if (next === 'walk' && !walk?.available) throw new Error('world-walk-unavailable');
    clearInput(); mode = next;
    if (next === 'walk') camera.position.copy(walk!.reset());
    changed();
  };
  const setBodySize = async (next: WorldBodySize) => {
    validateWorldBodySize(next);
    if (disposed || pending || !geometry) throw new Error('world-walk-unavailable');
    clearInput(); pending = true; changed();
    try {
      const normalized = { bodyHeight: next.bodyHeight, radius: next.radius };
      const replacement = await createWorldWalk(geometry, origin, normalized);
      if (disposed) { replacement.dispose(); return; }
      walk?.dispose(); walk = replacement; size = normalized;
      issue = replacement.available ? null : 'clearance';
      if (mode === 'walk') { if (replacement.available) camera.position.copy(replacement.reset()); else mode = null; }
    } finally { pending = false; if (!disposed) changed(); }
  };
  const resize = () => {
    const width = container.clientWidth, height = container.clientHeight; if (!width || !height) return;
    renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  const down = (event: PointerEvent) => { if (event.button !== 0 || objects.interceptPointer()) return; canvas.focus(); canvas.setPointerCapture(event.pointerId); drag = { id: event.pointerId, x: event.clientX, y: event.clientY }; };
  const move = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    const rotation = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    rotation.y -= (event.clientX - drag.x) * 0.003;
    rotation.x = THREE.MathUtils.clamp(rotation.x - (event.clientY - drag.y) * 0.003, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    camera.quaternion.setFromEuler(rotation); drag.x = event.clientX; drag.y = event.clientY;
  };
  const up = () => { drag = null; };
  const keydown = (event: KeyboardEvent) => { if (document.activeElement !== canvas || objectDragging || !controls.has(event.code)) return; event.preventDefault(); keys.add(event.code); };
  const keyup = (event: KeyboardEvent) => { keys.delete(event.code); };
  const visibility = () => { if (document.visibilityState !== 'visible') clearInput(); };
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up);
  canvas.addEventListener('lostpointercapture', up); canvas.addEventListener('keydown', keydown); canvas.addEventListener('blur', clearInput);
  window.addEventListener('keyup', keyup); window.addEventListener('blur', clearInput); document.addEventListener('visibilitychange', visibility);
  const velocity = new THREE.Vector3(); let lastTime = performance.now();
  const tick = (now: number) => {
    if (disposed) return;
    const delta = Math.min((now - lastTime) / 1000, 0.1); lastTime = now;
    velocity.set(Number(keys.has('KeyD')) - Number(keys.has('KeyA')), 0, Number(keys.has('KeyS')) - Number(keys.has('KeyW')));
    const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1.6;
    if (mode === 'walk' && walk && !pending && !objectDragging) {
      const yaw = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ').y;
      if (velocity.lengthSq()) velocity.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      if (velocity.lengthSq()) camera.position.copy(walk.move(velocity, delta, speed));
    } else if (mode === 'fly' && !pending && !objectDragging) {
      if (velocity.lengthSq()) velocity.normalize().applyQuaternion(camera.quaternion);
      velocity.y += Number(keys.has('KeyE')) - Number(keys.has('KeyQ'));
      if (velocity.lengthSq()) camera.position.addScaledVector(velocity.normalize(), delta * speed);
    }
    renderer.render(scene, camera); frame = requestAnimationFrame(tick);
  };
  const ready = (async () => {
    await splat.initialized;
    if (world.colliderBytes) {
      try { geometry = await loadWorldCollisionGeometry(world.colliderBytes, world.metricScaleFactor, world.groundPlaneOffset);
        const loaded = await createWorldWalk(geometry, origin, size);
        if (disposed) { loaded.dispose(); return; }
        walk = loaded; issue = walk.available ? null : 'clearance';
      } catch { issue = 'invalid'; }
    }
    if (disposed) return;
    pending = false;
    if (walk?.available) { mode = 'walk'; camera.position.copy(walk.reset()); }
    changed(); tick(performance.now());
  })();
  return {
    ready, reset, setMode, setBodySize, readNavigation, clearInput, objects,
    suggestedObjectTransform: (): WorldObjectTransform => {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion); forward.y = 0;
      if (forward.lengthSq() < 0.01) forward.set(0, 0, -1); forward.normalize();
      const position = camera.position.clone().addScaledVector(forward, 2);
      position.y = mode === 'walk' && walk?.readState().grounded ? camera.position.y - size.bodyHeight + 0.15 : camera.position.y - 0.5;
      return { position: position.toArray(), rotation: [0, 0, 0], scale: [1, 1, 1] };
    },
    readState: () => ({ navigation: readNavigation(), walk: walk?.readState(), inputKeys: [...keys], disposed }),
    readPose: (): WorldTourCameraPreset => ({ position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov,
      ...(world.archiveSha256 ? { archiveSha256: world.archiveSha256 } : {}), ...(mode ? { navigation: { mode, ...size } } : {}) }),
    applyPose: async (pose: WorldTourCameraPreset) => {
      assertWorldCameraArchive(pose, world.archiveSha256);
      if (!mode && !pose.navigation) throw new Error('world-navigation-mode-required');
      if (pose.navigation && (pose.navigation.bodyHeight !== size.bodyHeight || pose.navigation.radius !== size.radius)) await setBodySize(pose.navigation);
      const nextMode = pose.navigation?.mode ?? mode!;
      if (nextMode === 'walk') { if (!walk?.available) throw new Error('world-walk-unavailable'); walk.applyEye(new THREE.Vector3().fromArray(pose.position)); }
      clearInput(); mode = nextMode; camera.position.fromArray(pose.position); camera.quaternion.fromArray(pose.quaternion).normalize(); camera.fov = pose.fov;
      camera.updateProjectionMatrix(); changed();
    },
    dispose: () => {
      if (disposed) return; disposed = true; clearInput(); cancelAnimationFrame(frame); observer.disconnect();
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('lostpointercapture', up); canvas.removeEventListener('keydown', keydown); canvas.removeEventListener('blur', clearInput);
      window.removeEventListener('keyup', keyup); window.removeEventListener('blur', clearInput); document.removeEventListener('visibilitychange', visibility);
      objects.dispose(); walk?.dispose(); splat.dispose(); spark.dispose(); renderer.dispose(); canvas.remove();
    },
  };
}
