import * as THREE from 'three';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import type { WorldTourArchive } from './world-tour-archive.js';
import type { WorldTourCameraPreset } from './world-tour-camera.js';

export function createWorldTourScene(container: HTMLElement, world: WorldTourArchive, label: string) {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x17201d);
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', label);
  container.appendChild(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, 1, 0.03, 1000);
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);
  const splat = new SplatMesh({ fileBytes: world.splatBytes, fileName: 'world.spz' });
  // SPZ is OpenCV: metric conversion, ground alignment, then a half-turn about X.
  splat.scale.setScalar(world.metricScaleFactor);
  splat.rotation.x = Math.PI;
  splat.position.y = world.groundPlaneOffset;
  scene.add(splat);
  const reset = () => {
    camera.position.set(0, world.groundPlaneOffset, 0);
    camera.quaternion.identity();
    camera.fov = 65;
    camera.updateProjectionMatrix();
  };
  reset();
  const resize = () => {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  const keys = new Set<string>();
  const controls = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight']);
  let drag: { id: number; x: number; y: number } | null = null;
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    canvas.focus();
    canvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const move = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    const rotation = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    rotation.y -= (event.clientX - drag.x) * 0.003;
    rotation.x = THREE.MathUtils.clamp(rotation.x - (event.clientY - drag.y) * 0.003, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    camera.quaternion.setFromEuler(rotation);
    drag.x = event.clientX;
    drag.y = event.clientY;
  };
  const up = () => { drag = null; };
  const keydown = (event: KeyboardEvent) => {
    if (!controls.has(event.code)) return;
    event.preventDefault();
    keys.add(event.code);
  };
  const keyup = (event: KeyboardEvent) => { keys.delete(event.code); };
  const blur = () => { keys.clear(); drag = null; };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('lostpointercapture', up);
  canvas.addEventListener('keydown', keydown);
  canvas.addEventListener('keyup', keyup);
  canvas.addEventListener('blur', blur);
  const velocity = new THREE.Vector3();
  let lastTime = performance.now();
  let frame = 0;
  let disposed = false;
  const tick = (now: number) => {
    if (disposed) return;
    const delta = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    velocity.set(Number(keys.has('KeyD')) - Number(keys.has('KeyA')), 0, Number(keys.has('KeyS')) - Number(keys.has('KeyW')));
    if (velocity.lengthSq()) velocity.normalize().applyQuaternion(camera.quaternion);
    velocity.y += Number(keys.has('KeyE')) - Number(keys.has('KeyQ'));
    if (velocity.lengthSq()) camera.position.addScaledVector(velocity.normalize(), delta * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 5 : 1.6));
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  };
  const ready = splat.initialized.then(() => { if (!disposed) tick(performance.now()); });
  return {
    ready,
    reset,
    readPose: (): WorldTourCameraPreset => ({ position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov }),
    applyPose: (pose: WorldTourCameraPreset) => {
      camera.position.fromArray(pose.position);
      camera.quaternion.fromArray(pose.quaternion).normalize();
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('lostpointercapture', up);
      canvas.removeEventListener('keydown', keydown);
      canvas.removeEventListener('keyup', keyup);
      canvas.removeEventListener('blur', blur);
      splat.dispose();
      spark.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
