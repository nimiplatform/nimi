// @nimi-authority: rule.nimi.runtime.agent-participation.proactive-controls
import type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';
import {
  asRecord,
  assertExactKeys,
  assertExactProjectionKeys,
  assertNoAuthorityMaterial,
  localAppProjectionError,
  localAppError,
  projectTimestamp,
  requireText,
} from './local-app-runtime-platform-validation.js';

export type NimiLocalAppScheduledTime = { readonly seconds: string; readonly nanos: number };
export type NimiLocalAppScheduledTaskEdit = {
  readonly taskId: string;
  readonly expectedRevision: string;
} & (
  | { readonly action: 'cancel'; readonly scheduledFor?: never }
  | { readonly action: 'reschedule'; readonly scheduledFor: NimiLocalAppScheduledTime }
);
export type NimiLocalAppConversationPolicyInput = {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
  readonly expectedRevision: string;
  readonly enabled: boolean;
};
export type NimiLocalAppConversationFollowUpInput = {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
} & NimiLocalAppScheduledTaskEdit;
export type NimiLocalAppAgentPendingHookInput = {
  readonly agentHandle: NimiLocalAppAgentHandle;
} & NimiLocalAppScheduledTaskEdit;
export type NimiLocalAppConversationState = {
  readonly followUpEnabled: boolean;
  readonly followUpPolicyRevision: string;
  readonly maxFollowUpTurns: number;
  readonly textTurnId: string | null;
  readonly pendingFollowUp: {
    readonly taskId: string;
    readonly revision: string;
    readonly scheduledFor: NimiLocalAppScheduledTime;
    readonly sourceTurnId: string;
  } | null;
};
export type NimiLocalAppAgentPendingHook = {
  readonly taskId: string;
  readonly revision: string;
  readonly scheduledFor: NimiLocalAppScheduledTime | null;
  readonly systemCadence: boolean;
  readonly status: 'pending' | 'running' | 'canceled';
  readonly canModify: boolean;
  /** Optional display text, never an execution instruction or verified result. */
  readonly publicPurpose?: string;
};
export type NimiLocalAppAgentPendingHooks = {
  readonly hooks: readonly NimiLocalAppAgentPendingHook[];
  readonly truncated: boolean;
};
export type NimiLocalAppPendingHooksShell = {
  readonly list: (input: { readonly agentHandle: NimiLocalAppAgentHandle }) => Promise<unknown>;
  readonly update: (input: NimiLocalAppAgentPendingHookInput) => Promise<unknown>;
};
export type NimiLocalAppPendingHooksClient = {
  readonly list: (input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
  }) => Promise<NimiLocalAppAgentPendingHooks>;
  readonly update: (
    input: NimiLocalAppAgentPendingHookInput,
  ) => Promise<NimiLocalAppAgentPendingHook>;
};

function revision(value: unknown, zero = false): string {
  if (
    typeof value !== 'string' ||
    !(zero ? /^(0|[1-9]\d*)$/u : /^[1-9]\d*$/u).test(value) ||
    BigInt(value) > 18446744073709551615n
  )
    return localAppProjectionError('task revision');
  return value;
}
function selector(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 256 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    return localAppProjectionError('task selector');
  return value;
}
function scheduledTime(value: unknown): NimiLocalAppScheduledTime {
  const projected = projectTimestamp(value, 'scheduled time');
  if (
    !projected ||
    BigInt(projected.seconds) < -62135596800n ||
    BigInt(projected.seconds) > 253402300799n
  )
    return localAppProjectionError('scheduled time');
  return Object.freeze(projected);
}
export function projectConversationState(value: unknown): NimiLocalAppConversationState {
  const row = asRecord(value);
  assertExactProjectionKeys(
    row,
    [
      'followUpEnabled',
      'followUpPolicyRevision',
      'maxFollowUpTurns',
      'pendingFollowUp',
      'textTurnId',
    ],
    'conversation state',
  );
  if (
    typeof row.followUpEnabled !== 'boolean' ||
    typeof row.maxFollowUpTurns !== 'number' ||
    !Number.isSafeInteger(row.maxFollowUpTurns) ||
    row.maxFollowUpTurns < 1
  )
    return localAppProjectionError('conversation state');
  let pending: NimiLocalAppConversationState['pendingFollowUp'] = null;
  if (row.pendingFollowUp !== null) {
    const task = asRecord(row.pendingFollowUp);
    assertExactProjectionKeys(
      task,
      ['taskId', 'revision', 'scheduledFor', 'sourceTurnId'],
      'pending conversation follow-up',
    );
    pending = Object.freeze({
      taskId: selector(task.taskId),
      revision: revision(task.revision),
      scheduledFor: scheduledTime(task.scheduledFor),
      sourceTurnId: selector(task.sourceTurnId),
    });
  }
  return Object.freeze({
    followUpEnabled: row.followUpEnabled,
    followUpPolicyRevision: revision(row.followUpPolicyRevision, true),
    maxFollowUpTurns: row.maxFollowUpTurns,
    pendingFollowUp: pending,
    textTurnId: row.textTurnId === null ? null : selector(row.textTurnId),
  });
}
export function projectPendingHook(value: unknown): NimiLocalAppAgentPendingHook {
  const row = asRecord(value);
  assertExactProjectionKeys(
    row,
    ['taskId', 'revision', 'scheduledFor', 'systemCadence', 'status', 'canModify',
      ...(row && Object.hasOwn(row, 'publicPurpose') ? ['publicPurpose'] : [])],
    'activity plan',
  );
  if (
    typeof row.systemCadence !== 'boolean' ||
    typeof row.canModify !== 'boolean' ||
    !['pending', 'running', 'canceled'].includes(String(row.status)) ||
    (row.canModify && (row.systemCadence || row.status !== 'pending'))
  )
    return localAppProjectionError('activity plan');
  return Object.freeze({
    taskId: selector(row.taskId),
    revision: revision(row.revision),
    scheduledFor: row.scheduledFor === null ? null : scheduledTime(row.scheduledFor),
    systemCadence: row.systemCadence,
    status: row.status as NimiLocalAppAgentPendingHook['status'],
    canModify: row.canModify,
    ...(typeof row.publicPurpose === 'string' && row.publicPurpose.trim() && [...row.publicPurpose.trim()].length <= 160
      ? { publicPurpose: row.publicPurpose.trim() } : {}),
  });
}
export function projectPendingHooks(value: unknown): NimiLocalAppAgentPendingHooks {
  const row = asRecord(value);
  assertExactProjectionKeys(row, ['hooks', 'truncated'], 'activity plans');
  if (!Array.isArray(row.hooks) || row.hooks.length > 100 || typeof row.truncated !== 'boolean')
    return localAppProjectionError('activity plans');
  const hooks = row.hooks.map(projectPendingHook);
  if (new Set(hooks.map((hook) => hook.taskId)).size !== hooks.length)
    return localAppProjectionError('duplicate activity plan');
  return Object.freeze({ hooks: Object.freeze(hooks), truncated: row.truncated });
}
export function validateProactiveInput<
  T extends
    | NimiLocalAppConversationPolicyInput
    | NimiLocalAppConversationFollowUpInput
    | NimiLocalAppAgentPendingHookInput,
>(input: T, policy = false): T {
  const row = asRecord(input);
  if (!row) return localAppProjectionError('proactive control input');
  assertNoAuthorityMaterial(row);
  const keys = [
    'agentHandle',
    ...(Object.hasOwn(row, 'conversationAnchorId') ? ['conversationAnchorId'] : []),
    ...(policy
      ? ['expectedRevision', 'enabled']
      : [
          'taskId',
          'expectedRevision',
          'action',
          ...(row.action === 'reschedule' ? ['scheduledFor'] : []),
        ]),
  ];
  assertExactKeys(row, keys, 'proactive control');
  if (!/^agent_ref_[A-Za-z0-9_-]{43}$/u.test(String(row.agentHandle)))
    return localAppError(
      'A current Agent handle is required.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'refresh_agent_reference',
    );
  if (Object.hasOwn(row, 'conversationAnchorId')) selector(row.conversationAnchorId);
  revision(row.expectedRevision, policy);
  if (policy) {
    if (typeof row.enabled !== 'boolean') return localAppProjectionError('follow-up enablement');
  } else {
    selector(row.taskId);
    if (row.action !== 'cancel' && row.action !== 'reschedule')
      return localAppProjectionError('task action');
    if (row.action === 'reschedule') scheduledTime(row.scheduledFor);
  }
  return input;
}
export function createPendingHooksClient(
  shell: NimiLocalAppPendingHooksShell,
): NimiLocalAppPendingHooksClient {
  return Object.freeze({
    list: async (input) => {
      assertExactKeys(input, ['agentHandle'], 'activity plans');
      requireText(input.agentHandle, 'agentHandle');
      return projectPendingHooks(await shell.list(input));
    },
    update: async (input) => projectPendingHook(await shell.update(validateProactiveInput(input))),
  });
}

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
