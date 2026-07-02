import {
  AgentAutonomyMode,
  AgentProactiveDeliveryChannel,
  AgentProactiveEffectClass,
  AgentProactiveEventFamily,
  AgentProactiveFrequencyCapState,
  AgentProactiveOptInState,
  AgentProactiveQuietHoursState,
  AgentProactiveSuppressionReason,
  AgentProactiveTriggerSource,
  type AgentProactiveEventDetail,
  type AgentProactiveInterruptibilityProjection,
} from '../core-generated/runtime-typed-client';
import type { Timestamp } from '../core-generated/runtime-protobuf/google/protobuf/timestamp';
import {
  normalizeNimiRuntimeAgentText,
  toNimiRuntimeIsoFromTimestamp,
} from './runtime-agent-values';
import type {
  NimiRuntimeAgentAutonomyMode,
  NimiRuntimeAgentProactiveDeliveryChannel,
  NimiRuntimeAgentProactiveEffectClass,
  NimiRuntimeAgentProactiveEventFamily,
  NimiRuntimeAgentProactiveEventProjection,
  NimiRuntimeAgentProactiveFrequencyCapState,
  NimiRuntimeAgentProactiveInterruptibilityProjection,
  NimiRuntimeAgentProactiveOptInState,
  NimiRuntimeAgentProactiveQuietHoursState,
  NimiRuntimeAgentProactiveSuppressionReason,
  NimiRuntimeAgentProactiveTriggerSource,
} from './runtime-agent-inspect-types';

function runtimeAgentTimestampToIso(timestamp?: Timestamp): string | null {
  return toNimiRuntimeIsoFromTimestamp(timestamp);
}

function formatProactiveAutonomyMode(value: unknown): NimiRuntimeAgentAutonomyMode | null {
  switch (Number(value)) {
    case AgentAutonomyMode.OFF:
      return 'off';
    case AgentAutonomyMode.LOW:
      return 'low';
    case AgentAutonomyMode.MEDIUM:
      return 'medium';
    case AgentAutonomyMode.HIGH:
      return 'high';
    default:
      return null;
  }
}

export function formatNimiRuntimeAgentProactiveEventFamily(
  value: unknown,
): NimiRuntimeAgentProactiveEventFamily | null {
  switch (Number(value)) {
    case AgentProactiveEventFamily.SUGGESTED:
      return 'suggested';
    case AgentProactiveEventFamily.DELIVERED:
      return 'delivered';
    case AgentProactiveEventFamily.SUPPRESSED:
      return 'suppressed';
    default:
      return null;
  }
}

export function formatNimiRuntimeAgentProactiveTriggerSource(
  value: unknown,
): NimiRuntimeAgentProactiveTriggerSource | null {
  switch (Number(value)) {
    case AgentProactiveTriggerSource.LIFE_TRACK_CADENCE:
      return 'life-track-cadence';
    case AgentProactiveTriggerSource.HOOK_INTENT:
      return 'hook-intent';
    default:
      return null;
  }
}

export function formatNimiRuntimeAgentProactiveEffectClass(
  value: unknown,
): NimiRuntimeAgentProactiveEffectClass | null {
  return Number(value) === AgentProactiveEffectClass.IN_APP_COMPANION_SURFACE
    ? 'in-app-companion-surface'
    : null;
}

export function formatNimiRuntimeAgentProactiveDeliveryChannel(
  value: unknown,
): NimiRuntimeAgentProactiveDeliveryChannel | null {
  switch (Number(value)) {
    case AgentProactiveDeliveryChannel.IN_APP_SURFACE:
      return 'in-app-surface';
    case AgentProactiveDeliveryChannel.NOTIFICATION_NOT_ADMITTED:
      return 'notification.not_admitted';
    default:
      return null;
  }
}

export function formatNimiRuntimeAgentProactiveOptInState(
  value: unknown,
): NimiRuntimeAgentProactiveOptInState | null {
  switch (Number(value)) {
    case AgentProactiveOptInState.OFF:
      return 'off';
    case AgentProactiveOptInState.PENDING:
      return 'pending';
    case AgentProactiveOptInState.GRANTED:
      return 'granted';
    case AgentProactiveOptInState.DENIED:
      return 'denied';
    case AgentProactiveOptInState.REVOKED:
      return 'revoked';
    case AgentProactiveOptInState.EXPIRED:
      return 'expired';
    case AgentProactiveOptInState.MISSING:
      return 'missing';
    default:
      return null;
  }
}

export function formatNimiRuntimeAgentProactiveQuietHoursState(
  value: unknown,
): NimiRuntimeAgentProactiveQuietHoursState | null {
  switch (Number(value)) {
    case AgentProactiveQuietHoursState.INACTIVE:
      return 'inactive';
    case AgentProactiveQuietHoursState.ACTIVE:
      return 'active';
    case AgentProactiveQuietHoursState.NOT_CONFIGURED:
      return 'not-configured';
    default:
      return null;
  }
}

export function formatNimiRuntimeAgentProactiveFrequencyCapState(
  value: unknown,
): NimiRuntimeAgentProactiveFrequencyCapState | null {
  switch (Number(value)) {
    case AgentProactiveFrequencyCapState.WITHIN_CAP:
      return 'within-cap';
    case AgentProactiveFrequencyCapState.CAPPED:
      return 'capped';
    case AgentProactiveFrequencyCapState.NOT_CONFIGURED:
      return 'not-configured';
    default:
      return null;
  }
}

export function formatNimiRuntimeAgentProactiveSuppressionReason(
  value: unknown,
): NimiRuntimeAgentProactiveSuppressionReason | null {
  switch (Number(value)) {
    case AgentProactiveSuppressionReason.QUIET_HOURS_ACTIVE:
      return 'quiet-hours-active';
    case AgentProactiveSuppressionReason.FREQUENCY_CAP_EXCEEDED:
      return 'frequency-cap-exceeded';
    case AgentProactiveSuppressionReason.PERMISSION_DENIED:
      return 'permission-denied';
    case AgentProactiveSuppressionReason.PERMISSION_REVOKED:
      return 'permission-revoked';
    case AgentProactiveSuppressionReason.PERMISSION_MISSING:
      return 'permission-missing';
    case AgentProactiveSuppressionReason.PERMISSION_EXPIRED:
      return 'permission-expired';
    case AgentProactiveSuppressionReason.AUTONOMY_OFF:
      return 'autonomy-off';
    case AgentProactiveSuppressionReason.BUDGET_EXHAUSTED:
      return 'budget-exhausted';
    case AgentProactiveSuppressionReason.SCHEDULER_DENIED:
      return 'scheduler-denied';
    case AgentProactiveSuppressionReason.HOOK_CONFLICT:
      return 'hook-conflict';
    case AgentProactiveSuppressionReason.RUNTIME_UNAVAILABLE:
      return 'runtime-unavailable';
    case AgentProactiveSuppressionReason.UNSUPPORTED_DELIVERY_CHANNEL:
      return 'unsupported-delivery-channel';
    case AgentProactiveSuppressionReason.MISSING_AUDIT_REF:
      return 'missing-audit-ref';
    default:
      return null;
  }
}

function uniqueNonEmptyRuntimeAgentTexts(values?: readonly unknown[]): string[] {
  const unique = new Set<string>();
  for (const value of values || []) {
    const normalized = normalizeNimiRuntimeAgentText(value);
    if (normalized) {
      unique.add(normalized);
    }
  }
  return [...unique];
}

function missingNimiRuntimeAgentProactiveInterruptibility():
  NimiRuntimeAgentProactiveInterruptibilityProjection {
  return {
    projectionId: null,
    projectionKind: null,
    mode: null,
    optInState: null,
    deliveryChannel: null,
    quietHoursState: null,
    frequencyCapState: null,
    suggestedEvent: null,
    lastDeliveredEvent: null,
    lastSuppressedEvent: null,
    auditRefs: [],
    unsupportedFields: ['proactive_interruptibility'],
  };
}

export function projectNimiRuntimeAgentProactiveEvent(
  event?: AgentProactiveEventDetail | null,
): NimiRuntimeAgentProactiveEventProjection | null {
  if (!event) {
    return null;
  }

  const family = formatNimiRuntimeAgentProactiveEventFamily(event.family);
  const projectionId = normalizeNimiRuntimeAgentText(event.projectionId) || null;
  const projectionKind = normalizeNimiRuntimeAgentText(event.projectionKind) || null;
  const ownerDomain = normalizeNimiRuntimeAgentText(event.ownerDomain) || null;
  const triggerSource = formatNimiRuntimeAgentProactiveTriggerSource(event.triggerSource);
  const effectClass = formatNimiRuntimeAgentProactiveEffectClass(event.effectClass);
  const deliveryChannel = formatNimiRuntimeAgentProactiveDeliveryChannel(event.deliveryChannel);
  const mode = formatProactiveAutonomyMode(event.mode);
  const optInState = formatNimiRuntimeAgentProactiveOptInState(event.optInState);
  const quietHoursState = formatNimiRuntimeAgentProactiveQuietHoursState(event.quietHours);
  const frequencyCapState = formatNimiRuntimeAgentProactiveFrequencyCapState(event.frequencyCap);
  const suppressionReason = formatNimiRuntimeAgentProactiveSuppressionReason(event.suppressionReason);
  const auditRef = normalizeNimiRuntimeAgentText(event.auditRef) || null;
  const unsupportedFields = new Set<string>();

  for (const [field, value] of [
    ['family', family],
    ['projection_id', projectionId],
    ['projection_kind', projectionKind],
    ['owner_domain', ownerDomain],
    ['trigger_source', triggerSource],
    ['effect_class', effectClass],
    ['delivery_channel', deliveryChannel],
    ['mode', mode],
    ['opt_in_state', optInState],
    ['quiet_hours', quietHoursState],
    ['frequency_cap', frequencyCapState],
    ['audit_ref', auditRef],
  ] as const) {
    if (!value) {
      unsupportedFields.add(field);
    }
  }
  if (family === 'suppressed' && !suppressionReason) {
    unsupportedFields.add('suppression_reason');
  }

  return {
    family,
    projectionId,
    projectionKind,
    ownerDomain,
    triggerSource,
    effectClass,
    deliveryChannel,
    mode,
    optInState,
    quietHoursState,
    frequencyCapState,
    suppressionReason,
    reasonCode: normalizeNimiRuntimeAgentText(event.reasonCode) || null,
    auditRef,
    sourceHookId: normalizeNimiRuntimeAgentText(event.sourceHookId) || null,
    sourceCadenceId: normalizeNimiRuntimeAgentText(event.sourceCadenceId) || null,
    conversationAnchorId: normalizeNimiRuntimeAgentText(event.conversationAnchorId) || null,
    originatingTurnId: normalizeNimiRuntimeAgentText(event.originatingTurnId) || null,
    originatingStreamId: normalizeNimiRuntimeAgentText(event.originatingStreamId) || null,
    observedAt: runtimeAgentTimestampToIso(event.observedAt),
    unsupportedFields: [...unsupportedFields],
  };
}

export function projectNimiRuntimeAgentProactiveInterruptibility(
  projection?: AgentProactiveInterruptibilityProjection | null,
): NimiRuntimeAgentProactiveInterruptibilityProjection {
  if (!projection) {
    return missingNimiRuntimeAgentProactiveInterruptibility();
  }

  const projectionId = normalizeNimiRuntimeAgentText(projection.projectionId) || null;
  const projectionKind = normalizeNimiRuntimeAgentText(projection.projectionKind) || null;
  const mode = formatProactiveAutonomyMode(projection.mode);
  const optInState = formatNimiRuntimeAgentProactiveOptInState(projection.optInState);
  const deliveryChannel = formatNimiRuntimeAgentProactiveDeliveryChannel(projection.deliveryChannel);
  const quietHoursState = formatNimiRuntimeAgentProactiveQuietHoursState(projection.quietHours);
  const frequencyCapState = formatNimiRuntimeAgentProactiveFrequencyCapState(projection.frequencyCap);
  const suggestedEvent = projectNimiRuntimeAgentProactiveEvent(projection.suggestedEvent);
  const lastDeliveredEvent = projectNimiRuntimeAgentProactiveEvent(projection.lastDeliveredEvent);
  const lastSuppressedEvent = projectNimiRuntimeAgentProactiveEvent(projection.lastSuppressedEvent);
  const auditRefs = uniqueNonEmptyRuntimeAgentTexts(projection.auditRefs);
  const unsupportedFields = new Set<string>(uniqueNonEmptyRuntimeAgentTexts(projection.unsupportedFields));

  for (const [field, value] of [
    ['projection_id', projectionId],
    ['projection_kind', projectionKind],
    ['mode', mode],
    ['opt_in_state', optInState],
    ['delivery_channel', deliveryChannel],
    ['quiet_hours', quietHoursState],
    ['frequency_cap', frequencyCapState],
  ] as const) {
    if (!value) {
      unsupportedFields.add(field);
    }
  }
  if (auditRefs.length === 0) {
    unsupportedFields.add('audit_refs');
  }
  if (!suggestedEvent && !lastDeliveredEvent && !lastSuppressedEvent) {
    unsupportedFields.add('event');
  }

  return {
    projectionId,
    projectionKind,
    mode,
    optInState,
    deliveryChannel,
    quietHoursState,
    frequencyCapState,
    suggestedEvent,
    lastDeliveredEvent,
    lastSuppressedEvent,
    auditRefs,
    unsupportedFields: [...unsupportedFields],
  };
}
