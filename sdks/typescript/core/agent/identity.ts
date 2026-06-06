import { createNimiError } from '../../types';

export type AgentIdentityTier = 'account-scoped' | 'family-scoped' | 'persona-scoped';

export interface AgentReference {
  readonly agentRefId: string;
  readonly tier: AgentIdentityTier;
  readonly subjectUserId: string;
  readonly displayHint?: string;
}

export interface AgentIdentityTransport {
  getAgentReference(refId: string): Promise<AgentReference>;
  listAgentReferencesForUser(subjectUserId: string): Promise<readonly AgentReference[]>;
}

export type AgentIdentityProjectionErrorCode =
  | 'SDK_AGENT_IDENTITY_INVALID_DEPENDENCY'
  | 'SDK_AGENT_IDENTITY_TRANSPORT_ERROR'
  | 'SDK_AGENT_IDENTITY_NON_CANONICAL_RESPONSE'
  | 'SDK_AGENT_IDENTITY_MISSING_REQUIRED_FIELD'
  | 'SDK_AGENT_IDENTITY_APP_LOCAL_TRUTH';

export const CANONICAL_AGENT_TIERS: readonly AgentIdentityTier[] = [
  'account-scoped',
  'family-scoped',
  'persona-scoped',
];

const FORBIDDEN_RESPONSE_FIELDS: readonly string[] = [
  'appLocalIdentity',
  'appOwnedIdentity',
  'localCanonicalIdentity',
];

export function isCanonicalAgentTier(value: unknown): value is AgentIdentityTier {
  return typeof value === 'string' && CANONICAL_AGENT_TIERS.includes(value as AgentIdentityTier);
}

export class AgentIdentityClient {
  constructor(private readonly transport: AgentIdentityTransport) {
    if (!isAgentIdentityTransport(transport)) {
      agentIdentityError(
        'SDK_AGENT_IDENTITY_INVALID_DEPENDENCY',
        'AgentIdentityClient requires an explicit read-only projection transport',
        'provide_agent_identity_transport',
      );
    }
  }

  async getAgentReference(refId: string): Promise<AgentReference> {
    if (!normalizeText(refId)) {
      agentIdentityError(
        'SDK_AGENT_IDENTITY_MISSING_REQUIRED_FIELD',
        'getAgentReference requires refId',
        'provide_agent_reference_id',
      );
    }
    let response: AgentReference;
    try {
      response = await this.transport.getAgentReference(refId);
    } catch (error) {
      agentIdentityError(
        'SDK_AGENT_IDENTITY_TRANSPORT_ERROR',
        'getAgentReference transport error',
        'check_agent_identity_transport',
        error,
      );
    }
    validateAgentReference(response);
    return response;
  }

  async listAgentReferencesForUser(subjectUserId: string): Promise<readonly AgentReference[]> {
    if (!normalizeText(subjectUserId)) {
      agentIdentityError(
        'SDK_AGENT_IDENTITY_MISSING_REQUIRED_FIELD',
        'listAgentReferencesForUser requires subjectUserId',
        'provide_subject_user_id',
      );
    }
    let response: readonly AgentReference[];
    try {
      response = await this.transport.listAgentReferencesForUser(subjectUserId);
    } catch (error) {
      agentIdentityError(
        'SDK_AGENT_IDENTITY_TRANSPORT_ERROR',
        'listAgentReferencesForUser transport error',
        'check_agent_identity_transport',
        error,
      );
    }
    if (!Array.isArray(response)) {
      agentIdentityError(
        'SDK_AGENT_IDENTITY_MISSING_REQUIRED_FIELD',
        'listAgentReferencesForUser response must be an array',
        'fix_agent_identity_transport_response',
      );
    }
    for (const reference of response) {
      validateAgentReference(reference);
    }
    return response;
  }
}

export function createAgentIdentityProjectionClient(transport: AgentIdentityTransport): AgentIdentityClient {
  return new AgentIdentityClient(transport);
}

function validateAgentReference(reference: AgentReference | null | undefined): void {
  if (!reference || typeof reference !== 'object') {
    agentIdentityError(
      'SDK_AGENT_IDENTITY_MISSING_REQUIRED_FIELD',
      'agent reference is missing',
      'fix_agent_identity_transport_response',
    );
  }
  if (!normalizeText(reference.agentRefId)) {
    agentIdentityError(
      'SDK_AGENT_IDENTITY_MISSING_REQUIRED_FIELD',
      'agent reference missing agentRefId',
      'fix_agent_identity_transport_response',
    );
  }
  if (!normalizeText(reference.subjectUserId)) {
    agentIdentityError(
      'SDK_AGENT_IDENTITY_MISSING_REQUIRED_FIELD',
      'agent reference missing subjectUserId',
      'fix_agent_identity_transport_response',
    );
  }
  if (!isCanonicalAgentTier(reference.tier)) {
    agentIdentityError(
      'SDK_AGENT_IDENTITY_NON_CANONICAL_RESPONSE',
      `agent reference tier "${String(reference.tier)}" is not canonical`,
      'use_realm_projected_agent_identity',
    );
  }
  for (const forbidden of FORBIDDEN_RESPONSE_FIELDS) {
    if (forbidden in (reference as unknown as Record<string, unknown>)) {
      agentIdentityError(
        'SDK_AGENT_IDENTITY_APP_LOCAL_TRUTH',
        `agent reference contains forbidden app-local identity field "${forbidden}"`,
        'remove_app_local_agent_identity_truth',
      );
    }
  }
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isAgentIdentityTransport(value: unknown): value is AgentIdentityTransport {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.getAgentReference === 'function'
    && typeof candidate.listAgentReferencesForUser === 'function';
}

function agentIdentityError(
  code: AgentIdentityProjectionErrorCode,
  message: string,
  actionHint: string,
  cause?: unknown,
): never {
  throw createNimiError({
    message,
    code,
    reasonCode: code,
    actionHint,
    source: 'sdk',
    details: cause === undefined ? undefined : { cause: String(cause instanceof Error ? cause.message : cause) },
  });
}
