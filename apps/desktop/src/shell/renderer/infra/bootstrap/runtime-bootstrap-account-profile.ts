import type { logRendererEvent } from '@nimiplatform/kit/telemetry';
import {
  DEFAULT_NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS,
  safeBootstrapErrorMessage,
  withBootstrapStepTimeout,
} from '@nimiplatform/kit/shell/renderer/bootstrap';
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

type ProfileIdentity = {
  accountId: string;
  realmEnvironmentId: string;
  authorizationRevision: string;
};

function authenticatedIdentity(lifecycle: Pick<DesktopRendererLifecyclePort, 'auth'>): ProfileIdentity | null {
  const auth = lifecycle.auth();
  const accountId = readNonEmptyString(auth.user?.id);
  const realmEnvironmentId = readNonEmptyString(auth.user?.realmEnvironmentId);
  if (auth.status !== 'authenticated' || !accountId || !realmEnvironmentId || !auth.authorizationRevision
    || accountId !== auth.user?.id || realmEnvironmentId !== auth.user?.realmEnvironmentId) return null;
  return { accountId, realmEnvironmentId, authorizationRevision: auth.authorizationRevision };
}

function sameIdentity(left: ProfileIdentity, right: ProfileIdentity | null): boolean {
  return right !== null && left.accountId === right.accountId
    && left.realmEnvironmentId === right.realmEnvironmentId
    && left.authorizationRevision === right.authorizationRevision;
}

export type DesktopAccountProfileHydrator = {
  hydrate: () => Promise<void>;
  dispose: () => void;
};

// @nimi-authority: rule.nimi.desktop.shell-runtime.r011
export function createDesktopAccountProfileHydrator(input: {
  flowId: string;
  lifecycle: Pick<DesktopRendererLifecyclePort, 'auth' | 'setAuthSession'>;
  readClientScope: () => object | null;
  isCurrentBootstrap: () => boolean;
  loadCurrentUser: () => Promise<unknown>;
  logEvent: typeof logRendererEvent;
  timeoutMs?: number;
}): DesktopAccountProfileHydrator {
  let disposed = false;
  let revision = 0;
  let pending: { identity: ProfileIdentity; clientScope: object; promise: Promise<void> } | null = null;
  return {
    hydrate() {
      const identity = authenticatedIdentity(input.lifecycle);
      if (disposed || !input.isCurrentBootstrap() || !identity) return Promise.resolve();
      const clientScope = input.readClientScope();
      if (!clientScope) return Promise.resolve();
      if (pending && pending.clientScope === clientScope && sameIdentity(pending.identity, identity)) return pending.promise;
      const requestRevision = ++revision;
      const isCurrent = () => !disposed && revision === requestRevision && input.isCurrentBootstrap()
        && input.readClientScope() === clientScope && sameIdentity(identity, authenticatedIdentity(input.lifecycle));
      const promise = (async () => {
        try {
          // Bound the read before its commit continuation. An outer timeout
          // alone would leave a late loadCurrentUser reply free to publish.
          const realmProfile = await withBootstrapStepTimeout(
            'account profile hydrate',
            Promise.resolve().then(() => isCurrent() ? input.loadCurrentUser() : undefined),
            input.timeoutMs ?? DEFAULT_NON_CRITICAL_BOOTSTRAP_STEP_TIMEOUT_MS,
          );
          if (!isCurrent()) return;
          if (toRecord(realmProfile)?.id !== identity.accountId) {
            throw new Error('Realm account profile does not match the current Runtime account.');
          }
          const hydratedUser = mergeRuntimeAccountProjectionWithRealmProfile({
            accountProjection: identity,
            realmProfile,
            currentUser: input.lifecycle.auth().user,
          });
          input.lifecycle.setAuthSession(hydratedUser);
          input.logEvent({
            level: 'info', area: 'renderer-bootstrap', message: 'phase:account-profile:hydrated', flowId: input.flowId,
            details: { accountId: identity.accountId, hasDisplayName: Boolean(readNonEmptyString(hydratedUser.displayName)),
              hasEmail: Boolean(readNonEmptyString(hydratedUser.email)), hasAvatar: Boolean(readNonEmptyString(hydratedUser.avatarUrl)) },
          });
        } catch (error) {
          if (!isCurrent()) return;
          input.logEvent({
            level: 'warn', area: 'renderer-bootstrap', message: 'phase:account-profile:hydrate-deferred', flowId: input.flowId,
            details: { accountId: identity.accountId, error: safeBootstrapErrorMessage(error) },
          });
        } finally {
          if (revision === requestRevision) pending = null;
        }
      })();
      pending = { identity, clientScope, promise };
      return promise;
    },
    dispose() {
      disposed = true;
      revision++;
      pending = null;
    },
  };
}
