import { describe, expect, it } from 'vitest';

import {
  fromLive2DLocalModelManifest,
  fromTauriAvatarModelManifest,
} from '../src/avatar-model-manifest.js';

describe('avatar model manifest projection', () => {
  it('projects direct Live2D local model manifests into the backend union', () => {
    expect(fromLive2DLocalModelManifest({
      runtimeDir: '/runtime',
      modelId: 'ren',
      model3JsonPath: '/runtime/ren.model3.json',
      nimiDir: '/runtime/nimi',
      adapterManifestPath: '/runtime/nimi/live2d-adapter.json',
    })).toEqual({
      kind: 'live2d',
      modelId: 'ren',
      runtimeDir: '/runtime',
      nimiDir: '/runtime/nimi',
      posterPath: null,
      live2d: {
        modelJson: '/runtime/ren.model3.json',
        adapterManifestPath: '/runtime/nimi/live2d-adapter.json',
      },
    });
  });

  it('normalizes shell-tauri live2d manifests', () => {
    expect(fromTauriAvatarModelManifest({
      kind: 'live2d',
      runtime_dir: '/runtime',
      model_id: 'ren',
      model3_json_path: '/runtime/ren.model3.json',
      nimi_dir: null,
      adapter_manifest_path: '',
    })).toEqual({
      kind: 'live2d',
      modelId: 'ren',
      runtimeDir: '/runtime',
      nimiDir: null,
      posterPath: null,
      live2d: {
        modelJson: '/runtime/ren.model3.json',
        adapterManifestPath: null,
      },
    });
  });

  it('normalizes shell-tauri vrm manifests', () => {
    expect(fromTauriAvatarModelManifest({
      kind: 'vrm',
      runtime_dir: '/runtime',
      model_id: 'model',
      vrm_file_path: '/runtime/model.vrm',
      motion_presets_dir: '/runtime/vrm-motion-presets',
      nimi_dir: '/runtime/nimi',
    })).toEqual({
      kind: 'vrm',
      modelId: 'model',
      runtimeDir: '/runtime',
      nimiDir: '/runtime/nimi',
      posterPath: null,
      vrm: {
        vrmFile: '/runtime/model.vrm',
        motionPresetsDir: '/runtime/vrm-motion-presets',
      },
    });
  });

  it('fails closed on missing required backend fields', () => {
    expect(() => fromTauriAvatarModelManifest({
      kind: 'vrm',
      runtime_dir: '/runtime',
      model_id: 'model',
    })).toThrow('avatar model manifest missing vrm_file_path');
  });

  it('fails closed on unknown backend kind', () => {
    expect(() => fromTauriAvatarModelManifest({
      kind: 'spine',
      runtime_dir: '/runtime',
      model_id: 'model',
    })).toThrow('avatar model manifest kind is not admitted: spine');
  });
});
