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
  type NimiAppHealthRepairAction,
  type NimiAppLifecycleEvent,
  type NimiAppLaunchScopeRef,
  type NimiAppOperationResult,
  type NimiAppRow,
  type NimiAppStatus,
  type NimiAppSubscription,
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

  async install(appId: string): Promise<NimiAppOperationResult> {
    return this.callOperation('install', appId, () => this.transport.install(appId));
  }

  async update(appId: string): Promise<NimiAppOperationResult> {
    return this.callOperation('update', appId, () => this.transport.update(appId));
  }

  async uninstall(appId: string): Promise<NimiAppOperationResult> {
    return this.callOperation('uninstall', appId, () => this.transport.uninstall(appId));
  }

  async launch(appId: string, scopeRef: NimiAppLaunchScopeRef): Promise<NimiAppOperationResult> {
    if (!scopeRef || typeof scopeRef.kind !== 'string' || typeof scopeRef.scopeId !== 'string' || scopeRef.scopeId.length === 0) {
      throw new NimiAppClientError('missing-required-field', 'launch: canonical scopeRef is required');
    }
    return this.callOperation('launch', appId, () => this.transport.launch(appId, scopeRef));
  }

  subscribe(callback: (event: NimiAppLifecycleEvent) => void): NimiAppSubscription {
    if (typeof callback !== 'function') {
      throw new NimiAppClientError('missing-required-field', 'subscribe: callback is required');
    }
    return this.transport.subscribe(callback);
  }

  async healthRepair(appId: string, action: NimiAppHealthRepairAction): Promise<NimiAppOperationResult> {
    if (!['cancel', 'retry', 'repair', 'reinstall'].includes(action)) {
      throw new NimiAppClientError('non-canonical-response', `healthRepair action "${String(action)}" is not canonical`);
    }
    return this.callOperation('health-repair', appId, () => this.transport.healthRepair(appId, action));
  }

  private async callOperation(
    operation: NimiAppOperationResult['operation'],
    appId: string,
    call: () => Promise<NimiAppOperationResult>,
  ): Promise<NimiAppOperationResult> {
    if (typeof appId !== 'string' || appId.length === 0) {
      throw new NimiAppClientError('missing-required-field', `${operation}: appId is required`);
    }
    try {
      const result = await call();
      if (!result || result.appId !== appId || result.operation !== operation || typeof result.reason !== 'string') {
        throw new NimiAppClientError('non-canonical-response', `${operation} response is not canonical`);
      }
      if (!['accepted', 'install-required', 'blocked', 'unsupported', 'failed'].includes(result.state)) {
        throw new NimiAppClientError('non-canonical-response', `${operation} response state is not canonical`);
      }
      return result;
    } catch (error) {
      if (error instanceof NimiAppClientError) throw error;
      throw new NimiAppClientError('transport-error', `${operation} transport error`, error);
    }
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
      'public-mod-or-extension-admission',
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
