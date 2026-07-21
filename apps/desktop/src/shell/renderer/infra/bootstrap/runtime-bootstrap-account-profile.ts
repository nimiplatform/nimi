import { realmSocialData } from '../../features/social/data/realm-social-data';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import type { DesktopRendererLifecyclePort } from '../../renderer/lifecycle-port.js';

export type RuntimeAccountProjection = {
  accountId?: string;
  displayName?: string;
  realmEnvironmentId?: string;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function mergeRuntimeAccountProjectionWithRealmProfile(input: {
  accountProjection: RuntimeAccountProjection;
  realmProfile: unknown;
  currentUser: Record<string, unknown> | null;
}): Record<string, unknown> {
  const profile = toRecord(input.realmProfile) ?? {};
  const currentUser = input.currentUser ?? {};
  const accountId = readNonEmptyString(input.accountProjection.accountId);
  const realmEnvironmentId = readNonEmptyString(input.accountProjection.realmEnvironmentId);
  const profileId = readNonEmptyString(profile.id);
  const displayName = readNonEmptyString(profile.displayName)
    ?? readNonEmptyString(profile.name)
    ?? readNonEmptyString(profile.handle)
    ?? readNonEmptyString(input.accountProjection.displayName)
    ?? readNonEmptyString(currentUser.displayName);

  return {
    ...currentUser,
    ...profile,
    id: profileId ?? accountId ?? readNonEmptyString(currentUser.id) ?? '',
    accountId: accountId ?? readNonEmptyString(profile.accountId) ?? readNonEmptyString(currentUser.accountId) ?? '',
    ...(displayName ? { displayName } : {}),
    ...(realmEnvironmentId ? { realmEnvironmentId } : {}),
  };
}

export async function hydrateDesktopAccountProfile(input: {
  accountProjection: RuntimeAccountProjection;
  flowId: string;
  lifecycle: DesktopRendererLifecyclePort;
}): Promise<void> {
  if (!readNonEmptyString(input.accountProjection.accountId)) {
    return;
  }
  const realmProfile: unknown = await realmSocialData.loadCurrentUser();
  const hydratedUser = mergeRuntimeAccountProjectionWithRealmProfile({
    accountProjection: input.accountProjection,
    realmProfile,
    currentUser: input.lifecycle.auth().user,
  });
  input.lifecycle.setAuthSession(hydratedUser);
  logRendererEvent({
    level: 'info',
    area: 'renderer-bootstrap',
    message: 'phase:account-profile:hydrated',
    flowId: input.flowId,
    details: {
      accountId: input.accountProjection.accountId,
      hasDisplayName: Boolean(readNonEmptyString(hydratedUser.displayName)),
      hasEmail: Boolean(readNonEmptyString(hydratedUser.email)),
      hasAvatar: Boolean(readNonEmptyString(hydratedUser.avatarUrl)),
    },
  });
}
