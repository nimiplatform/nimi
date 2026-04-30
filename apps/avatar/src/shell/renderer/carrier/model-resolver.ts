// Wave 1 of topic 2026-04-30-avatar-vrm-backend-branch (design-08).
//
// Backend-agnostic ModelManifest resolver. Detects backend kind from the
// resolved package and returns a discriminated union the rest of the
// renderer consumes (BackendBranch factory + carrier wiring).
//
// The platform-side resolver (`nimi_avatar_resolve_model`) currently only
// handles Live2D packages; VRM Tauri-side detection lands in a follow-up
// wave-1 step, at which point this module flips between the live2d / vrm
// kinds based on the resolved package contents.

import {
  resolveModelManifest as resolveLive2DTauriManifest,
  resolveAgentCenterAvatarPackageManifest as resolveLive2DAgentCenterPackageManifest,
  type AgentCenterAvatarPackageReference,
  type ModelManifest as Live2DTauriManifest,
} from '../live2d/model-loader.js';

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

export type { AgentCenterAvatarPackageReference };

export function fromLive2DTauriManifest(raw: Live2DTauriManifest): Live2DAvatarModelManifest {
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

export async function resolveAvatarModelManifest(modelPath: string): Promise<AvatarModelManifest> {
  const raw = await resolveLive2DTauriManifest(modelPath);
  return fromLive2DTauriManifest(raw);
}

export async function resolveAgentCenterAvatarPackageManifest(
  reference: AgentCenterAvatarPackageReference,
): Promise<AvatarModelManifest> {
  const raw = await resolveLive2DAgentCenterPackageManifest(reference);
  return fromLive2DTauriManifest(raw);
}
