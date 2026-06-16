// Wave 1 (step 2) of topic 2026-04-30-avatar-vrm-backend-branch.
//
// Builds the Live2D BackendBranch by composing the leaf modules added
// in this step (`live2d-carrier-surface`, `live2d-projection-adapter`,
// `live2d-audio-consumer`, `live2d-lipsync-driver`,
// `live2d-nominal-bounds`, `live2d-hit-region`) with the existing
// Cubism session + command bus.
//
// Replaces the step_1 stub that lived in `live2d-backend.ts`. All
// `model.kind` switching MUST stay inside
// `carrier/create-backend-branch.ts`; this factory is invoked from
// there only (per design-02 §"carrier 重构形状").

import type { Live2DAvatarModelManifest } from '@nimiplatform/kit/features/avatar/headless';
import type {
  BackendAudioConsumer,
  BackendBranch,
  BackendHitRegion,
  Live2DBackendExtension,
} from '../carrier/backend-branch.js';
import type { Profile } from 'wlipsync';
import type { Live2DAdapterManifestV1 } from '@nimiplatform/kit/features/avatar/headless';
import { parseLive2DAdapterManifest } from '@nimiplatform/kit/features/avatar/headless';
import { waitForCubismCore } from './cubism-bootstrap.js';
import { loadOfficialCubismFrameworkRuntime } from './cubism-framework-runtime.js';
import {
  createLive2DBackendSession,
  type Live2DBackendSession,
} from './backend-session.js';
import {
  createCommandBus,
  type Live2DCommandBus,
} from './plugin-api.js';
import {
  readTextFile,
  type ModelManifest as Live2DTauriManifest,
} from './model-loader.js';
import { recordAvatarEvidenceEventually } from '../app-shell/avatar-evidence.js';
import {
  createLive2DCarrierVisualHost,
  Live2DCarrierVisualFrameError,
  type Live2DCarrierVisualFrameStats,
  type Live2DCarrierVisualHost,
} from './carrier-visual-host.js';

import { computeLive2DNominalBounds } from '@nimiplatform/kit/features/avatar/headless';
import { computeLive2DHitRegion } from '@nimiplatform/kit/features/avatar/headless';
import { createLive2DAudioConsumer } from './live2d-audio-consumer.js';
import { createLive2DProjectionAdapter } from './live2d-projection-adapter.js';
import { createLive2DCarrierSurface } from './live2d-carrier-surface.js';

function timeoutAfter<T>(ms: number, message: string): Promise<T> {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error(message)), ms);
  });
}

function waitForNextCarrierVisualFrame(attempt: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    window.setTimeout(resolve, Math.min(120, 16 + attempt * 8));
  });
}

async function renderCarrierVisualFrameWithRetry(
  visualHost: Live2DCarrierVisualHost,
): Promise<{ attempts: number; stats: Live2DCarrierVisualFrameStats }> {
  const maxAttempts = 12;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return {
        attempts: attempt,
        stats: visualHost.probeVisibleFrame({
          deltaTimeSeconds: attempt / 60,
          seconds: performance.now() / 1000,
        }),
      };
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      await waitForNextCarrierVisualFrame(attempt);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError || 'Live2D bootstrap carrier visual proof failed'));
}

function toCarrierVisualFailureDetail(error: unknown, attempts: number | null): Record<string, unknown> {
  const detail: Record<string, unknown> = {
    status: 'error',
    source: 'avatar-visual-carrier-bootstrap',
    model_kind: 'live2d',
    error: error instanceof Error ? error.message : String(error || 'Live2D bootstrap carrier visual proof failed'),
  };
  if (typeof attempts === 'number') detail.attempts = attempts;
  if (error instanceof Live2DCarrierVisualFrameError) detail.frame_stats = error.stats;
  return detail;
}

async function recordBootstrapCarrierVisualProof(
  session: Live2DBackendSession,
  source = 'avatar-visual-carrier-bootstrap',
): Promise<void> {
  if (typeof document === 'undefined' || !session.execution?.loaded) return;
  let visualHost: Live2DCarrierVisualHost | null = null;
  let attempts: number | null = null;
  try {
    recordAvatarEvidenceEventually({
      kind: 'avatar.carrier.visual',
      detail: { status: 'loading', source, model_kind: 'live2d' },
    });
    const canvas = document.createElement('canvas');
    visualHost = await Promise.race([
      createLive2DCarrierVisualHost({
        canvas,
        session,
        width: 360,
        height: 480,
      }),
      timeoutAfter<Live2DCarrierVisualHost>(8_000, 'Live2D bootstrap carrier visual proof timed out'),
    ]);
    attempts = 12;
    const result = await renderCarrierVisualFrameWithRetry(visualHost);
    attempts = result.attempts;
    const stats = result.stats;
    recordAvatarEvidenceEventually({
      kind: 'avatar.carrier.visual',
      detail: {
        status: 'ready',
        source,
        model_kind: 'live2d',
        visible_pixels: stats.visiblePixels,
        visible_drawable_count: stats.visibleDrawableCount,
        canvas_width: stats.width,
        canvas_height: stats.height,
        sampled_pixels: stats.sampledPixels,
        sampled_pixel_checksum: stats.sampledPixelChecksum,
        texture_binding_count: stats.textureBindingCount,
        attempts,
      },
    });
  } catch (error) {
    recordAvatarEvidenceEventually({
      kind: 'avatar.carrier.visual',
      detail: toCarrierVisualFailureDetail(error, attempts),
    });
  } finally {
    visualHost?.unload();
  }
}

function toLive2DTauriManifest(
  manifest: Live2DAvatarModelManifest,
): Live2DTauriManifest {
  return {
    runtimeDir: manifest.runtimeDir,
    modelId: manifest.modelId,
    model3JsonPath: manifest.live2d.modelJson,
    nimiDir: manifest.nimiDir,
    adapterManifestPath: manifest.live2d.adapterManifestPath,
  };
}

async function loadEmbeddedAdapterManifest(
  manifest: Live2DAvatarModelManifest,
): Promise<Live2DAdapterManifestV1 | null> {
  const path = manifest.live2d.adapterManifestPath;
  if (!path) return null;
  const raw = await readTextFile(path);
  return parseLive2DAdapterManifest(raw);
}

async function loadLipsyncProfile(): Promise<Profile | null> {
  try {
    const mod = await import('../../../../assets/lip-sync/lip-sync-profile.json', {
      with: { type: 'json' },
    });
    return (mod as { default?: Profile }).default ?? (mod as unknown as Profile);
  } catch (err) {
    console.warn(
      '[avatar:live2d:lipsync] failed to load wlipsync profile JSON; lipsync silent',
      err,
    );
    return null;
  }
}

function createLive2DExtension(
  commandBus: Live2DCommandBus,
): Live2DBackendExtension {
  return {
    setParameter(id, value) {
      commandBus.emit('command', { kind: 'parameter', id, value, weight: 1 });
    },
  };
}

export type Live2DBackendBranchHandle = {
  branch: BackendBranch & { kind: 'live2d' };
  audioConsumer: BackendAudioConsumer;
  recordBootstrapVisualProof(): Promise<void>;
  shutdown(): void;
};

export async function createLive2DBackendBranch(
  manifest: Live2DAvatarModelManifest,
): Promise<Live2DBackendBranchHandle> {
  const adapterManifest = await loadEmbeddedAdapterManifest(manifest);
  const core = await waitForCubismCore();
  const framework = await loadOfficialCubismFrameworkRuntime();
  const live2dManifest = toLive2DTauriManifest(manifest);
  const backendSession = await createLive2DBackendSession(live2dManifest, {
    core,
    framework,
    adapterManifest,
  });

  const commandBus = createCommandBus();
  const unwireBackend = commandBus.on('command', (command) => {
    backendSession.applyCommand(command);
  });

  const nominalBounds = computeLive2DNominalBounds({ model: null });
  // Wave 4 chunk 4-C: dynamic hit-region (alpha-mask on tier A/B,
  // bbox-only fallback on tier C) is constructed inside the surface
  // adapter (`live2d-carrier-surface`), where the cubism canvas DOM
  // ref is available. The static `computeLive2DHitRegion` snapshot is
  // retained in metadata() for back-compat / diagnostics consumers.
  const staticHitRegionSnapshot: BackendHitRegion = computeLive2DHitRegion({
    compatibility: backendSession.compatibility,
  });

  const profile = await loadLipsyncProfile();
  const audioConsumer = createLive2DAudioConsumer({ profile });

  const projection = createLive2DProjectionAdapter({
    commandBus,
    compatibility: backendSession.compatibility,
  });

  const surface = createLive2DCarrierSurface({
    session: backendSession,
    audioConsumer,
    paramMouthFormSupported: backendSession.compatibility.paramMouthFormSupported,
  });

  const live2dExtension = createLive2DExtension(commandBus);

  const branch: BackendBranch & { kind: 'live2d' } = {
    kind: 'live2d',
    nominalBounds,
    projection,
    surface,
    metadata: () => ({
      model_kind: 'live2d',
      compatibility_tier: backendSession.compatibility.tier,
      adapter_id: backendSession.compatibility.adapter?.adapter_id ?? null,
      motion_group_count: backendSession.resources?.motionGroups?.size ?? 0,
      expression_count: backendSession.resources?.expressions?.size ?? 0,
      param_mouth_form_supported: backendSession.compatibility.paramMouthFormSupported,
      hit_region_strategy: 'alpha_mask_plus_bbox',
      hit_region_default: staticHitRegionSnapshot,
      lipsync_profile_present: profile !== null,
    }),
    shutdown() {
      unwireBackend();
      audioConsumer.silent();
      backendSession.unload();
    },
    live2dExtension,
  };

  return {
    branch,
    audioConsumer,
    recordBootstrapVisualProof: () => recordBootstrapCarrierVisualProof(backendSession),
    shutdown: branch.shutdown,
  };
}
