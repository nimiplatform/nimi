// SDK Nimi App client. Typed transport over the Nimi App registry +
// status surfaces. Per Wave 2 admission rule, this is a read-only
// transport floor; install/update/launch lifecycle is owned by Wave 4.
//
// Per closed redesign (P-NAPP-012, P-MOEX-006), this client rejects any
// non-canonical app kind. Trust tier values are validated against the
// canonical enum from `tables/nimi-app-trust-tiers.yaml`.

import type { NimiAppTransport } from './transport.js';
import {
  isCanonicalAppKind,
  isCanonicalLaunchReadiness,
  isCanonicalTrustTier,
  type NimiAppRow,
  type NimiAppStatus,
} from './types.js';

export class NimiAppClientError extends Error {
  readonly code:
    | 'invalid-dependency'
    | 'transport-error'
    | 'non-canonical-response'
    | 'missing-required-field'
    | 'public-mod-or-extension-admission';
  constructor(
    code: NimiAppClientError['code'],
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.code = code;
    this.name = 'NimiAppClientError';
  }
}

export class NimiAppClient {
  constructor(private readonly transport: NimiAppTransport) {
    if (transport === null || transport === undefined) {
      throw new NimiAppClientError('invalid-dependency', 'NimiAppClient: transport is required');
    }
  }

  async listRegistry(): Promise<readonly NimiAppRow[]> {
    let response;
    try {
      response = await this.transport.listRegistry();
    } catch (error) {
      throw new NimiAppClientError('transport-error', 'listRegistry transport error', error);
    }
    if (!Array.isArray(response)) {
      throw new NimiAppClientError('missing-required-field', 'listRegistry response is not an array');
    }
    for (const row of response) {
      validateRow(row);
    }
    return response;
  }

  async getAppStatus(appId: string): Promise<NimiAppStatus> {
    if (typeof appId !== 'string' || appId.length === 0) {
      throw new NimiAppClientError('missing-required-field', 'getAppStatus: appId is required');
    }
    let response;
    try {
      response = await this.transport.getAppStatus(appId);
    } catch (error) {
      throw new NimiAppClientError('transport-error', 'getAppStatus transport error', error);
    }
    if (!response || typeof response.appId !== 'string' || response.appId.length === 0) {
      throw new NimiAppClientError('missing-required-field', 'getAppStatus response missing appId');
    }
    if (!isCanonicalLaunchReadiness(response.launchReadiness)) {
      throw new NimiAppClientError(
        'non-canonical-response',
        `getAppStatus response launchReadiness "${String(response.launchReadiness)}" is not canonical`,
      );
    }
    return response;
  }
}

function validateRow(row: NimiAppRow | null | undefined): void {
  if (!row) {
    throw new NimiAppClientError('missing-required-field', 'listRegistry: row is null/undefined');
  }
  if (typeof row.appId !== 'string' || row.appId.length === 0) {
    throw new NimiAppClientError('missing-required-field', 'listRegistry row missing appId');
  }
  if (typeof row.displayName !== 'string' || row.displayName.length === 0) {
    throw new NimiAppClientError('missing-required-field', 'listRegistry row missing displayName');
  }
  if (typeof row.publisher !== 'string' || row.publisher.length === 0) {
    throw new NimiAppClientError('missing-required-field', 'listRegistry row missing publisher');
  }
  if (typeof row.sourceRule !== 'string' || row.sourceRule.length === 0) {
    throw new NimiAppClientError('missing-required-field', 'listRegistry row missing sourceRule');
  }
  if (!isCanonicalAppKind(row.appKind)) {
    throw new NimiAppClientError(
      'public-mod-or-extension-admission',
      `listRegistry row appKind "${String(row.appKind)}" is not an admitted Nimi App kind`,
    );
  }
  if (!isCanonicalTrustTier(row.trustTier)) {
    throw new NimiAppClientError(
      'non-canonical-response',
      `listRegistry row trustTier "${String(row.trustTier)}" is not a canonical trust tier`,
    );
  }
}
