import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@nimiplatform/nimi-kit/ui';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { invokeTauri } from '@runtime/tauri-api';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import {
  asOptionalString,
  normalizeViewerPresetVector,
  type ResolvedWorldTourFixture,
  resolveWorldTourAssetUrl,
  type WorldTourViewerPreset,
  type WorldTourViewerPresetVector,
  worldTourFixtureToWorldResult,
  worldTourTitle,
} from './world-tour-shared';

type ResolveWorldTourFixtureResponse = ResolvedWorldTourFixture;
type SaveWorldTourViewerPresetResponse = {
  manifestPath: string;
  presetPath: string;
  viewerPreset: WorldTourViewerPreset;
};

type ComputedInspectView = {
  position: any;
  target: any;
  source: WorldTourViewerPreset['source'];
};

type ViewerControlMode = 'pilot-target' | 'inspect';

const WORLD_TOUR_UPRIGHT_QUATERNION = new THREE.Quaternion(1, 0, 0, 0);
const PILOT_LOOK_HEIGHT = 2.4;
const PILOT_CAMERA_HEIGHT = 6.4;
const PILOT_CAMERA_DISTANCE = 18;

function useManifestPath(): string {
  const location = useLocation();
  return React.useMemo(() => {
    const params = new URLSearchParams(location.search);
    return asOptionalString(params.get('manifestPath'));
  }, [location.search]);
}

function closeViewerWindow(fallback: () => void) {
  try {
    window.close();
    window.setTimeout(() => {
      if (!window.closed) {
        fallback();
      }
    }, 150);
  } catch {
    fallback();
  }
}

function presetVectorToThree(value: WorldTourViewerPresetVector): any {
  return new THREE.Vector3(value.x, value.y, value.z);
}

function threeVectorToPreset(value: any): WorldTourViewerPresetVector {
  return {
    x: Number(value.x.toFixed(6)),
    y: Number(value.y.toFixed(6)),
    z: Number(value.z.toFixed(6)),
  };
}

function computedViewToPreset(
  view: ComputedInspectView,
  source: WorldTourViewerPreset['source'],
): WorldTourViewerPreset {
  return {
    version: 1,
    mode: 'inspect',
    source,
    camera: {
      position: threeVectorToPreset(view.position),
      target: threeVectorToPreset(view.target),
    },
  };
}

function presetToComputedView(preset: WorldTourViewerPreset): ComputedInspectView | null {
  const position = normalizeViewerPresetVector(preset.camera.position);
  const target = normalizeViewerPresetVector(preset.camera.target);
  if (!position || !target) {
    return null;
  }
  return {
    position: presetVectorToThree(position),
    target: presetVectorToThree(target),
    source: preset.source,
  };
}

function buildInspectViewFromBox(
  box: any,
  source: WorldTourViewerPreset['source'],
): ComputedInspectView {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() * 0.5, 40);
  const target = new THREE.Vector3(
    center.x,
    box.max.y - Math.max(size.y * 0.18, 6),
    center.z + size.z * 0.02,
  );
  const direction = new THREE.Vector3(0.24, 0.28, 1).normalize();
  const distance = Math.max(radius * 1.5, size.z * 1.35, 120);
  const position = target.clone().add(direction.multiplyScalar(distance));
  return { position, target, source };
}

function rotateBoxByQuaternion(box: any, quaternion: any): any {
  const corners: any[] = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        corners.push(new THREE.Vector3(x, y, z).applyQuaternion(quaternion));
      }
    }
  }
  return new THREE.Box3().setFromPoints(corners);
}

function resolvePilotSpawnPoint(box: any, raycastMeshes: any[]): any | null {
  if (!box || raycastMeshes.length === 0) {
    return null;
  }
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const originY = box.max.y + Math.max(size.y * 0.4, 12);
  const castDistance = size.y + Math.max(size.y * 0.8, 64);
  const raycaster = new THREE.Raycaster();
  const offsets: Array<[number, number]> = [
    [0, 0],
    [0.08, 0],
    [-0.08, 0],
    [0, 0.08],
    [0, -0.08],
    [0.16, 0.12],
    [-0.16, 0.12],
    [0.16, -0.12],
    [-0.16, -0.12],
    [0.26, 0],
    [-0.26, 0],
    [0, 0.26],
    [0, -0.26],
  ];
  for (const [ox, oz] of offsets) {
    const origin = new THREE.Vector3(
      center.x + size.x * ox,
      originY,
      center.z + size.z * oz,
    );
    raycaster.set(origin, new THREE.Vector3(0, -1, 0));
    raycaster.far = castDistance;
    const hits = raycaster.intersectObjects(raycastMeshes, false);
    if (hits.length > 0) {
      return hits[0].point.clone();
    }
  }
  return center.clone();
}

export function WorldTourViewerRoute() {
  const navigate = useNavigate();
  const manifestPath = useManifestPath();
  const [fixture, setFixture] = React.useState<ResolvedWorldTourFixture | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    if (!manifestPath) {
      setError('Missing world-tour manifest path.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    void invokeTauri<ResolveWorldTourFixtureResponse>('resolve_world_tour_fixture', {
      payload: { manifestPath },
    }).then((response) => {
      if (cancelled) return;
      setFixture(response);
      setLoading(false);
    }).catch((loadError) => {
      if (cancelled) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError || 'Failed to resolve world-tour fixture.'));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [manifestPath]);

  const fallbackClose = React.useCallback(() => {
    navigate('/', { replace: true });
  }, [navigate]);

  if (loading) {
    return (
      <div data-testid={E2E_IDS.worldTourViewerRoot} className="flex min-h-screen items-center justify-center bg-[#03060b] text-sm text-white/72">
        Resolving world-tour fixture...
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid={E2E_IDS.worldTourViewerRoot} className="flex min-h-screen items-center justify-center bg-[#03060b] px-6">
        <div className="max-w-[720px] rounded-[24px] border border-[var(--nimi-status-danger)] bg-black/30 px-5 py-4 text-sm text-[var(--nimi-status-danger)]">
          {error}
        </div>
      </div>
    );
  }

  if (!fixture) {
    return null;
  }

  return (
    <div data-testid={E2E_IDS.worldTourViewerRoot} className="min-h-screen bg-[#03060b] text-white">
      <WorldTourViewerCanvas fixture={fixture} onClose={() => closeViewerWindow(fallbackClose)} />
    </div>
  );
}

function WorldTourViewerCanvas(props: { fixture: ResolvedWorldTourFixture; onClose: () => void }) {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const fitSceneRef = React.useRef<(() => void) | null>(null);
  const resetViewRef = React.useRef<(() => void) | null>(null);
  const saveViewRef = React.useRef<(() => Promise<void>) | null>(null);
  const setColliderVisibleRef = React.useRef<((next: boolean) => void) | null>(null);
  const activatePilotModeRef = React.useRef<(() => void) | null>(null);
  const controlModeRef = React.useRef<ViewerControlMode>('pilot-target');
  const [booting, setBooting] = React.useState(true);
  const [error, setError] = React.useState('');
  const [showCollider, setShowCollider] = React.useState(false);
  const [colliderStatus, setColliderStatus] = React.useState('Collider: pending');
  const [actionStatus, setActionStatus] = React.useState('');
  const [saveBusy, setSaveBusy] = React.useState(false);
  const [controlMode, setControlMode] = React.useState<ViewerControlMode>('pilot-target');
  const [targetStatus, setTargetStatus] = React.useState('Target: active');
  const world = React.useMemo(() => worldTourFixtureToWorldResult(props.fixture), [props.fixture]);

  React.useEffect(() => {
    controlModeRef.current = controlMode;
  }, [controlMode]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        props.onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [props.onClose]);

  React.useEffect(() => {
    setColliderVisibleRef.current?.(showCollider);
  }, [showCollider]);

  React.useEffect(() => {
    if (controlMode === 'pilot-target') {
      activatePilotModeRef.current?.();
    }
  }, [controlMode]);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    setBooting(true);
    setError('');
    setActionStatus('');
    setColliderStatus(props.fixture.colliderMeshLocalPath || props.fixture.colliderMeshRemoteUrl
      ? 'Collider: loading in background'
      : 'Collider: not provided');

    let disposed = false;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#03060b');
    const camera = new THREE.PerspectiveCamera(58, 1, 0.05, 5000);
    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.replaceChildren(renderer.domElement);

    const spark = new SparkRenderer({
      renderer,
      focalAdjustment: 2.0,
      sortRadial: false,
    });
    scene.add(spark);
    scene.add(new THREE.HemisphereLight('#f8fafc', '#0f172a', 0.86));
    const keyLight = new THREE.DirectionalLight('#dbeafe', 0.72);
    keyLight.position.set(12, 18, 10);
    scene.add(keyLight);
    const worldRoot = new THREE.Group();
    worldRoot.quaternion.copy(WORLD_TOUR_UPRIGHT_QUATERNION);
    scene.add(worldRoot);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.72;
    controls.zoomSpeed = 0.85;
    controls.panSpeed = 0.8;
    controls.screenSpacePanning = true;
    controls.minDistance = 12;
    controls.maxDistance = 1200;
    controls.minPolarAngle = 0.08;
    controls.maxPolarAngle = Math.PI * 0.48;

    const gltfLoader = new GLTFLoader();
    const raycastMeshes: any[] = [];
    const pressedKeys = new Set<string>();
    const pointerRaycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const worldUp = new THREE.Vector3(0, 1, 0);
    let colliderRoot: any = null;
    let splat: SplatMesh | null = null;
    let splatBounds: any = null;
    let colliderBounds: any = null;
    let userInteracted = false;
    let suppressInteraction = false;
    let defaultPreset = props.fixture.viewerPreset || null;
    let lastTime = performance.now();
    const pilotAnchor = new THREE.Vector3();
    const pilotSpawn = new THREE.Vector3();
    let pilotReady = false;

    const pilotTargetMarker = new THREE.Group();
    const targetSphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 18, 18),
      new THREE.MeshStandardMaterial({
        color: '#7dd3fc',
        emissive: '#1d4ed8',
        emissiveIntensity: 1.2,
        roughness: 0.24,
        metalness: 0.02,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      }),
    );
    const targetRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.8, 0.12, 10, 40),
      new THREE.MeshBasicMaterial({
        color: '#e0f2fe',
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
    );
    targetRing.rotation.x = Math.PI / 2;
    pilotTargetMarker.add(targetSphere);
    pilotTargetMarker.add(targetRing);
    scene.add(pilotTargetMarker);

    const updatePilotTargetMarker = () => {
      pilotTargetMarker.position.copy(pilotAnchor);
      const markerScale = Math.max(camera.position.distanceTo(controls.target) * 0.015, 1.8);
      pilotTargetMarker.scale.setScalar(markerScale);
      pilotTargetMarker.visible = controlModeRef.current === 'pilot-target';
    };

    const moveCameraAndTarget = (delta: any) => {
      pilotAnchor.add(delta);
      camera.position.add(delta);
      controls.target.add(delta);
      updatePilotTargetMarker();
      controls.update();
      renderer.render(scene, camera);
    };

    const resetPilotCamera = (anchor: any, reason: string) => {
      pilotAnchor.copy(anchor);
      const horizontal = camera.position.clone().sub(controls.target);
      horizontal.y = 0;
      if (horizontal.lengthSq() < 1e-6) {
        horizontal.set(0, 0, 1);
      }
      horizontal.normalize().multiplyScalar(PILOT_CAMERA_DISTANCE);
      suppressInteraction = true;
      camera.position.copy(anchor).add(horizontal).add(new THREE.Vector3(0, PILOT_CAMERA_HEIGHT, 0));
      controls.target.copy(anchor).add(new THREE.Vector3(0, PILOT_LOOK_HEIGHT, 0));
      updatePilotTargetMarker();
      controls.minDistance = Math.max(PILOT_CAMERA_DISTANCE * 0.35, 6);
      controls.maxDistance = Math.max(PILOT_CAMERA_DISTANCE * 5, 140);
      controls.update();
      renderer.render(scene, camera);
      window.setTimeout(() => {
        suppressInteraction = false;
      }, 0);
      setTargetStatus(`Target: ${reason}`);
      setActionStatus(`Pilot view anchored to ${reason}.`);
    };

    const setPilotTargetPosition = (nextTarget: any, reason: string) => {
      const nextAnchor = nextTarget.clone();
      const delta = nextAnchor.clone().sub(pilotAnchor);
      moveCameraAndTarget(delta);
      setTargetStatus(`Target: ${reason}`);
      setActionStatus(`Pilot target ${reason}.`);
      userInteracted = true;
    };

    const applyComputedView = (view: ComputedInspectView) => {
      suppressInteraction = true;
      camera.position.copy(view.position);
      controls.target.copy(view.target);
      pilotAnchor.copy(view.target).add(new THREE.Vector3(0, -PILOT_LOOK_HEIGHT, 0));
      const distance = camera.position.distanceTo(controls.target);
      controls.minDistance = Math.max(distance * 0.15, 12);
      controls.maxDistance = Math.max(distance * 4.5, 800);
      updatePilotTargetMarker();
      controls.update();
      renderer.render(scene, camera);
      window.setTimeout(() => {
        suppressInteraction = false;
      }, 0);
    };

    const bestAutoView = (): ComputedInspectView | null => {
      if (colliderBounds) {
        return buildInspectViewFromBox(colliderBounds, 'auto-collider');
      }
      if (splatBounds) {
        return buildInspectViewFromBox(splatBounds, 'auto-splat');
      }
      return null;
    };

    const fitScene = () => {
      if (controlModeRef.current === 'pilot-target' && pilotReady) {
        resetPilotCamera(pilotAnchor, 'current pilot target');
        return;
      }
      const next = bestAutoView();
      if (!next) return;
      applyComputedView(next);
      setActionStatus(`Fit Scene applied (${next.source}).`);
    };

    const resetView = () => {
      if (controlModeRef.current === 'pilot-target' && pilotReady) {
        resetPilotCamera(pilotSpawn, 'pilot spawn');
        return;
      }
      const presetView = defaultPreset ? presetToComputedView(defaultPreset) : null;
      if (presetView) {
        applyComputedView(presetView);
        setActionStatus(`Reset to ${(defaultPreset?.source || 'manual')} preset.`);
        return;
      }
      const next = bestAutoView();
      if (!next) return;
      applyComputedView(next);
      defaultPreset = computedViewToPreset(next, next.source);
      setActionStatus(`Reset to ${next.source}.`);
    };

    const saveCurrentView = async () => {
      setSaveBusy(true);
      setActionStatus('');
      try {
        const response = await invokeTauri<SaveWorldTourViewerPresetResponse>('save_world_tour_viewer_preset', {
          payload: {
            manifestPath: props.fixture.manifestPath,
            camera: {
              position: threeVectorToPreset(camera.position),
              target: threeVectorToPreset(controls.target),
            },
          },
        });
        defaultPreset = response.viewerPreset;
        setActionStatus('Saved current view as fixture default.');
      } catch (saveError) {
        setActionStatus(saveError instanceof Error ? saveError.message : String(saveError || 'Failed to save current view.'));
      } finally {
        setSaveBusy(false);
      }
    };

    fitSceneRef.current = fitScene;
    resetViewRef.current = resetView;
    saveViewRef.current = saveCurrentView;
    activatePilotModeRef.current = () => {
      if (pilotReady) {
        resetPilotCamera(pilotAnchor, 'pilot target');
      }
    };

    controls.addEventListener('change', () => {
      if (!suppressInteraction) {
        userInteracted = true;
      }
      updatePilotTargetMarker();
    });

    const applyColliderVisualState = (visible: boolean) => {
      if (!colliderRoot) return;
      colliderRoot.traverse((child: any) => {
        if (!(child instanceof THREE.Mesh)) return;
        const material = child.material;
        if (!(material instanceof THREE.MeshBasicMaterial)) return;
        material.visible = visible;
        material.opacity = visible ? 0.12 : 0;
      });
    };
    setColliderVisibleRef.current = applyColliderVisualState;

    const renderFrame = () => {
      const now = performance.now();
      const deltaTime = Math.max((now - lastTime) / 1000, 0);
      lastTime = now;
      if (controlModeRef.current === 'pilot-target') {
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() > 1e-6) {
          forward.normalize();
        }
        const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
        const move = new THREE.Vector3();
        if (pressedKeys.has('KeyW') || pressedKeys.has('ArrowUp')) move.add(forward);
        if (pressedKeys.has('KeyS') || pressedKeys.has('ArrowDown')) move.sub(forward);
        if (pressedKeys.has('KeyD') || pressedKeys.has('ArrowRight')) move.add(right);
        if (pressedKeys.has('KeyA') || pressedKeys.has('ArrowLeft')) move.sub(right);
        if (move.lengthSq() > 0) {
          move.normalize().multiplyScalar((pressedKeys.has('ShiftLeft') || pressedKeys.has('ShiftRight') ? 120 : 48) * deltaTime);
          moveCameraAndTarget(move);
          setTargetStatus('Target: pilot control active');
        }
      }
      updatePilotTargetMarker();
      controls.update();
      renderer.render(scene, camera);
    };

    const resize = () => {
      if (disposed) return;
      const width = Math.max(host.clientWidth, 320);
      const height = Math.max(host.clientHeight, 320);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderer.render(scene, camera);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    renderer.setAnimationLoop(renderFrame);
    resize();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code.startsWith('Key') || event.code.startsWith('Arrow') || event.code.startsWith('Shift')) {
        pressedKeys.add(event.code);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      pressedKeys.delete(event.code);
    };

    const handleDoubleClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      pointerRaycaster.setFromCamera(pointer, camera);
      const hits = raycastMeshes.length > 0 ? pointerRaycaster.intersectObjects(raycastMeshes, false) : [];
      if (hits.length > 0) {
        setPilotTargetPosition(hits[0].point.clone(), 'repositioned on collider');
        return;
      }
      const plane = new THREE.Plane(worldUp, -controls.target.y);
      const planeHit = new THREE.Vector3();
      if (pointerRaycaster.ray.intersectPlane(plane, planeHit)) {
        setPilotTargetPosition(planeHit, 'repositioned on view plane');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    renderer.domElement.addEventListener('dblclick', handleDoubleClick);

    const loadColliderInBackground = async () => {
      const colliderUrl = resolveWorldTourAssetUrl(
        props.fixture.colliderMeshLocalPath,
        props.fixture.colliderMeshRemoteUrl,
      );
      if (!colliderUrl) {
        setColliderStatus('Collider: not provided');
        return;
      }
      const gltf = await gltfLoader.loadAsync(colliderUrl);
      if (disposed) return;
      colliderRoot = gltf.scene;
      colliderRoot.traverse((child: any) => {
        if (!(child instanceof THREE.Mesh)) return;
        raycastMeshes.push(child);
        child.material = new THREE.MeshBasicMaterial({
          color: '#67e8f9',
          wireframe: true,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          visible: false,
        });
      });
      worldRoot.add(colliderRoot);
      worldRoot.updateMatrixWorld(true);
      colliderBounds = new THREE.Box3().setFromObject(colliderRoot);
      const resolvedPilotSpawn = resolvePilotSpawnPoint(colliderBounds, raycastMeshes);
      if (resolvedPilotSpawn) {
        pilotSpawn.copy(resolvedPilotSpawn);
        pilotAnchor.copy(resolvedPilotSpawn);
        pilotReady = true;
        setTargetStatus('Target: pilot spawn ready');
        if (controlModeRef.current === 'pilot-target' && !userInteracted) {
          resetPilotCamera(pilotSpawn, 'pilot spawn');
        }
      }
      if (!defaultPreset && !userInteracted) {
        const colliderView = buildInspectViewFromBox(colliderBounds, 'auto-collider');
        defaultPreset = computedViewToPreset(colliderView, 'auto-collider');
        if (controlModeRef.current !== 'pilot-target') {
          applyComputedView(colliderView);
        }
      }
      applyColliderVisualState(showCollider);
      setColliderStatus('Collider: ready');
    };

    const boot = async () => {
      const splatUrl = resolveWorldTourAssetUrl(
        props.fixture.spzLocalPath,
        props.fixture.spzRemoteUrl,
      );
      if (!splatUrl) {
        throw new Error('World tour fixture does not contain a usable SPZ asset.');
      }
      splat = new SplatMesh({ url: splatUrl });
      splat.quaternion.copy(WORLD_TOUR_UPRIGHT_QUATERNION);
      worldRoot.add(splat);
      await splat.initialized;
      if (disposed) return;
      splatBounds = rotateBoxByQuaternion(splat.getBoundingBox(), WORLD_TOUR_UPRIGHT_QUATERNION);
      const presetView = props.fixture.viewerPreset ? presetToComputedView(props.fixture.viewerPreset) : null;
      if (presetView) {
        defaultPreset = props.fixture.viewerPreset || null;
        applyComputedView(presetView);
      } else {
        const initialView = buildInspectViewFromBox(splatBounds, 'auto-splat');
        defaultPreset = computedViewToPreset(initialView, 'auto-splat');
        applyComputedView(initialView);
      }
      setBooting(false);
      void loadColliderInBackground().catch((loadError) => {
        if (disposed) return;
        setColliderStatus(`Collider: skipped (${loadError instanceof Error ? loadError.message : String(loadError)})`);
      });
    };

    void boot().catch((loadError) => {
      if (disposed) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError || 'Failed to boot world-tour viewer.'));
      setBooting(false);
    });

    return () => {
      disposed = true;
      fitSceneRef.current = null;
      resetViewRef.current = null;
      saveViewRef.current = null;
      setColliderVisibleRef.current = null;
      activatePilotModeRef.current = null;
      resizeObserver.disconnect();
      renderer.setAnimationLoop(null);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      renderer.domElement.removeEventListener('dblclick', handleDoubleClick);
      pressedKeys.clear();
      controls.dispose();
      colliderRoot?.removeFromParent();
      splat?.dispose();
      pilotTargetMarker.removeFromParent();
      worldRoot.removeFromParent();
      spark.removeFromParent();
      renderer.dispose();
      host.replaceChildren();
    };
  }, [props.fixture, props.onClose]);

  const title = worldTourTitle(world);

  return (
    <div className="relative min-h-screen">
      <div className="absolute inset-0" ref={hostRef} />
      {booting ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/76">
          Booting world tour viewer...
        </div>
      ) : null}

      <div className="absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 border-b border-white/8 bg-black/36 px-4 py-3 backdrop-blur-md">
        <div className="flex flex-col gap-1">
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="text-xs text-white/64">
            {controlMode === 'pilot-target'
              ? 'Pilot target mode. WASD or arrows move the target, Shift boosts, double-click repositions it.'
              : 'Official Spark-style inspect baseline. Drag to orbit, wheel to zoom, right-drag to pan.'}
          </div>
          {actionStatus ? <div className="text-xs text-[#8be9d0]">{actionStatus}</div> : null}
          {error ? <div className="text-xs text-[var(--nimi-status-danger)]">{error}</div> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button tone={controlMode === 'pilot-target' ? 'primary' : 'secondary'} size="sm" onClick={() => setControlMode('pilot-target')}>
            Pilot Target
          </Button>
          <Button tone={controlMode === 'inspect' ? 'primary' : 'secondary'} size="sm" onClick={() => setControlMode('inspect')}>
            Inspect
          </Button>
          <Button tone="secondary" size="sm" onClick={() => fitSceneRef.current?.()}>
            Fit Scene
          </Button>
          <Button tone="secondary" size="sm" onClick={() => resetViewRef.current?.()}>
            Reset View
          </Button>
          <Button tone="secondary" size="sm" disabled={saveBusy} onClick={() => { void saveViewRef.current?.(); }}>
            {saveBusy ? 'Saving...' : 'Save Current View'}
          </Button>
          <Button tone={showCollider ? 'primary' : 'secondary'} size="sm" onClick={() => setShowCollider((prev) => !prev)}>
            {showCollider ? 'Hide Collider' : 'Show Collider'}
          </Button>
          <Button tone="secondary" size="sm" onClick={props.onClose}>
            Close
          </Button>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 flex max-w-[760px] flex-col gap-2 rounded-[20px] border border-white/8 bg-black/52 px-4 py-3 text-xs text-white/74 backdrop-blur-md">
        <div>{props.fixture.caption || 'Cached World Labs fixture routed into the dedicated Spark 2.0 inspect viewer.'}</div>
        <div className="font-mono text-white/60">
          {props.fixture.worldId || 'fixture'} · {props.fixture.model || 'marble-1.1'} · {colliderStatus} · {targetStatus}
        </div>
      </div>
    </div>
  );
}
