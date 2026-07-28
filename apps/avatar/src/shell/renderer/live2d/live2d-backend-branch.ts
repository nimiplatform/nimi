// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Builds the Live2D BackendBranch by composing the leaf modules
// (`live2d-carrier-surface`, `live2d-projection-adapter`,
// `live2d-audio-consumer`, `live2d-lipsync-driver`,
// `live2d-nominal-bounds`, `live2d-hit-region`) with the existing
// Cubism session + command bus.
//
// All `model.kind` switching MUST stay inside
// `carrier/create-backend-branch.ts`; this factory is invoked from
// there only, per the backend-branch contract.

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
import { summarizeLive2DExpressionInventory } from './live2d-expression-stack.js';
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

type Live2DPreviewReadinessMetadata = {
  status: 'pending' | 'ready' | 'error';
  visiblePixels: number | null;
  visibleDrawableCount: number | null;
  textureBindingCount: number | null;
  sampledPixels: number | null;
  sampledPixelChecksum: number | null;
  canvasWidth: number | null;
  canvasHeight: number | null;
  parameterLaneOrder: readonly string[] | null;
  parameterLaneElapsedMs: number | null;
  parameterLaneUnsupportedParameterCount: number | null;
  parameterLaneSpeechLipsyncParameterCount: number | null;
  parameterLaneDirectParameterCount: number | null;
  lookAtIdleSupported: boolean | null;
  lookAtIdleBlinkSupported: boolean | null;
  lookAtIdleReasonCode: string | null;
  reasonCode: string | null;
  observedAt: string | null;
};

function pendingPreviewReadiness(): Live2DPreviewReadinessMetadata {
  return {
    status: 'pending',
    visiblePixels: null,
    visibleDrawableCount: null,
    textureBindingCount: null,
    sampledPixels: null,
    sampledPixelChecksum: null,
    canvasWidth: null,
    canvasHeight: null,
    parameterLaneOrder: null,
    parameterLaneElapsedMs: null,
    parameterLaneUnsupportedParameterCount: null,
    parameterLaneSpeechLipsyncParameterCount: null,
    parameterLaneDirectParameterCount: null,
    lookAtIdleSupported: null,
    lookAtIdleBlinkSupported: null,
    lookAtIdleReasonCode: null,
    reasonCode: null,
    observedAt: null,
  };
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

async function verifyBootstrapCarrierVisualOutput(
  session: Live2DBackendSession,
  updatePreviewReadiness: (readiness: Live2DPreviewReadinessMetadata) => void,
): Promise<void> {
  if (typeof document === 'undefined' || !session.execution?.loaded) return;
  let visualHost: Live2DCarrierVisualHost | null = null;
  try {
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
    const result = await renderCarrierVisualFrameWithRetry(visualHost);
    const stats = result.stats;
    const observedAt = new Date().toISOString();
    updatePreviewReadiness({
      status: 'ready',
      visiblePixels: stats.visiblePixels,
      visibleDrawableCount: stats.visibleDrawableCount,
      textureBindingCount: stats.textureBindingCount,
      sampledPixels: stats.sampledPixels,
      sampledPixelChecksum: stats.sampledPixelChecksum,
      canvasWidth: stats.width,
      canvasHeight: stats.height,
      parameterLaneOrder: stats.parameterLaneOrder,
      parameterLaneElapsedMs: stats.parameterLaneElapsedMs,
      parameterLaneUnsupportedParameterCount: stats.parameterLaneUnsupportedParameterIds.length,
      parameterLaneSpeechLipsyncParameterCount: stats.parameterLaneSpeechLipsyncParameterCount,
      parameterLaneDirectParameterCount: stats.parameterLaneDirectParameterCount,
      lookAtIdleSupported: stats.lookAtIdleSupported,
      lookAtIdleBlinkSupported: stats.lookAtIdleBlinkSupported,
      lookAtIdleReasonCode: stats.lookAtIdleReasonCode,
      reasonCode: null,
      observedAt,
    });
  } catch (error) {
    updatePreviewReadiness({
      ...pendingPreviewReadiness(),
      status: 'error',
      reasonCode: error instanceof Error ? error.message : String(error || 'Live2D bootstrap carrier visual proof failed'),
      observedAt: new Date().toISOString(),
    });
    if (error instanceof Live2DCarrierVisualFrameError) {
      console.warn('[avatar:live2d] bootstrap visual output probe failed', error, error.stats);
    } else {
      console.warn('[avatar:live2d] bootstrap visual output probe failed', error);
    }
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
      commandBus.emit('command', {
        kind: 'parameter',
        id,
        value,
        weight: 1,
        source: 'live2d_extension_direct',
      });
    },
  };
}

export type Live2DBackendBranchHandle = {
  branch: BackendBranch & { kind: 'live2d' };
  audioConsumer: BackendAudioConsumer;
  verifyBootstrapVisualOutput(): Promise<void>;
  shutdown(): void;
};

export async function createLive2DBackendBranch(
  manifest: Live2DAvatarModelManifest,
): Promise<Live2DBackendBranchHandle> {
  let previewReadiness = pendingPreviewReadiness();
  const updatePreviewReadiness = (readiness: Live2DPreviewReadinessMetadata): void => {
    previewReadiness = readiness;
  };
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
  const expressionInventorySummary = () => summarizeLive2DExpressionInventory({
    modelId: backendSession.manifest.modelId,
    inventory: backendSession.expressionInventory,
  });

  const branch: BackendBranch & { kind: 'live2d' } = {
    kind: 'live2d',
    nominalBounds,
    projection,
    surface,
    metadata: () => ({
      ...(() => {
        const expressionSummary = expressionInventorySummary();
        return {
          model_kind: 'live2d',
          live2d_calibration_ref: manifest.live2d.calibrationRef,
          live2d_calibration_projection_status: manifest.live2d.calibrationRef
            ? 'ref_resolved_effect_not_admitted'
            : 'not_configured',
          live2d_calibration_effect_admitted: false,
          compatibility_tier: backendSession.compatibility.tier,
          adapter_id: backendSession.compatibility.adapter?.adapter_id ?? null,
          motion_group_count: backendSession.resources?.motionGroups?.size ?? 0,
          expression_count: expressionSummary.expressionCount,
          expression_stack_supported: expressionSummary.expressionStackSupported,
          expression_inventory_ref: expressionSummary.expressionInventoryRef,
          expression_inventory_ids: expressionSummary.expressionIds,
          expression_inventory_parameter_count: expressionSummary.expressionParameterCount,
          expression_inventory_parameter_ids: expressionSummary.expressionParameterIds,
          expression_inventory_blend_mode_counts: expressionSummary.expressionBlendModeCounts,
          param_mouth_form_supported: backendSession.compatibility.paramMouthFormSupported,
          hit_region_strategy: 'alpha_mask_plus_bbox',
          hit_region_default: staticHitRegionSnapshot,
          lipsync_profile_present: profile !== null,
          carrier_visual_readiness_status: previewReadiness.status,
          carrier_visual_visible_pixels: previewReadiness.visiblePixels,
          carrier_visual_visible_drawable_count: previewReadiness.visibleDrawableCount,
          carrier_visual_texture_binding_count: previewReadiness.textureBindingCount,
          carrier_visual_sampled_pixels: previewReadiness.sampledPixels,
          carrier_visual_sampled_pixel_checksum: previewReadiness.sampledPixelChecksum,
          carrier_visual_canvas_width: previewReadiness.canvasWidth,
          carrier_visual_canvas_height: previewReadiness.canvasHeight,
          carrier_visual_parameter_lane_order: previewReadiness.parameterLaneOrder,
          carrier_visual_parameter_lane_elapsed_ms: previewReadiness.parameterLaneElapsedMs,
          carrier_visual_parameter_lane_unsupported_parameter_count:
            previewReadiness.parameterLaneUnsupportedParameterCount,
          carrier_visual_parameter_lane_speech_lipsync_parameter_count:
            previewReadiness.parameterLaneSpeechLipsyncParameterCount,
          carrier_visual_parameter_lane_direct_parameter_count:
            previewReadiness.parameterLaneDirectParameterCount,
          carrier_visual_look_at_idle_supported: previewReadiness.lookAtIdleSupported,
          carrier_visual_look_at_idle_blink_supported: previewReadiness.lookAtIdleBlinkSupported,
          carrier_visual_look_at_idle_reason_code: previewReadiness.lookAtIdleReasonCode,
          carrier_visual_reason_code: previewReadiness.reasonCode,
          carrier_visual_observed_at: previewReadiness.observedAt,
        };
      })(),
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
    verifyBootstrapVisualOutput: () => verifyBootstrapCarrierVisualOutput(
      backendSession,
      updatePreviewReadiness,
    ),
    shutdown: branch.shutdown,
  };
}
