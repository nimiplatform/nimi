// Pure-logic aggregate summary for the AI Model hub header.
//
// Replaces desktop-local summarizeAiModelAggregate; derives counts from the
// canonical capability catalog and enabled capability evaluations, so that
// every consumer projects the same aggregate tone/label taxonomy.

import type {
  CanonicalCapabilityDescriptor,
} from '@nimiplatform/nimi-kit/core/runtime-capabilities';
import type {
  AggregateCountsLabels,
  AggregateSummary,
  CapabilityEvaluation,
  ModelConfigStatusTone,
} from './types.js';

function formatCount(template: string, count: number): string {
  return template.replace('{{count}}', String(count));
}

function deriveTone(evaluation: CapabilityEvaluation): ModelConfigStatusTone {
  if (evaluation.status?.tone) {
    return evaluation.status.tone;
  }
  if (evaluation.status?.supported === true) {
    return 'ready';
  }
  if (evaluation.status?.supported === false) {
    return 'attention';
  }
  return evaluation.bindingPresent ? 'ready' : 'neutral';
}

/**
 * Aggregate tone summary across the given capability evaluations.
 * Counts each capability once by canonical capabilityId, preserving order of
 * the input array for deterministic subtitle composition.
 */
export function summarizeAiModelAggregate(
  evaluations: ReadonlyArray<CapabilityEvaluation>,
  labels: AggregateCountsLabels,
): AggregateSummary {
  let ready = 0;
  let attention = 0;
  let neutral = 0;
  for (const evaluation of evaluations) {
    const tone = deriveTone(evaluation);
    if (tone === 'ready') ready += 1;
    else if (tone === 'attention') attention += 1;
    else neutral += 1;
  }
  const parts: string[] = [];
  if (ready > 0) parts.push(formatCount(labels.ready, ready));
  if (attention > 0) parts.push(formatCount(labels.attention, attention));
  if (neutral > 0 && ready === 0 && attention === 0) {
    parts.push(formatCount(labels.neutral, neutral));
  }
  const statusDot: ModelConfigStatusTone = attention > 0
    ? 'attention'
    : ready > 0
      ? 'ready'
      : 'neutral';
  return {
    subtitle: parts.join(' · '),
    statusDot,
    readyCount: ready,
    attentionCount: attention,
    neutralCount: neutral,
  };
}

/**
 * Filter a canonical descriptor set down to the subset enabled by an app.
 * Unknown capability ids are dropped rather than silently admitted; callers
 * that need strict validation should assert before calling this helper.
 */
export function selectEnabledDescriptors(
  enabledCapabilities: ReadonlyArray<string>,
  catalogById: Readonly<Record<string, CanonicalCapabilityDescriptor>>,
): ReadonlyArray<CanonicalCapabilityDescriptor> {
  const out: CanonicalCapabilityDescriptor[] = [];
  for (const capabilityId of enabledCapabilities) {
    const descriptor = catalogById[capabilityId];
    if (descriptor) {
      out.push(descriptor);
    }
  }
  return out;
}
