// SDK Permission client. S-PERM typed access only; grant lifecycle truth lives
// in the admitted Runtime / Realm / Cognition authorities behind the transport.

import { areAIScopeRefsEqual, type AIScopeRef } from '../ai-scope.js';
import type { PermissionTransport } from './transport.js';
import {
  isCanonicalGrantState,
  isCanonicalPermissionScopeFamily,
  isCanonicalPermissionScopeName,
  type GrantRequestAccepted,
  type GrantSpec,
  type GrantStatus,
  type PermissionGrantEvent,
  type PermissionScopeRef,
  type PermissionStatusSnapshot,
  type PermissionUnsubscribe,
} from './types.js';

export class PermissionClientError extends Error {
  readonly code:
    | 'invalid-dependency'
    | 'transport-error'
    | 'non-canonical-response'
    | 'missing-required-field';
  constructor(
    code: PermissionClientError['code'],
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.code = code;
    this.name = 'PermissionClientError';
  }
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function assertScopeRef(scopeRef: AIScopeRef | null | undefined, operation: string): AIScopeRef {
  if (!scopeRef || !normalizedText(scopeRef.kind) || !normalizedText(scopeRef.ownerId)) {
    throw new PermissionClientError('missing-required-field', `${operation}: explicit AIScopeRef is required`);
  }
  if (scopeRef.surfaceId !== undefined && !normalizedText(scopeRef.surfaceId)) {
    throw new PermissionClientError('missing-required-field', `${operation}: AIScopeRef surfaceId must be omitted or non-empty`);
  }
  const kind = scopeRef.kind;
  return scopeRef.surfaceId === undefined
    ? { kind, ownerId: normalizedText(scopeRef.ownerId) }
    : {
      kind,
      ownerId: normalizedText(scopeRef.ownerId),
      surfaceId: normalizedText(scopeRef.surfaceId),
    };
}

function assertGrantId(grantId: string, operation: string): string {
  const normalized = normalizedText(grantId);
  if (!normalized) {
    throw new PermissionClientError('missing-required-field', `${operation}: grantId is required`);
  }
  return normalized;
}

function assertScopeRefMatches(actual: AIScopeRef, expected: AIScopeRef, operation: string): void {
  if (!areAIScopeRefsEqual(actual, expected)) {
    throw new PermissionClientError(
      'non-canonical-response',
      `${operation} response scopeRef does not match requested AIScopeRef`,
    );
  }
}

function assertPermissionScope(permissionScope: PermissionScopeRef | null | undefined, operation: string): PermissionScopeRef {
  if (!permissionScope) {
    throw new PermissionClientError('missing-required-field', `${operation}: permissionScope is required`);
  }
  const appId = normalizedText(permissionScope.appId);
  const scopeFamily = normalizedText(permissionScope.scopeFamily);
  const scopeName = normalizedText(permissionScope.scopeName);
  if (!appId) {
    throw new PermissionClientError('missing-required-field', `${operation}: permissionScope.appId is required`);
  }
  if (!isCanonicalPermissionScopeFamily(scopeFamily)) {
    throw new PermissionClientError(
      'non-canonical-response',
      `${operation}: permissionScope.scopeFamily "${String(permissionScope.scopeFamily)}" is not canonical`,
    );
  }
  if (!scopeName) {
    throw new PermissionClientError('missing-required-field', `${operation}: permissionScope.scopeName is required`);
  }
  if (!isCanonicalPermissionScopeName(scopeName)) {
    throw new PermissionClientError(
      'non-canonical-response',
      `${operation}: permissionScope.scopeName "${String(permissionScope.scopeName)}" is not canonical`,
    );
  }
  const qualifier = normalizedText(permissionScope.qualifier);
  return qualifier
    ? { appId, scopeFamily, scopeName, qualifier }
    : { appId, scopeFamily, scopeName };
}

function assertGrantSpec(grantSpec: GrantSpec | null | undefined, operation: string): GrantSpec {
  if (!grantSpec) {
    throw new PermissionClientError('missing-required-field', `${operation}: grantSpec is required`);
  }
  const permissionScope = assertPermissionScope(grantSpec.permissionScope, operation);
  const reason = normalizedText(grantSpec.reason);
  if (!reason) {
    throw new PermissionClientError('missing-required-field', `${operation}: reason is required`);
  }
  const subjectUserId = normalizedText(grantSpec.subjectUserId);
  return subjectUserId
    ? { permissionScope, subjectUserId, reason }
    : { permissionScope, reason };
}

function assertGrantStatus(
  status: GrantStatus | null | undefined,
  operation: string,
  expectedScopeRef?: AIScopeRef,
): GrantStatus {
  if (!status || !status.grant) {
    throw new PermissionClientError('missing-required-field', `${operation} response missing grant`);
  }
  const scopeRef = assertScopeRef(status.scopeRef, `${operation} response`);
  if (expectedScopeRef) {
    assertScopeRefMatches(scopeRef, expectedScopeRef, operation);
  }
  if (!isCanonicalGrantState(status.state)) {
    throw new PermissionClientError(
      'non-canonical-response',
      `${operation} state "${String(status.state)}" is not canonical`,
    );
  }
  const grantId = normalizedText(status.grant.grantId);
  if (!grantId) {
    throw new PermissionClientError('missing-required-field', `${operation} response.grant missing grantId`);
  }
  const permissionScope = assertPermissionScope(status.grant.permissionScope, `${operation} response.grant`);
  const subjectUserId = normalizedText(status.grant.subjectUserId);
  return {
    ...status,
    scopeRef,
    grant: subjectUserId ? { grantId, permissionScope, subjectUserId } : { grantId, permissionScope },
  };
}

function assertStatusSnapshot(
  snapshot: PermissionStatusSnapshot | null | undefined,
  operation: string,
  expectedScopeRef: AIScopeRef,
): PermissionStatusSnapshot {
  if (!snapshot || !Array.isArray(snapshot.grants)) {
    throw new PermissionClientError('missing-required-field', `${operation} response missing grants`);
  }
  const scopeRef = assertScopeRef(snapshot.scopeRef, `${operation} response`);
  assertScopeRefMatches(scopeRef, expectedScopeRef, operation);
  return {
    ...snapshot,
    scopeRef,
    grants: snapshot.grants.map((grant) => assertGrantStatus(grant, operation, expectedScopeRef)),
  };
}

function assertRequestAccepted(
  response: GrantRequestAccepted | null | undefined,
  operation: string,
  expectedScopeRef: AIScopeRef,
): GrantRequestAccepted {
  if (!response || response.accepted !== true || !normalizedText(response.grantId)) {
    throw new PermissionClientError('missing-required-field', `${operation} response missing accepted or grantId`);
  }
  const scopeRef = assertScopeRef(response.scopeRef, `${operation} response`);
  assertScopeRefMatches(scopeRef, expectedScopeRef, operation);
  if (response.state !== 'pending') {
    throw new PermissionClientError(
      'non-canonical-response',
      `${operation} response state must be 'pending', got "${String(response.state)}"`,
    );
  }
  return { scopeRef, accepted: true, grantId: normalizedText(response.grantId), state: 'pending' };
}

function assertGrantEvent(
  event: PermissionGrantEvent | null | undefined,
  operation: string,
  expectedScopeRef: AIScopeRef,
): PermissionGrantEvent {
  if (!event) {
    throw new PermissionClientError('missing-required-field', `${operation} event is required`);
  }
  const scopeRef = assertScopeRef(event.scopeRef, `${operation} event`);
  assertScopeRefMatches(scopeRef, expectedScopeRef, operation);
  return {
    ...event,
    scopeRef,
    grant: assertGrantStatus(event.grant, `${operation} event`, expectedScopeRef),
  };
}

export class PermissionClient {
  constructor(private readonly transport: PermissionTransport) {
    if (transport === null || transport === undefined) {
      throw new PermissionClientError('invalid-dependency', 'PermissionClient: transport is required');
    }
  }

  async list(scopeRef: AIScopeRef): Promise<readonly GrantStatus[]> {
    const scope = assertScopeRef(scopeRef, 'permission.list');
    let response;
    try {
      response = await this.transport.list(scope);
    } catch (error) {
      throw new PermissionClientError('transport-error', 'permission.list transport error', error);
    }
    if (!Array.isArray(response)) {
      throw new PermissionClientError('missing-required-field', 'permission.list response missing grant list');
    }
    return response.map((status) => assertGrantStatus(status, 'permission.list', scope));
  }

  async get(scopeRef: AIScopeRef, grantId: string): Promise<GrantStatus> {
    const scope = assertScopeRef(scopeRef, 'permission.get');
    const id = assertGrantId(grantId, 'permission.get');
    let response;
    try {
      response = await this.transport.get(scope, id);
    } catch (error) {
      throw new PermissionClientError('transport-error', 'permission.get transport error', error);
    }
    return assertGrantStatus(response, 'permission.get', scope);
  }

  async request(scopeRef: AIScopeRef, grantSpec: GrantSpec): Promise<GrantRequestAccepted> {
    const scope = assertScopeRef(scopeRef, 'permission.request');
    const spec = assertGrantSpec(grantSpec, 'permission.request');
    let response;
    try {
      response = await this.transport.request(scope, spec);
    } catch (error) {
      throw new PermissionClientError('transport-error', 'permission.request transport error', error);
    }
    return assertRequestAccepted(response, 'permission.request', scope);
  }

  async revoke(scopeRef: AIScopeRef, grantId: string): Promise<GrantStatus> {
    const scope = assertScopeRef(scopeRef, 'permission.revoke');
    const id = assertGrantId(grantId, 'permission.revoke');
    let response;
    try {
      response = await this.transport.revoke(scope, id);
    } catch (error) {
      throw new PermissionClientError('transport-error', 'permission.revoke transport error', error);
    }
    return assertGrantStatus(response, 'permission.revoke', scope);
  }

  subscribe(scopeRef: AIScopeRef, callback: (event: PermissionGrantEvent) => void): PermissionUnsubscribe {
    const scope = assertScopeRef(scopeRef, 'permission.subscribe');
    if (typeof callback !== 'function') {
      throw new PermissionClientError('missing-required-field', 'permission.subscribe: callback is required');
    }
    try {
      return this.transport.subscribe(scope, (event) => callback(assertGrantEvent(event, 'permission.subscribe', scope)));
    } catch (error) {
      throw new PermissionClientError('transport-error', 'permission.subscribe transport error', error);
    }
  }

  async status(scopeRef: AIScopeRef): Promise<PermissionStatusSnapshot> {
    const scope = assertScopeRef(scopeRef, 'permission.status');
    let response;
    try {
      response = await this.transport.status(scope);
    } catch (error) {
      throw new PermissionClientError('transport-error', 'permission.status transport error', error);
    }
    return assertStatusSnapshot(response, 'permission.status', scope);
  }
}
