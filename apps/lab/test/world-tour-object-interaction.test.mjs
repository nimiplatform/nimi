import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const compiled = await build({
  stdin: {
    contents: `export * from './src/lab/world-tour/world-tour-objects.ts'; export * as THREE from 'three';`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
});
const { createWorldObjectLayer, THREE } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

// Minimal DOM event surface, including capture-before-bubble ordering and
// synchronous lost capture, around the actual Three controls and scene graph.
class Canvas {
  style = {};
  handlers = new Map();
  captured = new Set();
  addEventListener(type, listener, capture = false) {
    const entries = this.handlers.get(type) ?? [];
    if (!entries.some(x => x.listener === listener && x.capture === capture)) entries.push({ listener, capture });
    this.handlers.set(type, entries);
  }
  removeEventListener(type, listener, capture = false) {
    this.handlers.set(type, (this.handlers.get(type) ?? []).filter(x => x.listener !== listener || x.capture !== capture));
  }
  dispatchEvent(event) {
    const entries = [...this.handlers.get(event.type) ?? []];
    for (const capture of [true, false]) for (const entry of entries) if (entry.capture === capture) entry.listener.call(this, event);
    return true;
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) {
    if (this.captured.delete(id)) this.dispatchEvent(Object.assign(new Event('lostpointercapture'), { pointerId: id }));
  }
}

test('real TransformControls cancel interrupted drags, retain transforms and safely complete normal capture release', () => {
  const priorDocument = globalThis.document, priorWindow = globalThis.window;
  const document = new EventTarget(), window = new EventTarget();
  document.pointerLockElement = null; document.visibilityState = 'visible';
  globalThis.document = document; globalThis.window = window;
  const canvas = new Canvas(); canvas.ownerDocument = document;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(65, 800 / 600, 0.03, 100);
  camera.position.set(0, 0, 5); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(true);
  const interaction = [], changes = [];
  const layer = createWorldObjectLayer(scene, camera, canvas, items => changes.push(items), () => {}, active => interaction.push(active));
  const geometry = new THREE.BoxGeometry(1, 1, 1), material = new THREE.MeshBasicMaterial();
  const root = new THREE.Group(); root.add(new THREE.Mesh(geometry, material));
  const path = `world-tour/objects/${'b'.repeat(64)}.glb`;
  const instance = { id: '00000000-0000-4000-8000-000000000000', name: 'unit cube', asset: { relativePath: path, sha256: `sha256:${'b'.repeat(64)}`, sizeBytes: 100 }, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } };
  layer.installModel(path, { root, dimensions: [1, 1, 1], vertices: 24, triangles: 12, textureBytes: 0, dispose() { geometry.dispose(); material.dispose(); } });
  layer.add(instance);
  const gizmo = scene.children.find(x => x.isTransformControlsRoot).controls;
  let id = 0;
  const point = offset => {
    scene.updateMatrixWorld(true);
    const p = gizmo.object.position.clone().add(new THREE.Vector3(offset, 0, 0)).project(camera);
    return { clientX: (p.x + 1) * 400, clientY: (1 - p.y) * 300 };
  };
  const send = (type, offset) => canvas.dispatchEvent(Object.assign(new Event(type), point(offset), { pointerId: id, pointerType: 'mouse', button: type === 'pointermove' ? -1 : 0 }));
  const begin = () => {
    layer.update(instance.id, instance.transform); layer.select(instance.id); id++;
    send('pointerdown', 0.4);
    assert.equal(gizmo.axis, 'X'); assert.equal(gizmo.dragging, true); assert.equal(interaction.at(-1), true);
    send('pointermove', 0.65);
    assert.ok(layer.read()[0].transform.position[0] > 0.1);
  };
  try {
    for (const interrupt of [
      () => canvas.dispatchEvent(Object.assign(new Event('pointercancel'), { pointerId: id })),
      () => canvas.releasePointerCapture(id),
      () => canvas.dispatchEvent(new Event('blur')),
      () => window.dispatchEvent(new Event('blur')),
      () => { document.visibilityState = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); },
    ]) {
      begin(); const accepted = layer.read(), changeCount = changes.length;
      interrupt();
      assert.equal(gizmo.dragging, false); assert.equal(gizmo.axis, null); assert.equal(interaction.at(-1), false);
      assert.equal(canvas.hasPointerCapture(id), false); assert.deepEqual(layer.read(), accepted);
      send('pointermove', 0.8); assert.deepEqual(layer.read(), accepted); assert.equal(changes.length, changeCount);
      document.visibilityState = 'visible';
    }
    begin(); const accepted = layer.read(); let mouseUps = 0;
    gizmo.addEventListener('mouseUp', () => mouseUps++);
    send('pointerup', 0.65);
    assert.equal(mouseUps, 1); assert.equal(gizmo.dragging, false); assert.equal(interaction.at(-1), false);
    assert.deepEqual(layer.read(), accepted); assert.equal(canvas.hasPointerCapture(id), false); assert.ok(gizmo.object);
    begin(); layer.dispose(); const notifications = interaction.length;
    assert.equal(canvas.hasPointerCapture(id), false); assert.equal(interaction.at(-1), false);
    window.dispatchEvent(new Event('blur')); assert.equal(interaction.length, notifications);
  } finally {
    layer.dispose(); globalThis.document = priorDocument; globalThis.window = priorWindow;
  }
});
