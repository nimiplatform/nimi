// SDK Permission client. Typed status read + grant request transport
// only (Wave 2 admission rule). Wave 5 owns full grant lifecycle.

import type { PermissionTransport } from './transport.js';
import {
  isCanonicalGrantState,
  type GrantRequest,
  type GrantRequestAccepted,
  type GrantStatus,
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
    public readonly cause?: unknown,
  ) {
    super(message);
    this.code = code;
    this.name = 'PermissionClientError';
  }
}

export class PermissionClient {
  constructor(private readonly transport: PermissionTransport) {
    if (transport === null || transport === undefined) {
      throw new PermissionClientError('invalid-dependency', 'PermissionClient: transport is required');
    }
  }

  async getGrantStatus(grantId: string): Promise<GrantStatus> {
    if (typeof grantId !== 'string' || grantId.length === 0) {
      throw new PermissionClientError('missing-required-field', 'getGrantStatus: grantId is required');
    }
    let response;
    try {
      response = await this.transport.getGrantStatus(grantId);
    } catch (error) {
      throw new PermissionClientError('transport-error', 'getGrantStatus transport error', error);
    }
    if (!response || !response.grant) {
      throw new PermissionClientError('missing-required-field', 'getGrantStatus response missing grant');
    }
    if (!isCanonicalGrantState(response.state)) {
      throw new PermissionClientError(
        'non-canonical-response',
        `getGrantStatus state "${String(response.state)}" is not canonical`,
      );
    }
    if (typeof response.grant.grantId !== 'string' || response.grant.grantId.length === 0) {
      throw new PermissionClientError('missing-required-field', 'getGrantStatus response.grant missing grantId');
    }
    return response;
  }

  async requestGrant(request: GrantRequest): Promise<GrantRequestAccepted> {
    if (!request || typeof request.appId !== 'string' || request.appId.length === 0) {
      throw new PermissionClientError('missing-required-field', 'requestGrant: appId is required');
    }
    if (typeof request.scopeKey !== 'string' || request.scopeKey.length === 0) {
      throw new PermissionClientError('missing-required-field', 'requestGrant: scopeKey is required');
    }
    if (typeof request.subjectUserId !== 'string' || request.subjectUserId.length === 0) {
      throw new PermissionClientError('missing-required-field', 'requestGrant: subjectUserId is required');
    }
    if (typeof request.reason !== 'string' || request.reason.length === 0) {
      throw new PermissionClientError('missing-required-field', 'requestGrant: reason is required');
    }
    let response;
    try {
      response = await this.transport.requestGrant(request);
    } catch (error) {
      throw new PermissionClientError('transport-error', 'requestGrant transport error', error);
    }
    if (!response || response.accepted !== true || typeof response.grantId !== 'string' || response.grantId.length === 0) {
      throw new PermissionClientError('missing-required-field', 'requestGrant response missing accepted or grantId');
    }
    if (response.state !== 'requested' && response.state !== 'prompted') {
      throw new PermissionClientError(
        'non-canonical-response',
        `requestGrant response state must be 'requested' or 'prompted', got "${String(response.state)}"`,
      );
    }
    return response;
  }
}
