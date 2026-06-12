import type {
  NimiRuntimeAgentConsumeEvent as SdkRuntimeAgentConsumeEvent,
  NimiRuntimeAgentSessionSnapshot as SdkRuntimeAgentSessionSnapshot,
} from '@nimiplatform/sdk/runtime';
import type {
  ActivitySource,
  AgentDataBundle,
  AgentBundleHistory,
  AgentEvent,
  RuntimePresentationAdmissionEvidence,
} from '../driver/types.js';
import { ulid } from '../infra/ids.js';

type RuntimeAgentTimelineForAvatar = {
  turnId: string;
  streamId: string;
  channel: 'text' | 'voice' | 'avatar' | 'state' | 'lipsync';
  offsetMs: number;
  sequence: number;
  startedAtWall: string;
  observedAtWall: string;
  timebaseOwner: 'runtime';
  projectionRuleId: 'K-AGCORE-051';
  clockBasis: 'monotonic_with_wall_anchor';
  providerNeutral: true;
  appLocalAuthority: false;
};

type RuntimeAgentVoicePlaybackEvent = {
  eventName: 'runtime.agent.presentation.voice_playback_requested';
  localAgentRef: string;
  conversationAnchorId: string;
  turnId: string;
  streamId: string;
  timeline: RuntimeAgentTimelineForAvatar;
  detail: {
    audioArtifactId: string;
    audioMimeType: string;
    playbackState: 'requested' | 'started' | 'completed' | 'interrupted' | 'canceled' | 'failed';
    durationMs?: number;
    deadlineOffsetMs?: number;
    reason?: string;
  };
};

// The deprecated runtime presentation per-frame mouth-batch consume path
// was deleted at wave 0 of topic 2026-04-30-avatar-vrm-backend-branch.
// Per-frame mouth movement now flows through `BackendAudioConsumer.snapshot()`.
export type RuntimeAgentConsumeEvent =
  | SdkRuntimeAgentConsumeEvent
  | RuntimeAgentVoicePlaybackEvent;

export type RuntimeAgentSessionSnapshot = SdkRuntimeAgentSessionSnapshot;

type RuntimeAgentExecutionStateValue =
  | 'idle'
  | 'chat_active'
  | 'life_pending'
  | 'life_running'
  | 'suspended';

type BundleActivityCategory = NonNullable<AgentDataBundle['activity']>['category'];
type BundleActivityIntensity = NonNullable<AgentDataBundle['activity']>['intensity'];
type BundleCurrentEmotion = NonNullable<AgentDataBundle['emotion']>['current'];

export type RuntimePresentationAdmissionDetail = RuntimePresentationAdmissionEvidence & {
  runtime_admission_ref: string;
  gateway_verdict_ref: string;
  firewall_verdict_ref: string;
  audit_ref: string;
  credential_verdict_ref: string;
};

export function mapExecutionState(value?: RuntimeAgentExecutionStateValue): AgentDataBundle['execution_state'] {
  switch (value) {
    case 'chat_active':
      return 'CHAT_ACTIVE';
    case 'life_pending':
      return 'LIFE_PENDING';
    case 'life_running':
      return 'LIFE_RUNNING';
    case 'suspended':
      return 'SUSPENDED';
    case 'idle':
    default:
      return 'IDLE';
  }
}

export function requireRuntimeActivityCategory(value: unknown): BundleActivityCategory {
  if (value === 'emotion' || value === 'interaction' || value === 'state') {
    return value;
  }
  throw new Error('avatar sdk driver received malformed runtime activity projection category');
}

export function requireRuntimeActivityIntensity(value: unknown): BundleActivityIntensity {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (value === 'weak' || value === 'moderate' || value === 'strong') {
    return value;
  }
  throw new Error('avatar sdk driver received malformed runtime activity projection intensity');
}

export function requireRuntimeProjectionSource(value: unknown, label: string): Exclude<ActivitySource, 'mock'> {
  if (value === 'apml_output' || value === 'direct_api') {
    return value;
  }
  throw new Error(`avatar sdk driver received malformed ${label} source`);
}

function readRequiredRef(record: Record<string, unknown>, camelKey: string, snakeKey: string, label: string): string {
  const value = record[camelKey] ?? record[snakeKey];
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  throw new Error(`avatar sdk driver received runtime presentation without ${label}`);
}

export function requireRuntimePresentationAdmissionEvidence(
  detail: Record<string, unknown>,
): RuntimePresentationAdmissionDetail {
  const runtimeAdmissionRef = readRequiredRef(
    detail,
    'runtimeAdmissionRef',
    'runtime_admission_ref',
    'runtime admission evidence ref',
  );
  const gatewayVerdictRef = readRequiredRef(
    detail,
    'gatewayVerdictRef',
    'gateway_verdict_ref',
    'gateway verdict ref',
  );
  const firewallVerdictRef = readRequiredRef(
    detail,
    'firewallVerdictRef',
    'firewall_verdict_ref',
    'firewall verdict ref',
  );
  const auditRef = readRequiredRef(detail, 'auditRef', 'audit_ref', 'audit ref');
  const credentialVerdictRef = readRequiredRef(
    detail,
    'credentialVerdictRef',
    'credential_verdict_ref',
    'credential verdict ref',
  );
  return {
    runtimeAdmissionRef,
    gatewayVerdictRef,
    firewallVerdictRef,
    auditRef,
    credentialVerdictRef,
    runtime_admission_ref: runtimeAdmissionRef,
    gateway_verdict_ref: gatewayVerdictRef,
    firewall_verdict_ref: firewallVerdictRef,
    audit_ref: auditRef,
    credential_verdict_ref: credentialVerdictRef,
  };
}

export function requireRuntimeSourceText(value: unknown, label: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  throw new Error(`avatar sdk driver received malformed ${label} source`);
}

export function requireRuntimeDetailText(value: unknown, label: string): string {
  if (typeof value === 'string') {
    return value;
  }
  throw new Error(`avatar sdk driver received malformed ${label}`);
}

export function optionalRuntimeDetailText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function optionalRuntimeExecutionState(value: unknown): RuntimeAgentExecutionStateValue | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (
    value === 'idle'
    || value === 'chat_active'
    || value === 'life_pending'
    || value === 'life_running'
    || value === 'suspended'
  ) {
    return value;
  }
  throw new Error('avatar sdk driver received malformed runtime execution state');
}

export function requireRuntimePostureDetail(value: unknown): {
  actionFamily: string;
  interruptMode: string;
} {
  const record = asRecord(value);
  const actionFamily = requireRuntimeDetailText(record.actionFamily, 'runtime posture action family');
  const interruptMode = requireRuntimeDetailText(record.interruptMode, 'runtime posture interrupt mode');
  return { actionFamily, interruptMode };
}

export function requireRuntimeCurrentEmotion(value: unknown): BundleCurrentEmotion {
  if (
    value === 'neutral'
    || value === 'joy'
    || value === 'focus'
    || value === 'calm'
    || value === 'playful'
    || value === 'concerned'
    || value === 'surprised'
  ) {
    return value;
  }
  throw new Error('avatar sdk driver received malformed runtime current emotion');
}

export function optionalRuntimePreviousEmotion(value: unknown): BundleCurrentEmotion | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return requireRuntimeCurrentEmotion(value);
}

export function toRuntimeAgentEvent(
  name: string,
  detail: Record<string, unknown>,
  now: number,
): AgentEvent {
  return {
    event_id: ulid(now),
    name,
    timestamp: new Date(now).toISOString(),
    detail,
  };
}

export function mergeHistory(
  current: AgentBundleHistory | undefined,
  next: Partial<AgentBundleHistory>,
): AgentBundleHistory {
  return {
    last_activity: next.last_activity ?? current?.last_activity ?? null,
    last_motion: next.last_motion ?? current?.last_motion ?? null,
    last_expression: next.last_expression ?? current?.last_expression ?? null,
  };
}

export function mergeCustomRecord(
  current: AgentDataBundle['custom'],
  next: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(current || {}),
    ...next,
  };
}

export function clearTurnCueRecord(
  current: AgentDataBundle['custom'],
  next?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(current || {}),
    active_turn_id: null,
    active_turn_stream_id: null,
    active_turn_phase: null,
    active_turn_text: null,
    active_turn_updated_at: null,
    ...(next || {}),
  };
}

export function normalizeRuntimeTimelineForAvatar(event: RuntimeAgentConsumeEvent): Record<string, unknown> | null {
  const timeline = 'timeline' in event ? event.timeline : undefined;
  if (!timeline) {
    return null;
  }
  return {
    turn_id: timeline.turnId,
    stream_id: timeline.streamId,
    channel: timeline.channel,
    offset_ms: timeline.offsetMs,
    sequence: timeline.sequence,
    started_at_wall: timeline.startedAtWall,
    observed_at_wall: timeline.observedAtWall,
    timebase_owner: timeline.timebaseOwner,
    projection_rule_id: timeline.projectionRuleId,
    clock_basis: timeline.clockBasis,
    provider_neutral: timeline.providerNeutral,
    app_local_authority: timeline.appLocalAuthority,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function readSnapshotStatusCue(snapshot: RuntimeAgentSessionSnapshot): {
  turnId: string;
  streamId: string;
  expressionId: string;
  activityName: string;
  activityCategory: BundleActivityCategory | '';
  activityIntensity: BundleActivityIntensity;
  admission: RuntimePresentationAdmissionDetail;
} | null {
  const turn = snapshot.lastTurn;
  const turnId = typeof turn?.turnId === 'string' ? turn.turnId.trim() : '';
  const streamId = typeof turn?.streamId === 'string' ? turn.streamId.trim() : '';
  if (!turnId || !streamId) {
    return null;
  }
  const structured = asRecord(turn?.structured);
  const statusCue = asRecord(structured.status_cue ?? structured.statusCue);
  const expressionId = typeof statusCue.mood === 'string' ? statusCue.mood.trim() : '';
  const activityName = typeof statusCue.action_cue === 'string'
    ? statusCue.action_cue.trim()
    : typeof statusCue.actionCue === 'string'
      ? statusCue.actionCue.trim()
      : '';
  const activityCategory = typeof statusCue.activity_category === 'string'
    ? statusCue.activity_category.trim()
    : typeof statusCue.activityCategory === 'string'
      ? statusCue.activityCategory.trim()
      : '';
  const activityIntensity = typeof statusCue.activity_intensity === 'string'
    ? statusCue.activity_intensity.trim()
    : typeof statusCue.activityIntensity === 'string'
      ? statusCue.activityIntensity.trim()
      : '';
  if (!expressionId && !activityName) {
    return null;
  }
  const admission = requireRuntimePresentationAdmissionEvidence(statusCue);
  return {
    turnId,
    streamId,
    expressionId,
    activityName,
    activityCategory: activityCategory as BundleActivityCategory | '',
    activityIntensity: activityIntensity as BundleActivityIntensity,
    admission,
  };
}
