import {
  ConnectorGrantStatus,
  type ConnectorGrant,
  type RuntimeTypedCallOptions,
  type RuntimeTypedClient,
} from '../core-generated/runtime-typed-client.js';
import { createNimiClientId, createNimiError } from '../types/index.js';
import { toNimiRuntimeIsoFromTimestamp } from './runtime-agent-values.js';
import { withNimiRuntimeIdempotencyMetadata } from './scenario-jobs.js';

const DEFAULT_CONNECTOR_GRANT_PAGE_SIZE = 200;
const DEFAULT_CONNECTOR_GRANT_MAX_PAGES = 200;

export type NimiRuntimeConnectorGrantStatus = 'active' | 'revoked';

/** Account-scoped authorization projection. It intentionally carries no provider or model target. */
export interface NimiRuntimeConnectorGrant {
  readonly grantId: string;
  readonly connectorId: string;
  readonly status: NimiRuntimeConnectorGrantStatus;
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

export type NimiRuntimeConnectorGrantRpcClient = Pick<
  RuntimeTypedClient,
  'createConnectorGrant' | 'listConnectorGrants' | 'revokeConnectorGrant'
>;

export interface NimiRuntimeConnectorGrantClientOptions {
  readonly runtime: NimiRuntimeConnectorGrantRpcClient | (() => NimiRuntimeConnectorGrantRpcClient);
  readonly callOptions?: RuntimeTypedCallOptions;
  readonly pageSize?: number;
  readonly maxPages?: number;
}

export interface NimiRuntimeConnectorGrantClient {
  create(connectorId: string): Promise<NimiRuntimeConnectorGrant>;
  list(): Promise<readonly NimiRuntimeConnectorGrant[]>;
  revoke(grantId: string): Promise<NimiRuntimeConnectorGrant>;
}

/**
 * Creates the typed ConnectorGrant lifecycle client. ConnectorGrant remains an
 * explicit account authorization reference; this client never accepts or
 * derives CapabilityImplementation or provider-model target data.
 */
export function createNimiRuntimeConnectorGrantClient(
  options: NimiRuntimeConnectorGrantClientOptions,
): NimiRuntimeConnectorGrantClient {
  const pageSize = normalizePageSize(options.pageSize);
  const maxPages = normalizeMaxPages(options.maxPages);
  const runtime = (): NimiRuntimeConnectorGrantRpcClient => (
    typeof options.runtime === 'function' ? options.runtime() : options.runtime
  );

  return Object.freeze({
    async create(connectorId: string) {
      const exactConnectorId = requireExactIdentifier(connectorId, 'ConnectorGrant connectorId is required.');
      const response = await runtime().createConnectorGrant(
        { connectorId: exactConnectorId },
        withNimiRuntimeIdempotencyMetadata(
          options.callOptions ?? {},
          createNimiClientId('connector-grant-create'),
        ),
      );
      const grant = projectConnectorGrant(response.grant, 'CreateConnectorGrant');
      if (grant.connectorId !== exactConnectorId || grant.status !== 'active') {
        invalidGrantResponse('CreateConnectorGrant returned a mismatched or inactive ConnectorGrant.');
      }
      return grant;
    },

    async list() {
      const result: NimiRuntimeConnectorGrant[] = [];
      const seenGrantIds = new Set<string>();
      const seenPageTokens = new Set<string>();
      let pageToken = '';
      for (let page = 0; page < maxPages; page += 1) {
        const response = await runtime().listConnectorGrants({
          pageSize,
          pageToken,
        }, options.callOptions);
        for (const value of response.grants ?? []) {
          const grant = projectConnectorGrant(value, `ListConnectorGrants.grants[${result.length}]`);
          if (seenGrantIds.has(grant.grantId)) {
            invalidGrantResponse(`ListConnectorGrants returned duplicate grant ${grant.grantId}.`);
          }
          seenGrantIds.add(grant.grantId);
          result.push(grant);
        }
        const nextPageToken = normalizeOptionalExactText(response.nextPageToken);
        if (!nextPageToken) {
          return Object.freeze([...result]);
        }
        if (seenPageTokens.has(nextPageToken)) {
          invalidGrantResponse('ListConnectorGrants returned a repeated page token.');
        }
        seenPageTokens.add(nextPageToken);
        pageToken = nextPageToken;
      }
      invalidGrantResponse('ListConnectorGrants exceeded the bounded page limit.');
    },

    async revoke(grantId: string) {
      const exactGrantId = requireExactIdentifier(grantId, 'ConnectorGrant grantId is required.');
      const response = await runtime().revokeConnectorGrant(
        { grantId: exactGrantId },
        withNimiRuntimeIdempotencyMetadata(
          options.callOptions ?? {},
          createNimiClientId('connector-grant-revoke'),
        ),
      );
      const grant = projectConnectorGrant(response.grant, 'RevokeConnectorGrant');
      if (grant.grantId !== exactGrantId || grant.status !== 'revoked') {
        invalidGrantResponse('RevokeConnectorGrant returned a mismatched or active ConnectorGrant.');
      }
      return grant;
    },
  });
}

export function projectNimiRuntimeConnectorGrant(
  value: ConnectorGrant,
): NimiRuntimeConnectorGrant {
  return projectConnectorGrant(value, 'ConnectorGrant');
}

function projectConnectorGrant(
  value: ConnectorGrant | undefined,
  operation: string,
): NimiRuntimeConnectorGrant {
  if (!value) {
    invalidGrantResponse(`${operation} returned no ConnectorGrant.`);
  }
  const grantId = requireResponseIdentifier(value.grantId, `${operation}.grantId`);
  const connectorId = requireResponseIdentifier(value.connectorId, `${operation}.connectorId`);
  requireResponseIdentifier(value.accountId, `${operation}.accountId`);
  const createdAt = toNimiRuntimeIsoFromTimestamp(value.createdAt);
  if (!createdAt) {
    invalidGrantResponse(`${operation}.createdAt is invalid.`);
  }
  if (value.status === ConnectorGrantStatus.ACTIVE) {
    if (value.revokedAt) {
      invalidGrantResponse(`${operation} returned an active ConnectorGrant with revokedAt.`);
    }
    return Object.freeze({
      grantId,
      connectorId,
      status: 'active',
      createdAt,
      revokedAt: null,
    });
  }
  if (value.status === ConnectorGrantStatus.REVOKED) {
    const revokedAt = toNimiRuntimeIsoFromTimestamp(value.revokedAt);
    if (!revokedAt) {
      invalidGrantResponse(`${operation} returned a revoked ConnectorGrant without revokedAt.`);
    }
    return Object.freeze({
      grantId,
      connectorId,
      status: 'revoked',
      createdAt,
      revokedAt,
    });
  }
  return invalidGrantResponse(`${operation}.status is unspecified.`);
}

function normalizePageSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_CONNECTOR_GRANT_PAGE_SIZE;
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) {
    inputError('ConnectorGrant pageSize must be an integer from 1 to 200.');
  }
  return value;
}

function normalizeMaxPages(value: number | undefined): number {
  if (value === undefined) return DEFAULT_CONNECTOR_GRANT_MAX_PAGES;
  if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_CONNECTOR_GRANT_MAX_PAGES) {
    inputError(`ConnectorGrant maxPages must be an integer from 1 to ${DEFAULT_CONNECTOR_GRANT_MAX_PAGES}.`);
  }
  return value;
}

function requireExactIdentifier(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    inputError(message);
  }
  return value;
}

function requireResponseIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    invalidGrantResponse(`${label} is invalid.`);
  }
  return value;
}

function normalizeOptionalExactText(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.trim() !== value) {
    invalidGrantResponse('ConnectorGrant page token is invalid.');
  }
  return value;
}

function inputError(message: string): never {
  throw createNimiError({
    message,
    reasonCode: 'SDK_CONNECTOR_GRANT_INPUT_INVALID',
    actionHint: 'provide_exact_connector_grant_identifier',
    source: 'sdk',
  });
}

function invalidGrantResponse(message: string): never {
  throw createNimiError({
    message,
    reasonCode: 'SDK_CONNECTOR_GRANT_RESPONSE_INVALID',
    actionHint: 'inspect_runtime_connector_grant_contract',
    source: 'runtime',
  });
}
