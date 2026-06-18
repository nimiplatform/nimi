import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AvatarModelManifest,
  Nimi2DAvatarModelManifest,
} from '@nimiplatform/kit/features/avatar/headless';

import { createBackendBranch } from './create-backend-branch.js';

const readTextFileMock = vi.fn();

vi.mock('../live2d/model-loader.js', () => ({
  readTextFile: (...args: unknown[]) => readTextFileMock(...args),
}));

const VALID_PACKAGE = `
manifest_kind: nimi.nimi2d.package
schema_version: 1
package_id: n2d_agent_skin
package_kind: character_package
canvas:
  width_px: 512
  height_px: 512
source:
  layer_input_ref: "layer-input:agent-skin"
  layer_generation_ref: "layer-generation:agent-skin"
  identity_preservation_ref: "identity:agent-skin"
  content_admission_ref: "content:agent-skin"
  validator_evidence_ref: "nimi2d.validator:agent-skin"
governance:
  base_body_renderable: false
  default_outfit_required: true
  adult_capability: unavailable_v1
  content_admission_ref: "content:agent-skin"
  underage_body_content: rejected_or_not_present
capability:
  requested_tier: tier-1_agent_basic
  proven_tier: tier-1_agent_basic
base_body:
  renderable: false
  detail_neutral: true
  layer_refs:
    - layer_body
    - layer_mouth
wardrobe:
  default_outfit_ref: n2d_default_outfit_agent
  assets:
    - wardrobe_asset_id: n2d_default_outfit_agent
      wardrobe_kind: default_outfit
      layer_refs:
        - layer_outfit
render_layers:
  - layer_ref: layer_body
    asset_id: asset_layer_body
    layer_kind: base_body_layer
    draw_order_index: 0
    placement_px: { x: 40, y: 20 }
    texture_bounds_px: { x: 0, y: 0, width: 420, height: 460 }
    visible_bounds_px: { x: 0, y: 0, width: 420, height: 460 }
  - layer_ref: layer_mouth
    asset_id: asset_layer_mouth
    layer_kind: base_body_layer
    draw_order_index: 1
    placement_px: { x: 220, y: 245 }
    texture_bounds_px: { x: 0, y: 0, width: 72, height: 36 }
    visible_bounds_px: { x: 0, y: 0, width: 72, height: 36 }
  - layer_ref: layer_outfit
    asset_id: asset_layer_outfit
    layer_kind: wardrobe_layer
    draw_order_index: 2
    placement_px: { x: 64, y: 190 }
    texture_bounds_px: { x: 0, y: 0, width: 384, height: 300 }
    visible_bounds_px: { x: 0, y: 0, width: 384, height: 300 }
assets:
  - asset_id: asset_layer_body
    asset_kind: base_body_layer
    ref: body.png
    sha256: "${'a'.repeat(64)}"
    format: png
    width_px: 512
    height_px: 512
    byte_size: 1000
    color_space: srgb
    alpha_mode: straight
    premultiplied_alpha: false
  - asset_id: asset_layer_mouth
    asset_kind: base_body_layer
    ref: mouth.png
    sha256: "${'b'.repeat(64)}"
    format: png
    width_px: 128
    height_px: 64
    byte_size: 1000
    color_space: srgb
    alpha_mode: straight
    premultiplied_alpha: false
  - asset_id: asset_layer_outfit
    asset_kind: wardrobe_layer
    ref: outfit.png
    sha256: "${'c'.repeat(64)}"
    format: png
    width_px: 512
    height_px: 512
    byte_size: 1000
    color_space: srgb
    alpha_mode: straight
    premultiplied_alpha: false
`;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const VALID_PROFILE = `
profile_id: avatar.nimi2d.capability-profile:agent_skin
backend_kind: nimi2d
renderer:
  canvas:
    width_px: 512
    height_px: 512
  bindings:
    speech_mouth:
      layer_refs:
        - layer_mouth
      scale_y_range:
        - 1
        - 1.4
    expression:
      layer_refs:
        - layer_mouth
      opacity_range:
        - 0.6
        - 1
    idle_life:
      layer_refs:
        - layer_body
`;

function nimi2dManifest(overrides: Partial<Nimi2DAvatarModelManifest> = {}): AvatarModelManifest {
  return {
    kind: 'nimi2d',
    modelId: 'agent-skin',
    runtimeDir: '/models/agent-skin/runtime',
    nimiDir: null,
    posterPath: null,
    nimi2d: {
      packageManifestPath: '/models/agent-skin/runtime/nimi2d/package.yaml',
      packageDigestSha256: sha256Hex(VALID_PACKAGE),
      capabilityProfileRef: '/models/agent-skin/runtime/nimi2d/avatar-capability.yaml',
    },
    ...overrides,
  };
}

beforeEach(() => {
  readTextFileMock.mockReset();
  readTextFileMock.mockImplementation(async (path: string) => {
    if (path.endsWith('package.yaml')) return VALID_PACKAGE;
    if (path.endsWith('avatar-capability.yaml')) return VALID_PROFILE;
    throw new Error(`unexpected read path ${path}`);
  });
});

describe('createBackendBranch Nimi2D admission boundary', () => {
  it('admits a valid Nimi2D package into the Pixi renderer foundation branch', async () => {
    const handle = await createBackendBranch(nimi2dManifest());

    expect(handle.branch.kind).toBe('nimi2d');
    expect(handle.branch.nominalBounds).toEqual({
      width: 512,
      height: 512,
      bodyCenterX: 0.5,
      bodyCenterY: 0.52,
    });
    expect(handle.branch.metadata()).toMatchObject({
      model_kind: 'nimi2d',
      mode: 'pixi_renderer_foundation',
      renderer_proof: 'pixi_renderer_foundation',
      runtime_package_admission: 'digest_and_evidence_checked',
      validator_evidence_ref: 'nimi2d.validator:agent-skin',
      content_admission_ref: 'content:agent-skin',
      default_outfit_ref: 'n2d_default_outfit_agent',
      base_body_renderable: false,
      generation_bench_status: 'not_closed_by_avatar_runtime',
    });
    expect(handle.recordBootstrapVisualProof).toEqual(expect.any(Function));
    expect(readTextFileMock).toHaveBeenCalledWith('/models/agent-skin/runtime/nimi2d/package.yaml');
    expect(readTextFileMock).toHaveBeenCalledWith('/models/agent-skin/runtime/nimi2d/avatar-capability.yaml');
  });

  it('fails closed when a Nimi2D manifest lacks the Avatar capability profile', async () => {
    await expect(createBackendBranch(nimi2dManifest({
      nimi2d: {
        packageManifestPath: '/models/agent-skin/runtime/nimi2d/package.yaml',
        packageDigestSha256: null,
        capabilityProfileRef: null,
      },
    }))).rejects.toThrow(/requires an Avatar Nimi2D capability profile/);
  });

  it('fails closed when the Nimi2D package digest does not match the manifest', async () => {
    await expect(createBackendBranch(nimi2dManifest({
      nimi2d: {
        packageManifestPath: '/models/agent-skin/runtime/nimi2d/package.yaml',
        packageDigestSha256: '0'.repeat(64),
        capabilityProfileRef: '/models/agent-skin/runtime/nimi2d/avatar-capability.yaml',
      },
    }))).rejects.toThrow(/package digest mismatch/);
  });

  it('fails closed when Nimi2D package admission evidence is missing', async () => {
    const packageWithoutValidatorEvidence = VALID_PACKAGE.replace(
      '  validator_evidence_ref: "nimi2d.validator:agent-skin"\n',
      '',
    );
    readTextFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith('package.yaml')) return packageWithoutValidatorEvidence;
      if (path.endsWith('avatar-capability.yaml')) return VALID_PROFILE;
      throw new Error(`unexpected read path ${path}`);
    });

    await expect(createBackendBranch(nimi2dManifest({
      nimi2d: {
        packageManifestPath: '/models/agent-skin/runtime/nimi2d/package.yaml',
        packageDigestSha256: sha256Hex(packageWithoutValidatorEvidence),
        capabilityProfileRef: '/models/agent-skin/runtime/nimi2d/avatar-capability.yaml',
      },
    }))).rejects.toThrow(/validator evidence ref is required/);
  });

  it('fails closed when a Nimi2D package has no default outfit', async () => {
    const packageWithoutDefaultOutfit = VALID_PACKAGE.replace('wardrobe_kind: default_outfit', 'wardrobe_kind: accessory');
    readTextFileMock.mockImplementation(async (path: string) => {
      if (path.endsWith('package.yaml')) {
        return packageWithoutDefaultOutfit;
      }
      if (path.endsWith('avatar-capability.yaml')) return VALID_PROFILE;
      throw new Error(`unexpected read path ${path}`);
    });

    await expect(createBackendBranch(nimi2dManifest({
      nimi2d: {
        packageManifestPath: '/models/agent-skin/runtime/nimi2d/package.yaml',
        packageDigestSha256: sha256Hex(packageWithoutDefaultOutfit),
        capabilityProfileRef: '/models/agent-skin/runtime/nimi2d/avatar-capability.yaml',
      },
    }))).rejects.toThrow(/default outfit is missing/);
  });
});
