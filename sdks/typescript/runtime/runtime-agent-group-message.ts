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
import type {
  CommitRealmGroupSourceMessageCandidateInputDto,
  GroupSourceTriggerEvidenceDto,
} from '../core-generated/realm-typed-client';
import { createNimiError, ReasonCode } from '../types';
import { buildRuntimeAgentRequestContext, isRuntimeLocalAgentRef } from './agent-local-identity';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import { normalizeNimiRuntimeAgentText, toNimiRuntimeIsoFromTimestamp } from './runtime-agent-values';

const CANDIDATE_KIND = 'REALM_GROUP_MESSAGE_CANDIDATE';
const CREATE_CANDIDATE_SCOPE = 'runtime.agent.create_realm_group_message_candidate';
const READ_CANDIDATE_EVIDENCE_SCOPE = 'runtime.agent.get_realm_group_message_candidate_evidence';
const REALM_GROUP_TRIGGER_KINDS = new Set<GroupSourceTriggerEvidenceDto['kind']>([
  'mention',
  'explicitUserAction',
  'admittedAutomation',
  'productDisabled',
]);

export interface NimiRuntimeParticipantSlotIdentity {
  readonly runtimeParticipantSlot: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
}

export interface NimiRuntimeParticipantSlotIdentityInput {
  readonly participantType?: unknown;
  readonly currentUserId: unknown;
  readonly runtimeParticipantSlot: unknown;
  readonly ownerUserId: unknown;
  readonly runtimeSourceRef: unknown;
  readonly localAgentRef: unknown;
}

export type NimiRuntimeRealmGroupMessageCandidateCommitPayload =
  CommitRealmGroupSourceMessageCandidateInputDto;

export type NimiRuntimeRealmGroupMessageCandidateCommitInput =
  NimiRuntimeParticipantSlotIdentityInput & {
    readonly realmGroupThreadId: unknown;
    readonly triggerMessageId: unknown;
    readonly triggerKind: unknown;
    readonly idempotencyKey: unknown;
    readonly replyTargetRef?: unknown;
    readonly membershipSnapshotRef?: unknown;
    readonly readCursorRef?: unknown;
    readonly roomOrchestrationRef?: unknown;
    readonly contextRefs?: never;
  };

export interface NimiRuntimeRealmGroupMessageCandidateCommitResult {
  readonly slot: NimiRuntimeParticipantSlotIdentity;
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

function requireTriggerKind(value: unknown): GroupSourceTriggerEvidenceDto['kind'] {
  const triggerKind = requireText(value, 'Realm group message candidate handoff requires trigger kind', 'provide_realm_group_trigger_kind');
  if (!REALM_GROUP_TRIGGER_KINDS.has(triggerKind as GroupSourceTriggerEvidenceDto['kind'])) {
    inputError('Realm group message candidate handoff trigger kind is not admitted', 'use_admitted_realm_group_trigger_kind');
  }
  return triggerKind as GroupSourceTriggerEvidenceDto['kind'];
}

export function resolveNimiRuntimeParticipantSlotIdentity(
  input: NimiRuntimeParticipantSlotIdentityInput,
): NimiRuntimeParticipantSlotIdentity {
  const participantType = optionalText(input.participantType);
  if (participantType && participantType !== 'source') {
    inputError('runtime source candidate handoff requires a runtime participant slot', 'provide_runtime_participant_slot');
  }
  const currentUserId = requireText(input.currentUserId, 'runtime source candidate handoff requires authenticated current user id', 'authenticate_runtime_source_owner');
  const runtimeParticipantSlot = requireText(input.runtimeParticipantSlot, 'runtime source candidate handoff requires Runtime participant slot id', 'provide_runtime_participant_slot');
  const ownerUserId = requireText(input.ownerUserId, 'runtime source candidate handoff requires owner user id', 'provide_runtime_source_owner');
  const runtimeSourceRef = requireText(input.runtimeSourceRef, 'runtime source candidate handoff requires runtime source ref', 'provide_runtime_source_ref');
  const localAgentRef = requireText(input.localAgentRef, 'runtime source candidate handoff requires local agent ref', 'provide_runtime_source_local_agent_ref');
  if (ownerUserId !== currentUserId) {
    inputError('runtime source candidate handoff requires the current user to own the local agent slot', 'use_owned_runtime_source');
  }
  if (!isRuntimeLocalAgentRef(localAgentRef)) {
    inputError('runtime source candidate handoff local agent ref must be a Runtime-owned local agent id', 'repair_runtime_participant_slot_projection');
  }
  return {
    runtimeParticipantSlot,
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
  };
}

function defaultContextRefs(input: {
  readonly realmGroupThreadId: string;
  readonly runtimeParticipantSlot: string;
}): Record<string, string> {
  return {
    'realm.group.thread.snapshot': `realm-context://group-chats/${input.realmGroupThreadId}/thread/current`,
    'realm.group.runtime_participant_slot.snapshot': `realm-context://runtime-participant-slots/${input.runtimeParticipantSlot}/current`,
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
  readonly slot: NimiRuntimeParticipantSlotIdentity;
  readonly triggerRef: string;
  readonly realmGroupThreadId: string;
}): void {
  if (
    input.candidate.realmGroupThreadId !== input.realmGroupThreadId
    || input.candidate.runtimeParticipantSlot !== input.slot.runtimeParticipantSlot
    || input.candidate.localAgentRef !== input.slot.localAgentRef
    || input.candidate.triggerRef !== input.triggerRef
  ) {
    inputError('Runtime Realm group message candidate handle does not match expected runtime participant slot handoff', 'check_realm_group_message_candidate_handle');
  }
}

function assertCandidateEvidenceMatchesHandle(input: {
  readonly candidate: RealmGroupMessageCandidateCommitHandle;
  readonly evidence: RealmGroupMessageCandidateEvidence;
  readonly slot: NimiRuntimeParticipantSlotIdentity;
  readonly triggerRef: string;
  readonly realmGroupThreadId: string;
}): void {
  if (
    input.evidence.candidateId !== input.candidate.candidateId
    || input.evidence.evidenceHash !== input.candidate.evidenceHash
    || input.evidence.runtimeTraceRef !== input.candidate.runtimeTraceRef
    || input.evidence.realmGroupThreadId !== input.realmGroupThreadId
    || input.evidence.runtimeParticipantSlot !== input.slot.runtimeParticipantSlot
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
  readonly slot: NimiRuntimeParticipantSlotIdentity;
  readonly triggerRef: string;
  readonly triggerMessageId: string;
  readonly triggerKind: GroupSourceTriggerEvidenceDto['kind'];
  readonly idempotencyKey: string;
}): NimiRuntimeRealmGroupMessageCandidateCommitPayload {
  const triggerEvidence: GroupSourceTriggerEvidenceDto = {
    kind: input.triggerKind,
    triggerRef: input.triggerRef,
    actorId: input.slot.ownerUserId,
    chatId: input.evidence.realmGroupThreadId,
    messageId: input.triggerMessageId,
  };
  return {
    candidateId: input.candidate.candidateId,
    candidateKind: CANDIDATE_KIND,
    candidateEvidenceRef: input.candidate.candidateEvidenceRef,
    evidenceHash: input.candidate.evidenceHash,
    runtimeTraceRef: input.candidate.runtimeTraceRef,
    expectedRuntimeParticipantSlotId: input.slot.runtimeParticipantSlot,
    expectedRuntimeSourceRef: input.slot.runtimeSourceRef,
    triggerEvidence,
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
      const slot = resolveNimiRuntimeParticipantSlotIdentity({
        participantType: input.participantType,
        currentUserId: input.currentUserId,
        runtimeParticipantSlot: input.runtimeParticipantSlot,
        ownerUserId: input.ownerUserId,
        runtimeSourceRef: input.runtimeSourceRef,
        localAgentRef: input.localAgentRef,
      });
      if (subjectUserId !== slot.ownerUserId) {
        inputError('runtime source candidate subject user must match the slot owner', 'authenticate_realm_group_source_owner');
      }
      const realmGroupThreadId = requireText(input.realmGroupThreadId, 'Realm group message candidate handoff requires Realm group thread id', 'provide_realm_group_thread');
      const triggerMessageId = requireText(input.triggerMessageId, 'Realm group message candidate handoff requires a committed Realm trigger message', 'provide_realm_group_trigger_message');
      const triggerKind = requireTriggerKind(input.triggerKind);
      const idempotencyKey = requireText(input.idempotencyKey, 'Realm group message candidate handoff requires idempotency key', 'provide_realm_group_candidate_idempotency_key');
      if (Object.prototype.hasOwnProperty.call(input, 'contextRefs')) {
        inputError('Realm group candidate context refs are Runtime-owned and cannot be caller overridden', 'use_realm_group_participation_context_projection');
      }
      const triggerRef = `realm://group-chats/${realmGroupThreadId}/messages/${triggerMessageId}`;
      const context = buildRuntimeAgentRequestContext({
        runtimeAppId: runtime.appId,
        subjectUserId: slot.ownerUserId,
        ownerUserId: slot.ownerUserId,
        runtimeSourceRef: slot.runtimeSourceRef,
        localAgentRef: slot.localAgentRef,
      });
      const candidateResponse = await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId,
        withScopes: options.withScopes,
      }, [CREATE_CANDIDATE_SCOPE], (callOptions) => runtime.agent.createRealmGroupMessageCandidate({
        context,
        realmGroupThreadId,
        runtimeParticipantSlot: slot.runtimeParticipantSlot,
        ownerUserId: slot.ownerUserId,
        runtimeSourceRef: slot.runtimeSourceRef,
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
          runtimeParticipantSlot: slot.runtimeParticipantSlot,
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
        expectedRuntimeParticipantSlot: slot.runtimeParticipantSlot,
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
        realmCommitPayload: buildRealmCommitPayload({
          candidate,
          evidence,
          slot,
          triggerRef,
          triggerMessageId,
          triggerKind,
          idempotencyKey,
        }),
      };
    },
  };
}
