// Wave 1 of topic 2026-04-30-avatar-vrm-backend-branch (design-08).
//
// Backend-agnostic ModelManifest resolver. Detects backend kind from the
// resolved package and returns a discriminated union the rest of the
// renderer consumes (BackendBranch factory + carrier wiring).
//
// The Tauri resolver returns a local materialized Avatar asset. Agent Center
// naming here is current Desktop storage plumbing for private imports.
// It is not package lifecycle, inventory, or activation authority.

import { invoke } from '@tauri-apps/api/core';
import {
  fromTauriAvatarModelManifest,
  type AgentCenterLocalAvatarAssetReference,
  type AvatarModelManifest,
  type LocalAvatarAssetReference,
  type TauriAvatarModelManifest,
} from '@nimiplatform/kit/features/avatar/headless';

export async function resolveAgentCenterAvatarAssetManifest(
  reference: AgentCenterLocalAvatarAssetReference,
): Promise<AvatarModelManifest> {
  const raw = await invoke<TauriAvatarModelManifest>('nimi_avatar_resolve_agent_center_avatar_asset', {
    payload: reference,
  });
  return fromTauriAvatarModelManifest(raw);
}

export async function resolveLocalAvatarAssetManifest(
  reference: LocalAvatarAssetReference,
): Promise<AvatarModelManifest> {
  const raw = await invoke<TauriAvatarModelManifest>('nimi_avatar_resolve_local_avatar_asset', {
    payload: reference,
  });
  return fromTauriAvatarModelManifest(raw);
}
