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
} from '@nimiplatform/kit/features/avatar/headless';
import type { EmbodimentProjectionApi } from '@nimiplatform/kit/features/avatar/headless';
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
  createLive2DBackendApi,
  type Live2DCommandBus,
} from './plugin-api.js';
import {
  readTextFile,
  type ModelManifest as Live2DTauriManifest,
} from './model-loader.js';

import { computeLive2DNominalBounds } from '@nimiplatform/kit/features/avatar/headless';
import { computeLive2DHitRegion } from '@nimiplatform/kit/features/avatar/headless';
import { createLive2DAudioConsumer } from './live2d-audio-consumer.js';
import { createLive2DProjectionAdapter } from '@nimiplatform/kit/features/avatar/headless';
import { createLive2DCarrierSurface } from './live2d-carrier-surface.js';

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
  // Branch cue/signal surfaces used by carrier orchestration and tests that
  // need command-level evidence outside the BackendBranch projection.
  backendSession: Live2DBackendSession;
  commandBus: Live2DCommandBus;
  cueProjection: EmbodimentProjectionApi;
  audioConsumer: BackendAudioConsumer;
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

  const parameterState = new Map<string, number>();
  const nominalBounds = computeLive2DNominalBounds({ model: null });
  // Wave 4 chunk 4-C: dynamic hit-region (alpha-mask on tier A/B,
  // bbox-only fallback on tier C) is constructed inside the surface
  // adapter (`live2d-carrier-surface`), where the cubism canvas DOM
  // ref is available. The static `computeLive2DHitRegion` snapshot is
  // retained in metadata() for back-compat / diagnostics consumers.
  const staticHitRegionSnapshot: BackendHitRegion = computeLive2DHitRegion({
    compatibility: backendSession.compatibility,
  });

  const cueProjection = createLive2DBackendApi({
    commandBus,
    parameterState,
    compatibility: backendSession.compatibility,
    bounds: () => ({
      x: 0,
      y: 0,
      width: nominalBounds.width,
      height: nominalBounds.height,
    }),
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
      param_mouth_form_supported:
        backendSession.compatibility.adapter?.semantics?.lipsync?.disposition?.status ===
        'supported',
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
    backendSession,
    commandBus,
    cueProjection,
    audioConsumer,
    shutdown: branch.shutdown,
  };
}
