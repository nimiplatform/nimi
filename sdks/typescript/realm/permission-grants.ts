import type {
  AppPermissionGrantDto,
  AppPermissionGrantState,
  RealmGetMyAppPermissionGrantOperationRequest,
  RealmListMyAppPermissionGrantsOperationRequest,
  RealmRequestMyAppPermissionGrantOperationRequest,
  RealmRevokeMyAppPermissionGrantOperationRequest,
  RealmTypedCallOptions,
  RealmTypedClient,
} from '../core-generated/realm-typed-client';
import type {
  GrantSpec,
  GrantState,
  GrantStatus,
  NimiAppScopeRef,
  PermissionTransport,
} from '../core/app';
import { createNimiError } from '../types';

export type NimiRealmPermissionGrantModule = Pick<
  RealmTypedClient,
  | 'getMyAppPermissionGrant'
  | 'getMyAppPermissionGrantStatus'
  | 'listMyAppPermissionGrants'
  | 'requestMyAppPermissionGrant'
  | 'revokeMyAppPermissionGrant'
>;

export interface NimiRealmPermissionGrantApi {
  readonly permissionGrants?: NimiRealmPermissionGrantModule;
}

export interface NimiRealmPermissionTransportOptions {
  readonly callOptions?: RealmTypedCallOptions | (() => RealmTypedCallOptions | Promise<RealmTypedCallOptions>);
  readonly subscribePollMs?: number;
  readonly onSubscribeError?: (error: unknown) => void;
}

const REALM_TO_SDK_GRANT_STATE: Readonly<Record<AppPermissionGrantState, GrantState>> = {
  PENDING: 'pending',
  GRANTED: 'granted',
  DENIED: 'denied',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
  SUPERSEDED: 'superseded',
};

const DEFAULT_SUBSCRIBE_POLL_MS = 30_000;
const MIN_SUBSCRIBE_POLL_MS = 1_000;

export function createNimiRealmPermissionTransport(
  api: object | NimiRealmPermissionGrantModule,
  options: NimiRealmPermissionTransportOptions = {},
): PermissionTransport {
  const grants = resolvePermissionGrantModule(api);

  async function callOptions(): Promise<RealmTypedCallOptions> {
    return typeof options.callOptions === 'function'
      ? await options.callOptions()
      : options.callOptions ?? {};
  }

  async function list(scopeRef: NimiAppScopeRef): Promise<readonly GrantStatus[]> {
    const request: RealmListMyAppPermissionGrantsOperationRequest = {
      path: {},
      query: { appId: scopeRef.ownerId },
    };
    const response = await grants.listMyAppPermissionGrants(request, await callOptions());
    return response.items.map((grant) => mapRealmGrant(scopeRef, grant));
  }

  async function get(scopeRef: NimiAppScopeRef, grantId: string): Promise<GrantStatus> {
    const request: RealmGetMyAppPermissionGrantOperationRequest = {
      path: { grantId },
    };
    return mapRealmGrant(scopeRef, await grants.getMyAppPermissionGrant(request, await callOptions()));
  }

  async function request(scopeRef: NimiAppScopeRef, grantSpec: GrantSpec): Promise<GrantStatus> {
    if (normalizeText(grantSpec.subjectUserId)) {
      throw realmPermissionError(
        'SDK_REALM_PERMISSION_SUBJECT_NOT_ADMITTED',
        'Realm permission grants bind subject authority to the authenticated account; subjectUserId is not an admitted request field.',
        'omit_permission_subject_user_id',
      );
    }
    const body: RealmRequestMyAppPermissionGrantOperationRequest['body'] = {
      appId: grantSpec.permissionScope.appId,
      scopeFamily: grantSpec.permissionScope.scopeFamily,
      scopeName: grantSpec.permissionScope.scopeName,
      reason: grantSpec.reason,
      ...(normalizeText(grantSpec.permissionScope.qualifier)
        ? { qualifier: normalizeText(grantSpec.permissionScope.qualifier) }
        : {}),
    };
    return mapRealmGrant(
      scopeRef,
      await grants.requestMyAppPermissionGrant({ path: {}, body }, await callOptions()),
    );
  }

  async function revoke(scopeRef: NimiAppScopeRef, grantId: string): Promise<GrantStatus> {
    const current = await grants.getMyAppPermissionGrant({ path: { grantId } }, await callOptions());
    const request: RealmRevokeMyAppPermissionGrantOperationRequest = {
      path: { grantId },
      body: {
        expectedVersion: current.version,
        reason: 'SDK permission revoke requested',
      },
    };
    return mapRealmGrant(scopeRef, await grants.revokeMyAppPermissionGrant(request, await callOptions()));
  }

  async function status(scopeRef: NimiAppScopeRef) {
    const response = await grants.getMyAppPermissionGrantStatus({
      path: {},
      query: { appId: scopeRef.ownerId },
    }, await callOptions());
    return {
      scopeRef,
      grants: response.grants.map((grant) => mapRealmGrant(scopeRef, grant)),
      generatedAt: response.generatedAt,
    };
  }

  return {
    list,
    get,
    request,
    revoke,
    status,
    subscribe(scopeRef, callback) {
      let closed = false;
      let initialized = false;
      let previous = new Map<string, string>();
      const pollMs = normalizePollMs(options.subscribePollMs);

      const poll = async () => {
        try {
          const snapshot = await status(scopeRef);
          if (closed) return;
          const next = new Map<string, string>();
          for (const grant of snapshot.grants) {
            const signature = grantSignature(grant);
            next.set(grant.grant.grantId, signature);
            if (initialized && previous.get(grant.grant.grantId) !== signature) {
              callback({
                scopeRef,
                grant,
                eventId: `realm-permission:${grant.grant.grantId}:${signature}`,
              });
            }
          }
          previous = next;
          initialized = true;
        } catch (error) {
          options.onSubscribeError?.(error);
        }
      };

      void poll();
      const timer = setInterval(() => {
        void poll();
      }, pollMs);
      return () => {
        closed = true;
        clearInterval(timer);
      };
    },
  };
}

function resolvePermissionGrantModule(
  api: object | NimiRealmPermissionGrantModule,
): NimiRealmPermissionGrantModule {
  const candidate = api as Partial<NimiRealmPermissionGrantApi> & {
    readonly permissionGrantModule?: NimiRealmPermissionGrantModule;
  };
  const grants = candidate.permissionGrantModule ?? candidate.permissionGrants ?? api;
  for (const method of [
    'getMyAppPermissionGrant',
    'getMyAppPermissionGrantStatus',
    'listMyAppPermissionGrants',
    'requestMyAppPermissionGrant',
    'revokeMyAppPermissionGrant',
  ] as const) {
    if (typeof (grants as Record<string, unknown>)[method] !== 'function') {
      throw realmPermissionError(
        'SDK_REALM_PERMISSION_TRANSPORT_INVALID',
        `Realm permission grant API is missing ${method}.`,
        'provide_realm_permission_grant_api',
      );
    }
  }
  return grants as NimiRealmPermissionGrantModule;
}

function mapRealmGrant(scopeRef: NimiAppScopeRef, grant: AppPermissionGrantDto): GrantStatus {
  const state = REALM_TO_SDK_GRANT_STATE[grant.state];
  if (!state) {
    throw realmPermissionError(
      'SDK_REALM_PERMISSION_RESPONSE_INVALID',
      `Realm permission grant state is not canonical: ${String(grant.state)}`,
      'check_realm_permission_grant_response',
    );
  }
  return {
    scopeRef,
    grant: {
      grantId: grant.grantId,
      permissionScope: {
        appId: grant.appId,
        scopeFamily: grant.scopeFamily,
        scopeName: grant.scopeName,
        ...(normalizeText(grant.qualifier) ? { qualifier: normalizeText(grant.qualifier) } : {}),
      },
      subjectUserId: grant.subjectAccountId,
    },
    state,
    issuedAt: normalizeText(grant.grantedAt) || grant.requestedAt,
    ...(normalizeText(grant.expiresAt) ? { expiresAt: normalizeText(grant.expiresAt) } : {}),
    detail: grant.reason,
  };
}

function grantSignature(grant: GrantStatus): string {
  return [
    grant.state,
    grant.issuedAt ?? '',
    grant.expiresAt ?? '',
    grant.detail ?? '',
    grant.grant.permissionScope.scopeFamily,
    grant.grant.permissionScope.scopeName,
    grant.grant.permissionScope.qualifier ?? '',
  ].join('|');
}

function normalizePollMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SUBSCRIBE_POLL_MS;
  return Math.max(MIN_SUBSCRIBE_POLL_MS, Math.trunc(value));
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function realmPermissionError(reasonCode: string, message: string, actionHint: string): Error {
  return createNimiError({
    message,
    reasonCode,
    actionHint,
    source: 'sdk',
  });
}
