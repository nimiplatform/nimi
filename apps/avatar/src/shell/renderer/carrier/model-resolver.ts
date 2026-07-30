// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Backend-agnostic ModelManifest resolver. Detects backend kind from the
// resolved package and returns a discriminated union the rest of the
// renderer consumes (BackendBranch factory + carrier wiring).
//
// The Tauri resolver returns a local materialized Avatar asset. Agent Center
// naming here is current Desktop storage plumbing for private imports.
// It is not package lifecycle, inventory, or activation authority.

import {
  fromTauriAvatarModelManifest,
  type AgentCenterLocalAvatarAssetReference,
  type AvatarModelManifest,
  type TauriAvatarModelManifest,
} from '@nimiplatform/kit/features/avatar/headless';
import type { NimiRuntimeAgentPresentationProfileProjection } from '@nimiplatform/sdk/runtime';
import { invokeAvatarHostCommand } from '../app-shell/avatar-host-bridge.js';

export async function resolveAgentCenterAvatarAssetManifest(
  reference: AgentCenterLocalAvatarAssetReference,
): Promise<AvatarModelManifest> {
  const raw = await invokeAvatarHostCommand<TauriAvatarModelManifest>('nimi_avatar_resolve_agent_center_avatar_asset', {
    payload: reference,
  });
  return fromTauriAvatarModelManifest(raw);
}

export async function resolveRuntimePresentationAvatarAsset(input: {
  readonly accountId: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly presentationProfile: NimiRuntimeAgentPresentationProfileProjection | null | undefined;
}): Promise<{
  readonly manifest: AvatarModelManifest;
  readonly reference: AgentCenterLocalAvatarAssetReference;
}> {
  const reference = await runtimePresentationToAgentCenterReference(input);
  return {
    reference,
    manifest: await resolveAgentCenterAvatarAssetManifest(reference),
  };
}

export async function resolveRuntimePresentationAvatarAssetManifest(input: {
  readonly accountId: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly presentationProfile: NimiRuntimeAgentPresentationProfileProjection | null | undefined;
}): Promise<AvatarModelManifest> {
  return (await resolveRuntimePresentationAvatarAsset(input)).manifest;
}

async function runtimePresentationToAgentCenterReference(input: {
  readonly accountId: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly presentationProfile: NimiRuntimeAgentPresentationProfileProjection | null | undefined;
}): Promise<AgentCenterLocalAvatarAssetReference> {
  const profile = input.presentationProfile;
  const backendKind = profile?.backendKind === 'live2d' || profile?.backendKind === 'vrm'
    ? profile.backendKind
    : null;
  const avatarAssetRef = normalizeRequiredText(profile?.avatarAssetRef, 'Runtime presentation profile avatarAssetRef');
  if (!backendKind) {
    throw new Error('Runtime presentation profile must declare a Live2D or VRM backendKind before Avatar launch.');
  }
  if (!avatarAssetRef.startsWith(`${backendKind}_`) || !/^(?:live2d|vrm)_[a-f0-9]{12}$/u.test(avatarAssetRef)) {
    throw new Error('Runtime presentation profile avatarAssetRef is not a Kit Shell managed Avatar asset ref.');
  }
  const accountId = normalizeRequiredText(input.accountId, 'Runtime accountId');
  const localAgentRef = normalizeRequiredText(input.localAgentRef, 'Runtime localAgentRef');
  return {
    accountId,
    ownerUserId: normalizeRequiredText(input.ownerUserId, 'Runtime ownerUserId'),
    runtimeSourceRef: normalizeRequiredText(input.runtimeSourceRef, 'Runtime runtimeSourceRef'),
    localAgentRef,
    localAvatarAssetRef: avatarAssetRef,
    backendKind,
    backendCapabilityProfileRef: `avatar.backend_profile:${backendKind}:${avatarAssetRef}:import_validated`,
    materializationRef: `agent-center-avatar-asset:${await agentCenterPathSegment(accountId)}:${await agentCenterPathSegment(localAgentRef)}:${backendKind}:${avatarAssetRef}`,
  };
}

function normalizeRequiredText(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  return normalized;
}

async function agentCenterPathSegment(value: string): Promise<string> {
  const body = value.startsWith('~') ? value.slice(1) : value;
  if (
    body.length > 0
    && value.length <= 128
    && /^[a-z0-9][a-z0-9_-]*$/u.test(body)
  ) {
    return value;
  }
  const digest = await sha256Hex(value);
  return `id_${digest.slice(0, 24)}`;
}

async function sha256Hex(value: string): Promise<string> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error('Web Crypto is required to resolve Runtime presentation Avatar asset refs.');
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
