// SDK Nimi App client. Typed transport over the Nimi App registry +
// status surfaces. This is a pure read-projection floor: list / get /
// status only.
//
// T4 Fork B: every Nimi App lifecycle mutation — install / update /
// uninstall / open / healthRepair, and lifecycle-event subscription — is
// owned by the runtime-mediated `runtime.appLifecycle` surface
// (`@nimiplatform/sdk/runtime`). NimiAppClient does not expose mutation
// methods, so there is one typed app-lifecycle surface and no parallel-truth
// fail-closed stubs.
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
    | 'non-canonical-app-kind';
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

  async list(): Promise<readonly NimiAppRow[]> {
    let response;
    try {
      response = await this.transport.list();
    } catch (error) {
      throw new NimiAppClientError('transport-error', 'list transport error', error);
    }
    if (!Array.isArray(response)) {
      throw new NimiAppClientError('missing-required-field', 'list response is not an array');
    }
    for (const row of response) {
      validateRow(row);
    }
    return response;
  }

  async get(appId: string): Promise<NimiAppRow> {
    if (typeof appId !== 'string' || appId.length === 0) {
      throw new NimiAppClientError('missing-required-field', 'get: appId is required');
    }
    let response;
    try {
      response = await this.transport.get(appId);
    } catch (error) {
      throw new NimiAppClientError('transport-error', 'get transport error', error);
    }
    validateRow(response);
    return response;
  }

  async status(appId: string): Promise<NimiAppStatus> {
    if (typeof appId !== 'string' || appId.length === 0) {
      throw new NimiAppClientError('missing-required-field', 'status: appId is required');
    }
    let response;
    try {
      response = await this.transport.status(appId);
    } catch (error) {
      throw new NimiAppClientError('transport-error', 'status transport error', error);
    }
    if (!response || typeof response.appId !== 'string' || response.appId.length === 0) {
      throw new NimiAppClientError('missing-required-field', 'status response missing appId');
    }
    if (!isCanonicalLaunchReadiness(response.launchReadiness)) {
      throw new NimiAppClientError(
        'non-canonical-response',
        `status response launchReadiness "${String(response.launchReadiness)}" is not canonical`,
      );
    }
    return response;
  }
}

function validateRow(row: NimiAppRow | null | undefined): void {
  if (!row) {
    throw new NimiAppClientError('missing-required-field', 'list: row is null/undefined');
  }
  if (typeof row.appId !== 'string' || row.appId.length === 0) {
    throw new NimiAppClientError('missing-required-field', 'list row missing appId');
  }
  if (typeof row.displayName !== 'string' || row.displayName.length === 0) {
    throw new NimiAppClientError('missing-required-field', 'list row missing displayName');
  }
  if (typeof row.publisher !== 'string' || row.publisher.length === 0) {
    throw new NimiAppClientError('missing-required-field', 'list row missing publisher');
  }
  if (typeof row.sourceRule !== 'string' || row.sourceRule.length === 0) {
    throw new NimiAppClientError('missing-required-field', 'list row missing sourceRule');
  }
  if (typeof row.releaseDescriptorRef !== 'string' || row.releaseDescriptorRef.length === 0) {
    throw new NimiAppClientError('missing-required-field', 'list row missing releaseDescriptorRef');
  }
  if (typeof row.installStoragePolicyRef !== 'string' || row.installStoragePolicyRef.length === 0) {
    throw new NimiAppClientError('missing-required-field', 'list row missing installStoragePolicyRef');
  }
  if (!isCanonicalAppKind(row.appKind)) {
      throw new NimiAppClientError(
      'non-canonical-app-kind',
      `list row appKind "${String(row.appKind)}" is not an admitted Nimi App kind`,
    );
  }
  if (!isCanonicalTrustTier(row.trustTier)) {
    throw new NimiAppClientError(
      'non-canonical-response',
      `list row trustTier "${String(row.trustTier)}" is not a canonical trust tier`,
    );
  }
}
