// SDK Agent Identity Reference client.
//
// Per agent-identity-floor-contract.md, this client only exposes
// reference projection (read-only). It explicitly does NOT expose
// any mint/create/own method; apps cannot promote their local state
// to canonical Nimi-wide agent identity truth.

import type { AgentIdentityTransport } from './transport.js';
import { isCanonicalAgentTier, type AgentReference } from './types.js';

export class AgentIdentityClientError extends Error {
  readonly code:
    | 'invalid-dependency'
    | 'transport-error'
    | 'non-canonical-response'
    | 'missing-required-field'
    | 'app-local-identity-truth';
  constructor(
    code: AgentIdentityClientError['code'],
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.code = code;
    this.name = 'AgentIdentityClientError';
  }
}

const FORBIDDEN_RESPONSE_FIELDS: readonly string[] = [
  'appLocalIdentity',
  'appOwnedIdentity',
  'localCanonicalIdentity',
];

export class AgentIdentityClient {
  constructor(private readonly transport: AgentIdentityTransport) {
    if (transport === null || transport === undefined) {
      throw new AgentIdentityClientError('invalid-dependency', 'AgentIdentityClient: transport is required');
    }
  }

  async getAgentReference(refId: string): Promise<AgentReference> {
    if (typeof refId !== 'string' || refId.length === 0) {
      throw new AgentIdentityClientError('missing-required-field', 'getAgentReference: refId is required');
    }
    let response;
    try {
      response = await this.transport.getAgentReference(refId);
    } catch (error) {
      throw new AgentIdentityClientError('transport-error', 'getAgentReference transport error', error);
    }
    validateReference(response);
    return response;
  }

  async listAgentReferencesForUser(subjectUserId: string): Promise<readonly AgentReference[]> {
    if (typeof subjectUserId !== 'string' || subjectUserId.length === 0) {
      throw new AgentIdentityClientError('missing-required-field', 'listAgentReferencesForUser: subjectUserId is required');
    }
    let response;
    try {
      response = await this.transport.listAgentReferencesForUser(subjectUserId);
    } catch (error) {
      throw new AgentIdentityClientError('transport-error', 'listAgentReferencesForUser transport error', error);
    }
    if (!Array.isArray(response)) {
      throw new AgentIdentityClientError('missing-required-field', 'listAgentReferencesForUser response is not an array');
    }
    for (const ref of response) {
      validateReference(ref);
    }
    return response;
  }
}

function validateReference(ref: AgentReference | null | undefined): void {
  if (!ref) {
    throw new AgentIdentityClientError('missing-required-field', 'agent reference is null/undefined');
  }
  if (typeof ref.agentRefId !== 'string' || ref.agentRefId.length === 0) {
    throw new AgentIdentityClientError('missing-required-field', 'agent reference missing agentRefId');
  }
  if (typeof ref.subjectUserId !== 'string' || ref.subjectUserId.length === 0) {
    throw new AgentIdentityClientError('missing-required-field', 'agent reference missing subjectUserId');
  }
  if (!isCanonicalAgentTier(ref.tier)) {
    throw new AgentIdentityClientError(
      'non-canonical-response',
      `agent reference tier "${String(ref.tier)}" is not canonical`,
    );
  }
  for (const forbidden of FORBIDDEN_RESPONSE_FIELDS) {
    if (forbidden in (ref as unknown as Record<string, unknown>)) {
      throw new AgentIdentityClientError(
        'app-local-identity-truth',
        `agent reference contains forbidden app-local identity field "${forbidden}"`,
      );
    }
  }
}
