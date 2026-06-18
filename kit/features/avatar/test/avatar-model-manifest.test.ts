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
        calibrationRef: null,
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
        calibrationRef: null,
      },
    });
  });

  it('normalizes shell-tauri Live2D calibration refs as opaque resolver evidence', () => {
    expect(fromTauriAvatarModelManifest({
      kind: 'live2d',
      runtime_dir: '/runtime',
      model_id: 'ren',
      model3_json_path: '/runtime/ren.model3.json',
      nimi_dir: null,
      adapter_manifest_path: null,
      live2d_calibration_ref: ' live2d_calibration_ab12cd34ef56 ',
    })).toEqual({
      kind: 'live2d',
      modelId: 'ren',
      runtimeDir: '/runtime',
      nimiDir: null,
      posterPath: null,
      live2d: {
        modelJson: '/runtime/ren.model3.json',
        adapterManifestPath: null,
        calibrationRef: 'live2d_calibration_ab12cd34ef56',
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

  it('normalizes shell-tauri Nimi2D manifests without admitting renderer success', () => {
    expect(fromTauriAvatarModelManifest({
      kind: 'nimi2d',
      runtime_dir: '/runtime',
      model_id: 'agent-skin',
      nimi_dir: '/runtime/nimi',
      nimi2d_package_manifest_path: '/runtime/nimi2d/package.yaml',
      nimi2d_package_digest_sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      nimi2d_capability_profile_ref: 'avatar.nimi2d.capability-profile:agent-skin',
    })).toEqual({
      kind: 'nimi2d',
      modelId: 'agent-skin',
      runtimeDir: '/runtime',
      nimiDir: '/runtime/nimi',
      posterPath: null,
      nimi2d: {
        packageManifestPath: '/runtime/nimi2d/package.yaml',
        packageDigestSha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        capabilityProfileRef: 'avatar.nimi2d.capability-profile:agent-skin',
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

  it('fails closed on invalid Live2D calibration refs', () => {
    expect(() => fromTauriAvatarModelManifest({
      kind: 'live2d',
      runtime_dir: '/runtime',
      model_id: 'ren',
      model3_json_path: '/runtime/ren.model3.json',
      live2d_calibration_ref: 'live2d_calibration_ABCDEF123456',
    })).toThrow('avatar model manifest live2d_calibration_ref is invalid');
  });

  it('fails closed when VRM manifests carry Live2D calibration refs', () => {
    expect(() => fromTauriAvatarModelManifest({
      kind: 'vrm',
      runtime_dir: '/runtime',
      model_id: 'model',
      vrm_file_path: '/runtime/model.vrm',
      live2d_calibration_ref: 'live2d_calibration_ab12cd34ef56',
    })).toThrow('avatar model manifest live2d_calibration_ref requires live2d kind');
  });

  it('fails closed when Nimi2D manifests are missing package evidence', () => {
    expect(() => fromTauriAvatarModelManifest({
      kind: 'nimi2d',
      runtime_dir: '/runtime',
      model_id: 'agent-skin',
    })).toThrow('avatar model manifest missing nimi2d_package_manifest_path');
  });

  it('fails closed when non-Nimi2D manifests carry Nimi2D package refs', () => {
    expect(() => fromTauriAvatarModelManifest({
      kind: 'vrm',
      runtime_dir: '/runtime',
      model_id: 'model',
      vrm_file_path: '/runtime/model.vrm',
      nimi2d_package_manifest_path: '/runtime/nimi2d/package.yaml',
    })).toThrow('avatar model manifest nimi2d_package_manifest_path requires nimi2d kind');
  });
});
