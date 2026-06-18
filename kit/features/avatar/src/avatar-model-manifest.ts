export type AgentCenterLocalAvatarAssetReference = {
  accountId: string;
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
  localAvatarAssetRef: string;
  backendKind: 'live2d' | 'vrm' | 'nimi2d';
  backendCapabilityProfileRef: string;
  materializationRef: string;
};

export type LocalAvatarAssetReference = {
  accountId: string;
  ownerUserId: string;
  runtimeSourceRef: string;
  localAgentRef: string;
};

export type Live2DLocalModelManifest = {
  runtimeDir: string;
  modelId: string;
  model3JsonPath: string;
  nimiDir: string | null;
  adapterManifestPath?: string | null;
  live2dCalibrationRef?: string | null;
};

export type Live2DAvatarModelManifest = {
  kind: 'live2d';
  modelId: string;
  runtimeDir: string;
  nimiDir: string | null;
  posterPath: string | null;
  live2d: {
    modelJson: string;
    adapterManifestPath: string | null;
    calibrationRef: string | null;
  };
};

export type VrmAvatarModelManifest = {
  kind: 'vrm';
  modelId: string;
  runtimeDir: string;
  nimiDir: string | null;
  posterPath: string | null;
  vrm: {
    vrmFile: string;
    motionPresetsDir: string | null;
  };
};

export type Nimi2DAvatarModelManifest = {
  kind: 'nimi2d';
  modelId: string;
  runtimeDir: string;
  nimiDir: string | null;
  posterPath: string | null;
  nimi2d: {
    packageManifestPath: string;
    packageDigestSha256: string | null;
    capabilityProfileRef: string | null;
  };
};

export type AvatarModelManifest = Live2DAvatarModelManifest | VrmAvatarModelManifest | Nimi2DAvatarModelManifest;

export type TauriAvatarModelManifest = {
  kind?: string;
  runtime_dir?: string;
  model_id?: string;
  model3_json_path?: string | null;
  vrm_file_path?: string | null;
  nimi_dir?: string | null;
  motion_presets_dir?: string | null;
  adapter_manifest_path?: string | null;
  live2d_calibration_ref?: string | null;
  nimi2d_package_manifest_path?: string | null;
  nimi2d_package_digest_sha256?: string | null;
  nimi2d_capability_profile_ref?: string | null;
};

function readRequiredString(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`avatar model manifest missing ${field}`);
  }
  return normalized;
}

function readOptionalString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function readLive2DCalibrationRef(value: unknown): string | null {
  const normalized = readOptionalString(value);
  if (!normalized) return null;
  if (!/^live2d_calibration_[a-f0-9]{12}$/.test(normalized)) {
    throw new Error('avatar model manifest live2d_calibration_ref is invalid');
  }
  return normalized;
}

export function fromLive2DLocalModelManifest(raw: Live2DLocalModelManifest): Live2DAvatarModelManifest {
  return {
    kind: 'live2d',
    modelId: raw.modelId,
    runtimeDir: raw.runtimeDir,
    nimiDir: raw.nimiDir,
    posterPath: null,
    live2d: {
      modelJson: raw.model3JsonPath,
      adapterManifestPath: raw.adapterManifestPath ?? null,
      calibrationRef: readLive2DCalibrationRef(raw.live2dCalibrationRef),
    },
  };
}

export function fromTauriAvatarModelManifest(raw: TauriAvatarModelManifest): AvatarModelManifest {
  const kind = readRequiredString(raw.kind, 'kind');
  const runtimeDir = readRequiredString(raw.runtime_dir, 'runtime_dir');
  const modelId = readRequiredString(raw.model_id, 'model_id');
  const nimiDir = readOptionalString(raw.nimi_dir);
  if (kind === 'live2d') {
    return {
      kind: 'live2d',
      modelId,
      runtimeDir,
      nimiDir,
      posterPath: null,
      live2d: {
        modelJson: readRequiredString(raw.model3_json_path, 'model3_json_path'),
        adapterManifestPath: readOptionalString(raw.adapter_manifest_path),
        calibrationRef: readLive2DCalibrationRef(raw.live2d_calibration_ref),
      },
    };
  }
  if (kind === 'vrm') {
    if (readOptionalString(raw.live2d_calibration_ref)) {
      throw new Error('avatar model manifest live2d_calibration_ref requires live2d kind');
    }
    if (readOptionalString(raw.nimi2d_package_manifest_path)) {
      throw new Error('avatar model manifest nimi2d_package_manifest_path requires nimi2d kind');
    }
    return {
      kind: 'vrm',
      modelId,
      runtimeDir,
      nimiDir,
      posterPath: null,
      vrm: {
        vrmFile: readRequiredString(raw.vrm_file_path, 'vrm_file_path'),
        motionPresetsDir: readOptionalString(raw.motion_presets_dir),
      },
    };
  }
  if (kind === 'nimi2d') {
    if (readOptionalString(raw.live2d_calibration_ref)) {
      throw new Error('avatar model manifest live2d_calibration_ref requires live2d kind');
    }
    if (readOptionalString(raw.vrm_file_path)) {
      throw new Error('avatar model manifest vrm_file_path requires vrm kind');
    }
    return {
      kind: 'nimi2d',
      modelId,
      runtimeDir,
      nimiDir,
      posterPath: null,
      nimi2d: {
        packageManifestPath: readRequiredString(raw.nimi2d_package_manifest_path, 'nimi2d_package_manifest_path'),
        packageDigestSha256: readOptionalString(raw.nimi2d_package_digest_sha256),
        capabilityProfileRef: readOptionalString(raw.nimi2d_capability_profile_ref),
      },
    };
  }
  throw new Error(`avatar model manifest kind is not admitted: ${kind}`);
}
