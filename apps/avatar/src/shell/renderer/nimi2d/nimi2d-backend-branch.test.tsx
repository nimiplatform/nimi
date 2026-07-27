import { createHash } from 'node:crypto';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Nimi2DAvatarModelManifest } from '@nimiplatform/kit/features/avatar/headless';

import { createNimi2DBackendBranch } from './nimi2d-backend-branch.js';

const readTextFileMock = vi.fn();
const pixiRendererMock = vi.hoisted(() => ({
  create: vi.fn(),
  handles: [] as Array<{
    updateSnapshot: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('../live2d/model-loader.js', () => ({
  readTextFile: (...args: unknown[]) => readTextFileMock(...args),
}));

vi.mock('./nimi2d-pixi-renderer.js', () => ({
  createNimi2DPixiRenderer: (...args: unknown[]) => pixiRendererMock.create(...args),
}));

const PACKAGE_YAML = `
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

const PROFILE_YAML = `
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
    motion_routes:
      lean_in:
        layer_refs:
          - layer_body
          - layer_mouth
          - layer_outfit
        translate_y_range_px:
          - 0
          - -12
        scale_x_range:
          - 1
          - 1.02
`;

const MANIFEST: Nimi2DAvatarModelManifest = {
  kind: 'nimi2d',
  modelId: 'agent-skin',
  runtimeDir: '/models/agent-skin/runtime',
  nimiDir: null,
  posterPath: null,
  nimi2d: {
    packageManifestPath: '/models/agent-skin/runtime/nimi2d/package.yaml',
    packageDigestSha256: sha256Hex(PACKAGE_YAML),
    capabilityProfileRef: '/models/agent-skin/runtime/nimi2d/avatar-capability.yaml',
  },
};

beforeEach(() => {
  readTextFileMock.mockReset();
  pixiRendererMock.create.mockReset();
  pixiRendererMock.handles.length = 0;
  pixiRendererMock.create.mockImplementation(async (input: {
    host: HTMLElement;
    renderPlan: { renderLayers: Array<{ layerRef: string }> };
    onReady?: (ready: { renderer: 'pixi.js'; layerRefs: string[]; canvas: HTMLCanvasElement }) => void;
  }) => {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('data-testid', 'avatar-nimi2d-pixi-canvas');
    canvas.setAttribute('data-nimi2d-renderer', 'pixi.js');
    input.host.replaceChildren(canvas);
    const layerRefs = input.renderPlan.renderLayers.map((layer) => layer.layerRef);
    input.onReady?.({ renderer: 'pixi.js', layerRefs, canvas });
    const handle = {
      renderer: 'pixi.js' as const,
      layerRefs,
      updateSnapshot: vi.fn(),
      resize: vi.fn(),
      destroy: vi.fn(),
    };
    pixiRendererMock.handles.push(handle);
    return handle;
  });
  readTextFileMock.mockImplementation(async (path: string) => {
    if (path.endsWith('package.yaml')) return PACKAGE_YAML;
    if (path.endsWith('avatar-capability.yaml')) return PROFILE_YAML;
    throw new Error(`unexpected read path ${path}`);
  });
});

describe('createNimi2DBackendBranch', () => {
  async function flushPixiSurface(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }

  it('renders base body layers only through an outfit-visible Pixi Nimi2D surface', async () => {
    const handle = await createNimi2DBackendBranch(MANIFEST);
    expect(handle.branch.metadata()).toEqual(expect.objectContaining({
      live_action_lanes: expect.objectContaining({
        gesture_motion: 'supported',
      }),
    }));
    const onAudioConsumerReady = vi.fn();
    const onHitRegionChange = vi.fn();
    const Surface = handle.branch.surface.Component;

    render(
      <Surface
        width={512}
        height={512}
        embodied
        onAudioConsumerReady={onAudioConsumerReady}
        onHitRegionChange={onHitRegionChange}
      />,
    );
    await flushPixiSurface();

    const carrier = screen.getByTestId('avatar-nimi2d-carrier');
    expect(carrier.getAttribute('data-nimi2d-activity')).toBe('idle');
    expect(carrier.getAttribute('data-nimi2d-expression')).toBe('neutral');
    expect(carrier.getAttribute('data-nimi2d-renderer')).toBe('pixi.js');
    expect(carrier.getAttribute('data-nimi2d-motion-queue-length')).toBe('0');
    expect(carrier.getAttribute('data-nimi2d-motion-completed-count')).toBe('0');
    expect(carrier.getAttribute('data-nimi2d-motion-interrupted-count')).toBe('0');
    expect(carrier.getAttribute('data-nimi2d-renderer-status')).toBe('ready');
    expect(carrier.getAttribute('data-nimi2d-layer-refs')).toBe('layer_body,layer_mouth,layer_outfit');
    expect(screen.getByTestId('avatar-nimi2d-pixi-canvas')).toBeTruthy();
    expect(onAudioConsumerReady).toHaveBeenCalledWith(handle.audioConsumer);
    expect(onHitRegionChange).toHaveBeenCalledTimes(1);
    expect(onHitRegionChange.mock.calls[0]?.[0].body).toEqual({
      left: 40 / 512,
      top: 20 / 512,
      right: 460 / 512,
      bottom: 490 / 512,
    });
    expect(onHitRegionChange.mock.calls[0]?.[0].drag).toEqual({
      left: 40 / 512,
      top: 20 / 512,
      right: 460 / 512,
      bottom: 490 / 512,
    });
    expect(onHitRegionChange.mock.calls[0]?.[0].isOpaqueAtClientPoint(64, 64)).toBeNull();
  });

  it('updates surface state through the backend projection composer', async () => {
    const handle = await createNimi2DBackendBranch(MANIFEST);
    const Surface = handle.branch.surface.Component;
    render(<Surface width={512} height={512} embodied />);

    await act(async () => {
      handle.branch.projection.applyActivity({ name: 'listen', intensity: 0.8 });
      handle.branch.projection.applyExpression({ name: 'curious', weight: 0.7 });
      handle.branch.projection.applyMotion({ routeId: 'lean_in' });
    });

    const carrier = screen.getByTestId('avatar-nimi2d-carrier');
    expect(carrier.getAttribute('data-nimi2d-activity')).toBe('listen');
    expect(carrier.getAttribute('data-nimi2d-expression')).toBe('curious');
    expect(carrier.getAttribute('data-nimi2d-motion')).toBe('lean_in');

    await flushPixiSurface();
    const pixiHandle = pixiRendererMock.handles[0];
    expect(pixiHandle?.updateSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      expression: 'curious',
      motion: 'lean_in',
      schedulerTimeMs: expect.any(Number),
    }));
  });
});
