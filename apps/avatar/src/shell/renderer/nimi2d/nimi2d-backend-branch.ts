import type { Nimi2DAvatarModelManifest } from '@nimiplatform/kit/features/avatar/headless';
import type { BackendBranch } from '../carrier/backend-branch.js';
import type { BackendBranchHandle } from '../carrier/create-backend-branch.js';
import { createNimi2DComposer } from '@nimiplatform/nimi2d/runtime';
import { createNimi2DAudioConsumer } from './nimi2d-audio-consumer.js';
import { createNimi2DCarrierSurface } from './nimi2d-carrier-surface.js';
import { probeNimi2DCarrierVisualFrame } from './nimi2d-carrier-visual-proof.js';
import { loadNimi2DPackage, optionalCapabilityProfileRef } from './nimi2d-package.js';

export async function createNimi2DBackendBranch(
  manifest: Nimi2DAvatarModelManifest,
): Promise<BackendBranchHandle> {
  const capabilityProfileRef = optionalCapabilityProfileRef(manifest.nimi2d.capabilityProfileRef);
  if (!capabilityProfileRef) {
    throw new Error('Nimi2D backend requires an Avatar Nimi2D capability profile');
  }

  const loadedPackage = await loadNimi2DPackage({
    packageManifestPath: manifest.nimi2d.packageManifestPath,
    packageDigestSha256: manifest.nimi2d.packageDigestSha256,
    capabilityProfileRef,
  });
  if (!loadedPackage.capabilityProfile) {
    throw new Error('Nimi2D backend capability profile failed to load');
  }
  const capabilityProfile = loadedPackage.capabilityProfile;

  const composer = createNimi2DComposer();
  const audioConsumer = createNimi2DAudioConsumer();
  const motionRouteCount = Object.keys(capabilityProfile.renderer.bindings?.motion_routes ?? {}).length;
  const surface = createNimi2DCarrierSurface({
    loadedPackage,
    composer,
    audioConsumer,
  });

  const branch: BackendBranch = {
    kind: 'nimi2d',
    nominalBounds: {
      width: loadedPackage.canvas.width,
      height: loadedPackage.canvas.height,
      bodyCenterX: 0.5,
      bodyCenterY: 0.52,
    },
    projection: {
      applyActivity: (input) => composer.applyActivity(input),
      applyEmotion: (input) => composer.applyEmotion(input),
      applyMotion: (input) => composer.applyMotion(input),
      applyExpression: (input) => composer.applyExpression(input),
      reset: () => composer.reset(),
    },
    surface,
    metadata() {
      return {
        model_kind: 'nimi2d',
        mode: 'pixi_renderer_foundation',
        package_id: loadedPackage.manifest.package_id,
        package_manifest_ref: manifest.nimi2d.packageManifestPath,
        package_digest_sha256: manifest.nimi2d.packageDigestSha256,
        runtime_package_admission: 'digest_and_evidence_checked',
        validator_evidence_ref: loadedPackage.manifest.source?.validator_evidence_ref,
        content_admission_ref: loadedPackage.manifest.source?.content_admission_ref
          ?? loadedPackage.manifest.governance.content_admission_ref,
        capability_profile_ref: capabilityProfileRef,
        requested_tier: loadedPackage.manifest.capability.requested_tier,
        proven_tier: loadedPackage.manifest.capability.proven_tier,
        default_outfit_ref: loadedPackage.manifest.wardrobe.default_outfit_ref,
        base_body_renderable: loadedPackage.manifest.governance.base_body_renderable,
        renderer_proof: 'pixi_renderer_foundation',
        composer_proof: 'scheduler_foundation',
        hit_region_strategy: 'alpha_probe_plus_bbox',
        hit_region_evidence_status: 'decoded_layer_alpha_probe_foundation',
        visual_acceptance_status: 'deterministic_offscreen_layer_pixel_proof_only',
        generation_bench_status: 'not_closed_by_avatar_runtime',
        live_action_lanes: {
          static_layer: 'supported',
          idle_life: capabilityProfile.renderer.bindings?.idle_life ? 'supported' : 'unsupported',
          expression: capabilityProfile.renderer.bindings?.expression ? 'supported' : 'unsupported',
          speech_mouth: capabilityProfile.renderer.bindings?.speech_mouth ? 'supported' : 'unsupported',
          gesture_motion: motionRouteCount > 0 ? 'supported' : 'unsupported',
          true_viseme: 'unsupported',
          semantic_full_body: 'unsupported',
        },
      };
    },
    shutdown() {
      audioConsumer.silent();
      composer.reset();
    },
  };

  return {
    branch,
    audioConsumer,
    recordBootstrapVisualProof: async () => {
      await probeNimi2DCarrierVisualFrame({ renderPlan: loadedPackage });
    },
    shutdown() {
      branch.shutdown();
    },
  };
}
