import { dataSync } from '@runtime/data-sync';
import { extractRuntimeErrorFields } from '@runtime/telemetry/error-fields';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';

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

function isReauthenticationRequiredError(error: unknown): boolean {
  const errorFields = extractRuntimeErrorFields(error);
  const reasonCode = String(errorFields.reasonCode || '').trim().toUpperCase();
  const actionHint = String(errorFields.actionHint || '').trim().toLowerCase();
  const message = String(errorFields.message || (error instanceof Error ? error.message : error) || '').trim().toLowerCase();
  return (
    reasonCode === 'AUTH_REQUIRED'
    || reasonCode === 'AUTH_DENIED'
    || reasonCode === 'AUTH_TOKEN_INVALID'
    || reasonCode === 'AUTH_TOKEN_EXPIRED'
    || actionHint.includes('reauthenticate')
    || actionHint.includes('refresh_realm_token')
    || message.includes('authentication required')
  );
}

export async function hydrateDesktopAccountProfile(input: {
  accountProjection: RuntimeAccountProjection;
  flowId: string;
  onReauthenticationRequired?: () => Promise<void>;
}): Promise<void> {
  if (!readNonEmptyString(input.accountProjection.accountId)) {
    return;
  }
  let realmProfile: unknown;
  try {
    realmProfile = await dataSync.loadCurrentUser();
  } catch (error) {
    if (isReauthenticationRequiredError(error) && input.onReauthenticationRequired) {
      await input.onReauthenticationRequired();
    }
    throw error;
  }
  const hydratedUser = mergeRuntimeAccountProjectionWithRealmProfile({
    accountProjection: input.accountProjection,
    realmProfile,
    currentUser: useAppStore.getState().auth.user,
  });
  useAppStore.getState().setAuthSession(hydratedUser, '', undefined);
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
