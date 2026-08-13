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

import type {
  BackendAudioConsumer,
  BackendHitRegion,
  Live2DAvatarModelManifest,
} from '@nimiplatform/kit/features/avatar/headless';
import type {
  BackendBranch,
  Live2DBackendExtension,
} from '../carrier/backend-branch.js';
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
import { computeLive2DNominalBounds } from '@nimiplatform/kit/features/avatar/headless';
import { computeLive2DHitRegion } from '@nimiplatform/kit/features/avatar/headless';
import { createLive2DAudioConsumer } from './live2d-audio-consumer.js';
import { createLive2DProjectionAdapter } from './live2d-projection-adapter.js';
import { createLive2DCarrierSurface } from './live2d-carrier-surface.js';
import { loadEmbeddedWLipSyncProfile } from '../lip-sync-profile.js';

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
  shutdown(): void;
};

// @nimi-authority: definition.nimi.avatar.embodiment.live2d-adapter
// @nimi-authority: rule.nimi.avatar.embodiment.r034
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

  const profile = loadEmbeddedWLipSyncProfile();
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
    shutdown: branch.shutdown,
  };
}
