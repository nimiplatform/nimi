// Authority: .nimi/spec/avatar/embodiment-surface.authority.yaml.
//
// Backend-agnostic ModelManifest resolver. Detects backend kind from the
// resolved package and returns a discriminated union the rest of the
// renderer consumes (BackendBranch factory + carrier wiring).
//
// The native Host resolver returns a local materialized Avatar asset. Agent Center
// naming here is current Desktop storage plumbing for private imports.
// It is not package lifecycle, inventory, or activation authority.

import {
  fromHostAvatarModelManifest,
  type AvatarModelManifest,
  type HostAvatarModelManifest,
} from '@nimiplatform/kit/features/avatar/headless';
import type { NimiLocalAppAgentPresentationProfile } from '@nimiplatform/sdk/app';
import { invokeAvatarHostCommand } from '../app-shell/avatar-host-bridge.js';

export async function resolveRuntimePresentationAvatarAsset(input: {
  readonly agentHandle: string;
  readonly presentationRevision: string;
  readonly presentationProfile: NimiLocalAppAgentPresentationProfile | null | undefined;
}): Promise<{
  readonly manifest: AvatarModelManifest;
  readonly reference: Readonly<{
    localAvatarAssetRef: string;
    backendKind: 'live2d' | 'vrm';
    materializationRef: string;
    materializationLeaseRef: string;
  }>;
}> {
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
  const response = await invokeAvatarHostCommand<{
    readonly manifest: HostAvatarModelManifest;
    readonly materializationRef: string;
    readonly materializationLeaseRef: string;
  }>('nimi_avatar_resolve_agent_center_avatar_asset', {
    payload: {
      agentHandle: normalizeRequiredText(input.agentHandle, 'current-session Agent handle'),
      avatarAssetRef,
      backendKind,
      presentationRevision: normalizeRequiredText(
        input.presentationRevision,
        'Avatar presentation revision',
      ),
    },
  });
  return {
    reference: {
      localAvatarAssetRef: avatarAssetRef,
      backendKind,
      materializationRef: normalizeRequiredText(response.materializationRef, 'Avatar materializationRef'),
      materializationLeaseRef: normalizeRequiredText(
        response.materializationLeaseRef,
        'Avatar materialization lease ref',
      ),
    },
    manifest: fromHostAvatarModelManifest(response.manifest),
  };
}

export async function commitRuntimePresentationMaterializationLease(input: {
  readonly materializationLeaseRef: string;
  readonly materializationRef: string;
  readonly avatarAssetRef: string;
  readonly backendKind: 'live2d' | 'vrm';
  readonly presentationRevision: string;
}): Promise<void> {
  const response = await invokeAvatarHostCommand<{
    readonly accepted: boolean;
    readonly materializationRef: string;
  }>('nimi_avatar_commit_materialization_lease', {
    materializationLeaseRef: normalizeRequiredText(input.materializationLeaseRef, 'Avatar materialization lease ref'),
    avatarAssetRef: normalizeRequiredText(input.avatarAssetRef, 'Avatar asset ref'),
    backendKind: input.backendKind,
    presentationRevision: normalizeRequiredText(input.presentationRevision, 'Avatar presentation revision'),
    materializationRef: normalizeRequiredText(input.materializationRef, 'Avatar materializationRef'),
  });
  if (response.accepted !== true
    || normalizeRequiredText(response.materializationRef, 'Avatar materializationRef') !== input.materializationRef) {
    throw new Error('Avatar Host did not commit the exact materialization lease.');
  }
}

export async function releaseRuntimePresentationMaterializationLease(
  materializationLeaseRef: string,
): Promise<void> {
  await invokeAvatarHostCommand('nimi_avatar_release_materialization_lease', {
    materializationLeaseRef: normalizeRequiredText(
      materializationLeaseRef,
      'Avatar materialization lease ref',
    ),
  });
}

export async function resolveRuntimePresentationAvatarAssetManifest(input: {
  readonly agentHandle: string;
  readonly presentationRevision: string;
  readonly presentationProfile: NimiLocalAppAgentPresentationProfile | null | undefined;
}): Promise<AvatarModelManifest> {
  return (await resolveRuntimePresentationAvatarAsset(input)).manifest;
}

function normalizeRequiredText(value: unknown, field: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  return normalized;
}
