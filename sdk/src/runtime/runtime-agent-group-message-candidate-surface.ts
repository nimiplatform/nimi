import { ReasonCode } from '../types/index.js';
import { createNimiError } from '../core/errors.js';
import {
  type RealmGroupMessageCandidateCommitHandle,
  type RealmGroupMessageCandidateEvidence,
  RealmGroupMessageCandidateCommitDisposition,
} from './generated/runtime/v1/agent_group_message_candidate.js';
import { buildRuntimeAgentRequestContext, buildRuntimeLocalAgentRef } from './local-agent-identity.js';
import { createRuntimeProtectedScopeHelper } from './protected-access.js';
import { normalizeRuntimeAgentText } from './runtime-agent-inspect-projection.js';
import { toIsoFromTimestamp } from './runtime-value-utils.js';
import type { RuntimeCallOptions, RuntimeTransportConfig } from './types.js';
import type {
  RuntimeAgentClient,
  RuntimeAppAuthClient,
  RuntimeAuthClient,
} from './types-client-interfaces.js';

type Awaitable<T> = T | Promise<T>;

const CANDIDATE_KIND = 'REALM_GROUP_MESSAGE_CANDIDATE';
const CREATE_CANDIDATE_SCOPE = 'runtime.agent.create_realm_group_message_candidate';
const READ_CANDIDATE_EVIDENCE_SCOPE = 'runtime.agent.get_realm_group_message_candidate_evidence';

export type RuntimeRealmGroupAgentSlotIdentity = {
  realmGroupAgentSlotId: string;
  ownerUserId: string;
  realmAgentId: string;
  localAgentRef: string;
};

export type RuntimeRealmGroupAgentSlotIdentityInput = {
  participantType?: unknown;
  currentUserId: unknown;
  realmGroupAgentSlotId: unknown;
  ownerUserId: unknown;
  realmAgentId: unknown;
  localAgentRef: unknown;
};

export type RuntimeRealmGroupMessageCandidateCommitPayload = {
  candidateId: string;
  candidateKind: 'REALM_GROUP_MESSAGE_CANDIDATE';
  candidateEvidenceRef: string;
  evidenceHash: string;
  runtimeTraceRef: string;
  expectedRealmGroupAgentSlotId: string;
  expectedLocalAgentRef: string;
  triggerRef: string;
  outputCandidateRef: string;
  auditLineageRef: string;
  policyVerdictRef: string;
  createdAt: string;
  expiresAt: string;
  commitDisposition: 'MESSAGE_CANDIDATE' | 'REFUSAL_CANDIDATE';
  messageType?: 'TEXT';
  body?: string;
  bodyHash?: string;
  refusalCode?: string;
  refusalReason?: string;
  refusalHash?: string;
  idempotencyKey: string;
  clientCorrelationId: string;
};

export type RuntimeRealmGroupMessageCandidateCommitInput =
  RuntimeRealmGroupAgentSlotIdentityInput & {
    realmGroupThreadId: unknown;
    triggerMessageId: unknown;
    idempotencyKey: unknown;
    replyTargetRef?: unknown;
    membershipSnapshotRef?: unknown;
    readCursorRef?: unknown;
    roomOrchestrationRef?: unknown;
    contextRefs?: Record<string, unknown>;
  };

export type RuntimeRealmGroupMessageCandidateCommitResult = {
  slot: RuntimeRealmGroupAgentSlotIdentity;
  triggerRef: string;
  candidate: RealmGroupMessageCandidateCommitHandle;
  evidence: RealmGroupMessageCandidateEvidence;
  realmCommitPayload: RuntimeRealmGroupMessageCandidateCommitPayload;
};

export type RuntimeRealmGroupMessageCandidateSurface = {
  createCommitPayload(input: RuntimeRealmGroupMessageCandidateCommitInput): Promise<RuntimeRealmGroupMessageCandidateCommitResult>;
};

export type HostRuntimeRealmGroupMessageCandidateClient = {
  readonly appId: string;
  readonly transport?: RuntimeTransportConfig;
  readonly auth: Pick<RuntimeAuthClient, 'registerApp'>;
  readonly appAuth: Pick<RuntimeAppAuthClient, 'authorizeExternalPrincipal'>;
  readonly agent: Pick<RuntimeAgentClient, 'createRealmGroupMessageCandidate' | 'getRealmGroupMessageCandidateEvidence'>;
};

export type HostRuntimeRealmGroupMessageCandidateSurfaceOptions = {
  getRuntime: () => HostRuntimeRealmGroupMessageCandidateClient;
  getSubjectUserId: () => Awaitable<string | undefined>;
  withScopes?: <T>(
    scopes: readonly string[],
    operation: (options: RuntimeCallOptions) => Promise<T>,
  ) => Promise<T>;
};

function inputError(message: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode: ReasonCode.AI_INPUT_INVALID,
    actionHint,
    source: 'sdk',
  });
}

function requireText(value: unknown, message: string, actionHint: string): string {
  const normalized = normalizeRuntimeAgentText(value);
  if (!normalized) {
    inputError(message, actionHint);
  }
  return normalized;
}

function optionalText(value: unknown): string {
  return normalizeRuntimeAgentText(value);
}

export function resolveRuntimeRealmGroupAgentSlotIdentity(
  input: RuntimeRealmGroupAgentSlotIdentityInput,
): RuntimeRealmGroupAgentSlotIdentity {
  const participantType = optionalText(input.participantType);
  if (participantType && participantType !== 'agent') {
    inputError(
      'Realm group agent candidate handoff requires a Realm projected agent slot',
      'provide_realm_group_agent_slot',
    );
  }
  const currentUserId = requireText(
    input.currentUserId,
    'Realm group agent candidate handoff requires authenticated current user id',
    'authenticate_realm_group_agent_owner',
  );
  const realmGroupAgentSlotId = requireText(
    input.realmGroupAgentSlotId,
    'Realm group agent candidate handoff requires Realm group agent slot id',
    'provide_realm_group_agent_slot',
  );
  const ownerUserId = requireText(
    input.ownerUserId,
    'Realm group agent candidate handoff requires owner user id',
    'provide_realm_group_agent_slot_owner',
  );
  const realmAgentId = requireText(
    input.realmAgentId,
    'Realm group agent candidate handoff requires Realm agent id',
    'provide_realm_group_agent_slot_agent',
  );
  const localAgentRef = requireText(
    input.localAgentRef,
    'Realm group agent candidate handoff requires local agent ref',
    'provide_realm_group_agent_local_ref',
  );
  if (ownerUserId !== currentUserId) {
    inputError(
      'Realm group agent candidate handoff requires the current user to own the local agent slot',
      'use_owned_realm_group_agent_slot',
    );
  }
  const expectedLocalAgentRef = buildRuntimeLocalAgentRef({ ownerUserId, realmAgentId });
  if (localAgentRef !== expectedLocalAgentRef) {
    inputError(
      'Realm group agent candidate handoff local agent ref does not match Realm slot identity',
      'repair_realm_group_agent_slot_projection',
    );
  }
  return {
    realmGroupAgentSlotId,
    ownerUserId,
    realmAgentId,
    localAgentRef,
  };
}

function defaultContextRefs(input: {
  realmGroupThreadId: string;
  realmGroupAgentSlotId: string;
}): Record<string, string> {
  return {
    'realm.group.thread.snapshot': `realm-context://group-chats/${input.realmGroupThreadId}/thread/current`,
    'realm.group.agent_slot.snapshot': `realm-context://group-agent-slots/${input.realmGroupAgentSlotId}/current`,
    'realm.group.recent_messages.snapshot': `realm-context://group-chats/${input.realmGroupThreadId}/recent-messages/current`,
    'realm.group.policy.snapshot': `realm-context://group-chats/${input.realmGroupThreadId}/policy/current`,
  };
}

function normalizeContextRefs(
  overrides: Record<string, unknown> | undefined,
  defaults: Record<string, string>,
): Record<string, string> {
  const normalized = { ...defaults };
  if (!overrides) {
    return normalized;
  }
  for (const [key, value] of Object.entries(overrides)) {
    const normalizedKey = optionalText(key);
    const normalizedValue = optionalText(value);
    if (normalizedKey && normalizedValue) {
      normalized[normalizedKey] = normalizedValue;
    }
  }
  return normalized;
}

function requireCandidateHandle(
  candidate: RealmGroupMessageCandidateCommitHandle | undefined,
): RealmGroupMessageCandidateCommitHandle {
  if (!candidate) {
    throw createNimiError({
      message: 'Runtime did not return a Realm group message candidate handle',
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_realm_group_message_candidate_handle',
      source: 'sdk',
    });
  }
  if (candidate.candidateKind !== CANDIDATE_KIND) {
    inputError(
      'Runtime returned an unexpected Realm group message candidate kind',
      'check_realm_group_message_candidate_kind',
    );
  }
  return candidate;
}

function requireCandidateEvidence(
  evidence: RealmGroupMessageCandidateEvidence | undefined,
): RealmGroupMessageCandidateEvidence {
  if (!evidence) {
    throw createNimiError({
      message: 'Runtime did not return Realm group message candidate evidence',
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'check_realm_group_message_candidate_evidence',
      source: 'sdk',
    });
  }
  if (evidence.candidateKind !== CANDIDATE_KIND) {
    inputError(
      'Runtime returned an unexpected Realm group message candidate evidence kind',
      'check_realm_group_message_candidate_evidence_kind',
    );
  }
  return evidence;
}

function assertCandidateHandleMatchesExpectedSlot(input: {
  candidate: RealmGroupMessageCandidateCommitHandle;
  slot: RuntimeRealmGroupAgentSlotIdentity;
  triggerRef: string;
  realmGroupThreadId: string;
}): void {
  if (
    input.candidate.realmGroupThreadId !== input.realmGroupThreadId
    || input.candidate.realmGroupAgentSlotId !== input.slot.realmGroupAgentSlotId
    || input.candidate.localAgentRef !== input.slot.localAgentRef
    || input.candidate.triggerRef !== input.triggerRef
  ) {
    inputError(
      'Runtime Realm group message candidate handle does not match expected Realm slot handoff',
      'check_realm_group_message_candidate_handle',
    );
  }
}

function assertCandidateEvidenceMatchesHandle(input: {
  candidate: RealmGroupMessageCandidateCommitHandle;
  evidence: RealmGroupMessageCandidateEvidence;
  slot: RuntimeRealmGroupAgentSlotIdentity;
  triggerRef: string;
  realmGroupThreadId: string;
}): void {
  if (
    input.evidence.candidateId !== input.candidate.candidateId
    || input.evidence.evidenceHash !== input.candidate.evidenceHash
    || input.evidence.runtimeTraceRef !== input.candidate.runtimeTraceRef
    || input.evidence.realmGroupThreadId !== input.realmGroupThreadId
    || input.evidence.realmGroupAgentSlotId !== input.slot.realmGroupAgentSlotId
    || input.evidence.localAgentRef !== input.slot.localAgentRef
    || input.evidence.triggerRef !== input.triggerRef
  ) {
    inputError(
      'Runtime Realm group message candidate evidence does not match the candidate handle',
      'check_realm_group_message_candidate_evidence',
    );
  }
}

function mapCommitDisposition(
  value: RealmGroupMessageCandidateCommitDisposition,
): RuntimeRealmGroupMessageCandidateCommitPayload['commitDisposition'] {
  if (value === RealmGroupMessageCandidateCommitDisposition.MESSAGE_CANDIDATE) {
    return 'MESSAGE_CANDIDATE';
  }
  if (value === RealmGroupMessageCandidateCommitDisposition.REFUSAL_CANDIDATE) {
    return 'REFUSAL_CANDIDATE';
  }
  inputError(
    'Runtime Realm group message candidate evidence has unsupported commit disposition',
    'check_realm_group_message_candidate_disposition',
  );
}

function requireIsoTimestamp(value: unknown, fieldName: string): string {
  const iso = toIsoFromTimestamp(value);
  if (!iso) {
    inputError(
      `Runtime Realm group message candidate evidence missing ${fieldName}`,
      'check_realm_group_message_candidate_timestamps',
    );
  }
  return iso;
}

function buildRealmCommitPayload(input: {
  candidate: RealmGroupMessageCandidateCommitHandle;
  evidence: RealmGroupMessageCandidateEvidence;
  slot: RuntimeRealmGroupAgentSlotIdentity;
  triggerRef: string;
  idempotencyKey: string;
}): RuntimeRealmGroupMessageCandidateCommitPayload {
  return {
    candidateId: input.candidate.candidateId,
    candidateKind: CANDIDATE_KIND,
    candidateEvidenceRef: input.candidate.candidateEvidenceRef,
    evidenceHash: input.candidate.evidenceHash,
    runtimeTraceRef: input.candidate.runtimeTraceRef,
    expectedRealmGroupAgentSlotId: input.slot.realmGroupAgentSlotId,
    expectedLocalAgentRef: input.slot.localAgentRef,
    triggerRef: input.triggerRef,
    outputCandidateRef: input.evidence.outputCandidateRef,
    auditLineageRef: input.evidence.auditLineageRef,
    policyVerdictRef: input.evidence.policyVerdictRef,
    createdAt: requireIsoTimestamp(input.evidence.createdAt, 'createdAt'),
    expiresAt: requireIsoTimestamp(input.evidence.expiresAt, 'expiresAt'),
    commitDisposition: mapCommitDisposition(input.evidence.commitDisposition),
    ...(input.evidence.messageType === 'TEXT' ? { messageType: 'TEXT' } : {}),
    ...(input.evidence.body ? { body: input.evidence.body } : {}),
    ...(input.evidence.bodyHash ? { bodyHash: input.evidence.bodyHash } : {}),
    ...(input.evidence.refusalCode ? { refusalCode: input.evidence.refusalCode } : {}),
    ...(input.evidence.refusalReason ? { refusalReason: input.evidence.refusalReason } : {}),
    ...(input.evidence.refusalHash ? { refusalHash: input.evidence.refusalHash } : {}),
    idempotencyKey: input.idempotencyKey,
    clientCorrelationId: input.idempotencyKey,
  };
}

export function createHostRuntimeRealmGroupMessageCandidateSurface(
  options: HostRuntimeRealmGroupMessageCandidateSurfaceOptions,
): RuntimeRealmGroupMessageCandidateSurface {
  let protectedAccess: ReturnType<typeof createRuntimeProtectedScopeHelper> | null = null;

  const resolveSubjectUserId = async (): Promise<string> => (
    requireText(
      await options.getSubjectUserId(),
      'Realm group message candidate surface requires authenticated subject user id',
      'authenticate_realm_group_agent_owner',
    )
  );

  const getProtectedAccess = () => {
    if (protectedAccess) {
      return protectedAccess;
    }
    protectedAccess = createRuntimeProtectedScopeHelper({
      runtime: options.getRuntime(),
      getSubjectUserId: async () => resolveSubjectUserId(),
    });
    return protectedAccess;
  };

  const withRuntimeScope = <T>(
    scope: string,
    operation: (callOptions: RuntimeCallOptions) => Promise<T>,
  ) => (
    options.withScopes
      ? options.withScopes([scope], operation)
      : getProtectedAccess().withScopes([scope], operation)
  );

  return {
    async createCommitPayload(input) {
      const runtime = options.getRuntime();
      const subjectUserId = await resolveSubjectUserId();
      const slot = resolveRuntimeRealmGroupAgentSlotIdentity({
        participantType: input.participantType,
        currentUserId: input.currentUserId,
        realmGroupAgentSlotId: input.realmGroupAgentSlotId,
        ownerUserId: input.ownerUserId,
        realmAgentId: input.realmAgentId,
        localAgentRef: input.localAgentRef,
      });
      if (subjectUserId !== slot.ownerUserId) {
        inputError(
          'Realm group agent candidate subject user must match the slot owner',
          'authenticate_realm_group_agent_owner',
        );
      }
      const realmGroupThreadId = requireText(
        input.realmGroupThreadId,
        'Realm group message candidate handoff requires Realm group thread id',
        'provide_realm_group_thread',
      );
      const triggerMessageId = requireText(
        input.triggerMessageId,
        'Realm group message candidate handoff requires a committed Realm trigger message',
        'provide_realm_group_trigger_message',
      );
      const idempotencyKey = requireText(
        input.idempotencyKey,
        'Realm group message candidate handoff requires idempotency key',
        'provide_realm_group_candidate_idempotency_key',
      );
      const triggerRef = `realm://group-chats/${realmGroupThreadId}/messages/${triggerMessageId}`;
      const context = buildRuntimeAgentRequestContext({
        runtimeAppId: runtime.appId,
        subjectUserId: slot.ownerUserId,
        localAgentRef: slot.localAgentRef,
      });
      const candidateResponse = await withRuntimeScope(
        CREATE_CANDIDATE_SCOPE,
        (callOptions) => runtime.agent.createRealmGroupMessageCandidate({
          context,
          realmGroupThreadId,
          realmGroupAgentSlotId: slot.realmGroupAgentSlotId,
          ownerUserId: slot.ownerUserId,
          realmAgentId: slot.realmAgentId,
          localAgentRef: slot.localAgentRef,
          triggerRef,
          membershipSnapshotRef: optionalText(input.membershipSnapshotRef)
            || `realm://group-chats/${realmGroupThreadId}/membership/current`,
          readCursorRef: optionalText(input.readCursorRef)
            || `realm://group-chats/${realmGroupThreadId}/read-cursors/${slot.ownerUserId}`,
          replyTargetRef: optionalText(input.replyTargetRef),
          roomOrchestrationRef: optionalText(input.roomOrchestrationRef)
            || `realm://group-chats/${realmGroupThreadId}/orchestration/current`,
          idempotencyKey,
          contextRefs: normalizeContextRefs(
            input.contextRefs,
            defaultContextRefs({
              realmGroupThreadId,
              realmGroupAgentSlotId: slot.realmGroupAgentSlotId,
            }),
          ),
        }, callOptions),
      );
      const candidate = requireCandidateHandle(candidateResponse.candidate);
      assertCandidateHandleMatchesExpectedSlot({
        candidate,
        slot,
        triggerRef,
        realmGroupThreadId,
      });
      const evidenceResponse = await withRuntimeScope(
        READ_CANDIDATE_EVIDENCE_SCOPE,
        (callOptions) => runtime.agent.getRealmGroupMessageCandidateEvidence({
          context,
          candidateId: candidate.candidateId,
          candidateKind: candidate.candidateKind,
          candidateEvidenceRef: candidate.candidateEvidenceRef,
          evidenceHash: candidate.evidenceHash,
          runtimeTraceRef: candidate.runtimeTraceRef,
          expectedRealmGroupAgentSlotId: slot.realmGroupAgentSlotId,
          expectedLocalAgentRef: slot.localAgentRef,
          triggerRef,
          targetRealmGroupThreadId: realmGroupThreadId,
        }, callOptions),
      );
      const evidence = requireCandidateEvidence(evidenceResponse.evidence);
      assertCandidateEvidenceMatchesHandle({
        candidate,
        evidence,
        slot,
        triggerRef,
        realmGroupThreadId,
      });
      return {
        slot,
        triggerRef,
        candidate,
        evidence,
        realmCommitPayload: buildRealmCommitPayload({
          candidate,
          evidence,
          slot,
          triggerRef,
          idempotencyKey,
        }),
      };
    },
  };
}
