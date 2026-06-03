export type AgentCenterLocalAvatarAssetReference = {
  accountId: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
  localAvatarAssetRef: string;
  backendKind: 'live2d' | 'vrm';
  backendCapabilityProfileRef: string;
  materializationRef: string;
};

export type LocalAvatarAssetReference = {
  accountId: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
};

export type Live2DLocalModelManifest = {
  runtimeDir: string;
  modelId: string;
  model3JsonPath: string;
  nimiDir: string | null;
  adapterManifestPath?: string | null;
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

export type AvatarModelManifest = Live2DAvatarModelManifest | VrmAvatarModelManifest;

export type TauriAvatarModelManifest = {
  kind?: string;
  runtime_dir?: string;
  model_id?: string;
  model3_json_path?: string | null;
  vrm_file_path?: string | null;
  nimi_dir?: string | null;
  motion_presets_dir?: string | null;
  adapter_manifest_path?: string | null;
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
      },
    };
  }
  if (kind === 'vrm') {
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
  throw new Error(`avatar model manifest kind is not admitted: ${kind}`);
}
