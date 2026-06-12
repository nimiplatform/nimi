import {
  RealmGroupMessageCandidateCommitDisposition,
  type CreateRealmGroupMessageCandidateRequest,
  type CreateRealmGroupMessageCandidateResponse,
  type GetRealmGroupMessageCandidateEvidenceRequest,
  type GetRealmGroupMessageCandidateEvidenceResponse,
  type RealmGroupMessageCandidateCommitHandle,
  type RealmGroupMessageCandidateEvidence,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import { createNimiError, ReasonCode } from '../types';
import { buildRuntimeAgentRequestContext, buildRuntimeLocalAgentRef } from './agent-local-identity';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAppAuthClient,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import { normalizeNimiRuntimeAgentText, toNimiRuntimeIsoFromTimestamp } from './runtime-agent-values';

const CANDIDATE_KIND = 'REALM_GROUP_MESSAGE_CANDIDATE';
const CREATE_CANDIDATE_SCOPE = 'runtime.agent.create_realm_group_message_candidate';
const READ_CANDIDATE_EVIDENCE_SCOPE = 'runtime.agent.get_realm_group_message_candidate_evidence';

export interface NimiRuntimeRealmGroupAgentSlotIdentity {
  readonly realmGroupAgentSlotId: string;
  readonly ownerUserId: string;
  readonly realmAgentId: string;
  readonly localAgentRef: string;
}

export interface NimiRuntimeRealmGroupAgentSlotIdentityInput {
  readonly participantType?: unknown;
  readonly currentUserId: unknown;
  readonly realmGroupAgentSlotId: unknown;
  readonly ownerUserId: unknown;
  readonly realmAgentId: unknown;
  readonly localAgentRef: unknown;
}

export interface NimiRuntimeRealmGroupMessageCandidateCommitPayload {
  readonly candidateId: string;
  readonly candidateKind: 'REALM_GROUP_MESSAGE_CANDIDATE';
  readonly candidateEvidenceRef: string;
  readonly evidenceHash: string;
  readonly runtimeTraceRef: string;
  readonly expectedRealmGroupAgentSlotId: string;
  readonly expectedLocalAgentRef: string;
  readonly triggerRef: string;
  readonly outputCandidateRef: string;
  readonly auditLineageRef: string;
  readonly policyVerdictRef: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly commitDisposition: 'MESSAGE_CANDIDATE' | 'REFUSAL_CANDIDATE';
  readonly messageType?: 'TEXT';
  readonly body?: string;
  readonly bodyHash?: string;
  readonly refusalCode?: string;
  readonly refusalReason?: string;
  readonly refusalHash?: string;
  readonly idempotencyKey: string;
  readonly clientCorrelationId: string;
}

export type NimiRuntimeRealmGroupMessageCandidateCommitInput =
  NimiRuntimeRealmGroupAgentSlotIdentityInput & {
    readonly realmGroupThreadId: unknown;
    readonly triggerMessageId: unknown;
    readonly idempotencyKey: unknown;
    readonly replyTargetRef?: unknown;
    readonly membershipSnapshotRef?: unknown;
    readonly readCursorRef?: unknown;
    readonly roomOrchestrationRef?: unknown;
    readonly contextRefs?: never;
  };

export interface NimiRuntimeRealmGroupMessageCandidateCommitResult {
  readonly slot: NimiRuntimeRealmGroupAgentSlotIdentity;
  readonly triggerRef: string;
  readonly candidate: RealmGroupMessageCandidateCommitHandle;
  readonly evidence: RealmGroupMessageCandidateEvidence;
  readonly realmCommitPayload: NimiRuntimeRealmGroupMessageCandidateCommitPayload;
}

export interface NimiRuntimeRealmGroupMessageCandidateSurface {
  createCommitPayload(
    input: NimiRuntimeRealmGroupMessageCandidateCommitInput,
  ): Promise<NimiRuntimeRealmGroupMessageCandidateCommitResult>;
}

export interface NimiHostRuntimeRealmGroupMessageCandidateClient {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly appAuth: NimiRuntimeAgentAppAuthClient;
  readonly agent: {
    createRealmGroupMessageCandidate(
      request: CreateRealmGroupMessageCandidateRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<CreateRealmGroupMessageCandidateResponse>;
    getRealmGroupMessageCandidateEvidence(
      request: GetRealmGroupMessageCandidateEvidenceRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<GetRealmGroupMessageCandidateEvidenceResponse>;
  };
}

export interface NimiHostRuntimeRealmGroupMessageCandidateSurfaceOptions {
  readonly getRuntime: () => NimiHostRuntimeRealmGroupMessageCandidateClient;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

function inputError(message: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode: ReasonCode.AI_INPUT_INVALID,
    actionHint,
    source: 'sdk',
  });
}

function requireText(value: unknown, message: string, actionHint: string): string {
  const normalized = normalizeNimiRuntimeAgentText(value);
  if (!normalized) {
    inputError(message, actionHint);
  }
  return normalized;
}

function optionalText(value: unknown): string {
  return normalizeNimiRuntimeAgentText(value);
}

export function resolveNimiRuntimeRealmGroupAgentSlotIdentity(
  input: NimiRuntimeRealmGroupAgentSlotIdentityInput,
): NimiRuntimeRealmGroupAgentSlotIdentity {
  const participantType = optionalText(input.participantType);
  if (participantType && participantType !== 'agent') {
    inputError('Realm group agent candidate handoff requires a Realm projected agent slot', 'provide_realm_group_agent_slot');
  }
  const currentUserId = requireText(input.currentUserId, 'Realm group agent candidate handoff requires authenticated current user id', 'authenticate_realm_group_agent_owner');
  const realmGroupAgentSlotId = requireText(input.realmGroupAgentSlotId, 'Realm group agent candidate handoff requires Realm group agent slot id', 'provide_realm_group_agent_slot');
  const ownerUserId = requireText(input.ownerUserId, 'Realm group agent candidate handoff requires owner user id', 'provide_realm_group_agent_slot_owner');
  const realmAgentId = requireText(input.realmAgentId, 'Realm group agent candidate handoff requires Realm agent id', 'provide_realm_group_agent_slot_agent');
  const localAgentRef = requireText(input.localAgentRef, 'Realm group agent candidate handoff requires local agent ref', 'provide_realm_group_agent_local_ref');
  if (ownerUserId !== currentUserId) {
    inputError('Realm group agent candidate handoff requires the current user to own the local agent slot', 'use_owned_realm_group_agent_slot');
  }
  const expectedLocalAgentRef = buildRuntimeLocalAgentRef({ ownerUserId, realmAgentId });
  if (localAgentRef !== expectedLocalAgentRef) {
    inputError('Realm group agent candidate handoff local agent ref does not match Realm slot identity', 'repair_realm_group_agent_slot_projection');
  }
  return {
    realmGroupAgentSlotId,
    ownerUserId,
    realmAgentId,
    localAgentRef,
  };
}

function defaultContextRefs(input: {
  readonly realmGroupThreadId: string;
  readonly realmGroupAgentSlotId: string;
}): Record<string, string> {
  return {
    'realm.group.thread.snapshot': `realm-context://group-chats/${input.realmGroupThreadId}/thread/current`,
    'realm.group.agent_slot.snapshot': `realm-context://group-agent-slots/${input.realmGroupAgentSlotId}/current`,
    'realm.group.recent_messages.snapshot': `realm-context://group-chats/${input.realmGroupThreadId}/recent-messages/current`,
    'realm.group.policy.snapshot': `realm-context://group-chats/${input.realmGroupThreadId}/policy/current`,
  };
}

function requireCandidateHandle(
  candidate: RealmGroupMessageCandidateCommitHandle | undefined,
): RealmGroupMessageCandidateCommitHandle {
  if (!candidate || candidate.candidateKind !== CANDIDATE_KIND) {
    inputError('Runtime did not return a valid Realm group message candidate handle', 'check_realm_group_message_candidate_handle');
  }
  return candidate;
}

function requireCandidateEvidence(
  evidence: RealmGroupMessageCandidateEvidence | undefined,
): RealmGroupMessageCandidateEvidence {
  if (!evidence || evidence.candidateKind !== CANDIDATE_KIND) {
    inputError('Runtime did not return valid Realm group message candidate evidence', 'check_realm_group_message_candidate_evidence');
  }
  return evidence;
}

function assertCandidateHandleMatchesExpectedSlot(input: {
  readonly candidate: RealmGroupMessageCandidateCommitHandle;
  readonly slot: NimiRuntimeRealmGroupAgentSlotIdentity;
  readonly triggerRef: string;
  readonly realmGroupThreadId: string;
}): void {
  if (
    input.candidate.realmGroupThreadId !== input.realmGroupThreadId
    || input.candidate.realmGroupAgentSlotId !== input.slot.realmGroupAgentSlotId
    || input.candidate.localAgentRef !== input.slot.localAgentRef
    || input.candidate.triggerRef !== input.triggerRef
  ) {
    inputError('Runtime Realm group message candidate handle does not match expected Realm slot handoff', 'check_realm_group_message_candidate_handle');
  }
}

function assertCandidateEvidenceMatchesHandle(input: {
  readonly candidate: RealmGroupMessageCandidateCommitHandle;
  readonly evidence: RealmGroupMessageCandidateEvidence;
  readonly slot: NimiRuntimeRealmGroupAgentSlotIdentity;
  readonly triggerRef: string;
  readonly realmGroupThreadId: string;
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
    inputError('Runtime Realm group message candidate evidence does not match the candidate handle', 'check_realm_group_message_candidate_evidence');
  }
}

function mapCommitDisposition(
  value: RealmGroupMessageCandidateCommitDisposition,
): NimiRuntimeRealmGroupMessageCandidateCommitPayload['commitDisposition'] {
  if (value === RealmGroupMessageCandidateCommitDisposition.MESSAGE_CANDIDATE) {
    return 'MESSAGE_CANDIDATE';
  }
  if (value === RealmGroupMessageCandidateCommitDisposition.REFUSAL_CANDIDATE) {
    return 'REFUSAL_CANDIDATE';
  }
  inputError('Runtime Realm group message candidate evidence has unsupported commit disposition', 'check_realm_group_message_candidate_disposition');
}

function requireIsoTimestamp(value: Parameters<typeof toNimiRuntimeIsoFromTimestamp>[0], fieldName: string): string {
  const iso = toNimiRuntimeIsoFromTimestamp(value);
  if (!iso) {
    inputError(`Runtime Realm group message candidate evidence missing ${fieldName}`, 'check_realm_group_message_candidate_timestamps');
  }
  return iso;
}

function buildRealmCommitPayload(input: {
  readonly candidate: RealmGroupMessageCandidateCommitHandle;
  readonly evidence: RealmGroupMessageCandidateEvidence;
  readonly slot: NimiRuntimeRealmGroupAgentSlotIdentity;
  readonly triggerRef: string;
  readonly idempotencyKey: string;
}): NimiRuntimeRealmGroupMessageCandidateCommitPayload {
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
    ...(input.evidence.messageType === 'TEXT' ? { messageType: 'TEXT' as const } : {}),
    ...(input.evidence.body ? { body: input.evidence.body } : {}),
    ...(input.evidence.bodyHash ? { bodyHash: input.evidence.bodyHash } : {}),
    ...(input.evidence.refusalCode ? { refusalCode: input.evidence.refusalCode } : {}),
    ...(input.evidence.refusalReason ? { refusalReason: input.evidence.refusalReason } : {}),
    ...(input.evidence.refusalHash ? { refusalHash: input.evidence.refusalHash } : {}),
    idempotencyKey: input.idempotencyKey,
    clientCorrelationId: input.idempotencyKey,
  };
}

export function createNimiHostRuntimeRealmGroupMessageCandidateSurface(
  options: NimiHostRuntimeRealmGroupMessageCandidateSurfaceOptions,
): NimiRuntimeRealmGroupMessageCandidateSurface {
  return {
    async createCommitPayload(input) {
      const runtime = options.getRuntime();
      const subjectUserId = await resolveNimiRuntimeAgentSubjectUserId(
        options.getSubjectUserId,
        'Realm group message candidate surface requires authenticated subject user id.',
      );
      const slot = resolveNimiRuntimeRealmGroupAgentSlotIdentity({
        participantType: input.participantType,
        currentUserId: input.currentUserId,
        realmGroupAgentSlotId: input.realmGroupAgentSlotId,
        ownerUserId: input.ownerUserId,
        realmAgentId: input.realmAgentId,
        localAgentRef: input.localAgentRef,
      });
      if (subjectUserId !== slot.ownerUserId) {
        inputError('Realm group agent candidate subject user must match the slot owner', 'authenticate_realm_group_agent_owner');
      }
      const realmGroupThreadId = requireText(input.realmGroupThreadId, 'Realm group message candidate handoff requires Realm group thread id', 'provide_realm_group_thread');
      const triggerMessageId = requireText(input.triggerMessageId, 'Realm group message candidate handoff requires a committed Realm trigger message', 'provide_realm_group_trigger_message');
      const idempotencyKey = requireText(input.idempotencyKey, 'Realm group message candidate handoff requires idempotency key', 'provide_realm_group_candidate_idempotency_key');
      if (Object.prototype.hasOwnProperty.call(input, 'contextRefs')) {
        inputError('Realm group candidate context refs are Runtime-owned and cannot be caller overridden', 'use_realm_group_participation_context_projection');
      }
      const triggerRef = `realm://group-chats/${realmGroupThreadId}/messages/${triggerMessageId}`;
      const context = buildRuntimeAgentRequestContext({
        runtimeAppId: runtime.appId,
        subjectUserId: slot.ownerUserId,
        localAgentRef: slot.localAgentRef,
      });
      const candidateResponse = await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId,
        withScopes: options.withScopes,
      }, [CREATE_CANDIDATE_SCOPE], (callOptions) => runtime.agent.createRealmGroupMessageCandidate({
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
        contextRefs: defaultContextRefs({
          realmGroupThreadId,
          realmGroupAgentSlotId: slot.realmGroupAgentSlotId,
        }),
      }, callOptions));
      const candidate = requireCandidateHandle(candidateResponse.candidate);
      assertCandidateHandleMatchesExpectedSlot({ candidate, slot, triggerRef, realmGroupThreadId });
      const evidenceResponse = await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId,
        withScopes: options.withScopes,
      }, [READ_CANDIDATE_EVIDENCE_SCOPE], (callOptions) => runtime.agent.getRealmGroupMessageCandidateEvidence({
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
      }, callOptions));
      const evidence = requireCandidateEvidence(evidenceResponse.evidence);
      assertCandidateEvidenceMatchesHandle({ candidate, evidence, slot, triggerRef, realmGroupThreadId });
      return {
        slot,
        triggerRef,
        candidate,
        evidence,
        realmCommitPayload: buildRealmCommitPayload({ candidate, evidence, slot, triggerRef, idempotencyKey }),
      };
    },
  };
}
