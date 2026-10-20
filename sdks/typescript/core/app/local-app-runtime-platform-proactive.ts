// @nimi-authority: rule.nimi.runtime.agent-participation.proactive-controls
import type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';
import { asRecord, assertExactKeys, assertExactProjectionKeys, assertNoAuthorityMaterial, localAppProjectionError, localAppError, projectTimestamp } from './local-app-runtime-platform-validation.js';

export type NimiLocalAppScheduledTime = { readonly seconds: string; readonly nanos: number };
export type NimiLocalAppConversationFollowUpCancelInput = {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
  readonly taskId: string;
  readonly expectedRevision: string;
};
export type NimiLocalAppConversationState = {
  readonly freeContactEnabled: boolean;
  readonly maxFollowUpTurns: number;
  readonly textTurnId: string | null;
  readonly pendingFollowUp: {
    readonly taskId: string;
    readonly revision: string;
    readonly scheduledFor: NimiLocalAppScheduledTime;
    readonly sourceTurnId: string;
  } | null;
};

export function projectLifeRevision(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/u.test(value) || BigInt(value) > 18446744073709551615n) return localAppProjectionError('owner revision');
  return value;
}
export function projectLifeSelector(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 256 || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) return localAppProjectionError('owner reference');
  return value;
}
export function projectScheduledTime(value: unknown): NimiLocalAppScheduledTime {
  const projected = projectTimestamp(value, 'scheduled time');
  if (!projected || BigInt(projected.seconds) < -62135596800n || BigInt(projected.seconds) > 253402300799n) return localAppProjectionError('scheduled time');
  return Object.freeze(projected);
}
export function projectConversationState(value: unknown): NimiLocalAppConversationState {
  const row = asRecord(value);
  assertExactProjectionKeys(row, ['freeContactEnabled', 'maxFollowUpTurns', 'pendingFollowUp', 'textTurnId'], 'conversation state');
  if (typeof row.freeContactEnabled !== 'boolean' || typeof row.maxFollowUpTurns !== 'number' || !Number.isSafeInteger(row.maxFollowUpTurns) || row.maxFollowUpTurns < 1) return localAppProjectionError('conversation state');
  let pending: NimiLocalAppConversationState['pendingFollowUp'] = null;
  if (row.pendingFollowUp !== null) {
    const task = asRecord(row.pendingFollowUp);
    assertExactProjectionKeys(task, ['taskId', 'revision', 'scheduledFor', 'sourceTurnId'], 'pending continuation');
    pending = Object.freeze({ taskId: projectLifeSelector(task.taskId), revision: projectLifeRevision(task.revision), scheduledFor: projectScheduledTime(task.scheduledFor), sourceTurnId: projectLifeSelector(task.sourceTurnId) });
  }
  return Object.freeze({ freeContactEnabled: row.freeContactEnabled, maxFollowUpTurns: row.maxFollowUpTurns, pendingFollowUp: pending, textTurnId: row.textTurnId === null ? null : projectLifeSelector(row.textTurnId) });
}
export function validateFollowUpCancelInput(input: NimiLocalAppConversationFollowUpCancelInput): NimiLocalAppConversationFollowUpCancelInput {
  const row = asRecord(input);
  assertNoAuthorityMaterial(row);
  assertExactKeys(row, ['agentHandle', 'conversationAnchorId', 'taskId', 'expectedRevision'], 'cancel continuation');
  if (!/^agent_ref_[A-Za-z0-9_-]{43}$/u.test(String(row.agentHandle))) return localAppError('A current Agent handle is required.', 'SDK_LOCAL_APP_INPUT_INVALID', 'refresh_agent_reference');
  projectLifeSelector(row.conversationAnchorId); projectLifeSelector(row.taskId); projectLifeRevision(row.expectedRevision);
  return input;
}
