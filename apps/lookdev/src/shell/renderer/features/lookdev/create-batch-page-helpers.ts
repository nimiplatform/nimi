import type { TFunction } from 'i18next';
import type { RuntimeTargetOption } from '@renderer/app-shell/providers/app-store.js';
import type { LookdevAgentRecord } from '@renderer/data/lookdev-data-client.js';
import { buildCaptureSeedSignature } from './capture-harness.js';
import type { LookdevCaptureState, LookdevWorldStylePack } from './types.js';

export function portraitBriefKey(worldId: string | null | undefined, agentId: string): string {
  return `${String(worldId || 'unscoped').trim() || 'unscoped'}::${agentId}`;
}

export function formatWorldOptionLabel(name: string, agentCount: number | null): string {
  return typeof agentCount === 'number' ? `${name} · ${agentCount} agents` : name;
}

export function stripTargetKey(target: RuntimeTargetOption): Omit<RuntimeTargetOption, 'key'> {
  const { key: _ignored, ...snapshot } = target;
  return snapshot;
}

export function formatTargetOptionLabel(target: RuntimeTargetOption, localLabel: string): string {
  if (target.route === 'local') {
    return `${localLabel} / ${target.modelLabel || target.localModelId || target.modelId}`;
  }
  const connector = target.connectorLabel || target.provider || target.connectorId;
  const model = target.modelLabel || target.modelId;
  return `${connector} / ${model}`;
}

export function pickConfiguredRuntimeTargetKey(input: {
  targets: RuntimeTargetOption[];
  defaultTargetKey?: string;
  runtimeConnectorId?: string;
  runtimeProvider?: string;
  localModelId?: string;
}): string {
  const configuredConnectorTarget = input.targets.find((target) =>
    target.source === 'cloud'
    && input.runtimeConnectorId
    && target.connectorId === input.runtimeConnectorId);
  if (configuredConnectorTarget) {
    return configuredConnectorTarget.key;
  }
  const configuredProviderTarget = input.targets.find((target) =>
    target.source === 'cloud'
    && input.runtimeProvider
    && target.provider === input.runtimeProvider);
  if (configuredProviderTarget) {
    return configuredProviderTarget.key;
  }
  const configuredLocalTarget = input.targets.find((target) =>
    target.source === 'local'
    && input.localModelId
    && (target.localModelId === input.localModelId || target.modelId === input.localModelId || target.modelId === `local/${input.localModelId}`));
  if (configuredLocalTarget) {
    return configuredLocalTarget.key;
  }
  if (input.targets.some((target) => target.key === input.defaultTargetKey)) {
    return input.defaultTargetKey || '';
  }
  return input.targets[0]?.key || '';
}

export function isCurrentWorldStylePack(
  pack: LookdevWorldStylePack | null | undefined,
): pack is LookdevWorldStylePack {
  return Boolean(
    pack
    && typeof pack.language === 'string'
    && typeof pack.status === 'string'
    && typeof pack.summary === 'string'
    && typeof pack.seedSource === 'string'
    && Array.isArray(pack.forbiddenElements),
  );
}

export function withLookdevBatchAgentFields(
  agent: Omit<LookdevAgentRecord, 'description' | 'scenario' | 'greeting' | 'currentPortrait'>,
): LookdevAgentRecord {
  return {
    ...agent,
    description: null,
    scenario: null,
    greeting: null,
    currentPortrait: null,
  };
}

export function expectedCaptureStateSignature(input: {
  agent: Omit<LookdevAgentRecord, 'description' | 'scenario' | 'greeting' | 'currentPortrait'>;
  worldStylePack: LookdevWorldStylePack;
  captureMode: 'capture' | 'batch_only';
}): string {
  return buildCaptureSeedSignature({
    agent: {
      id: input.agent.id,
      displayName: input.agent.displayName,
      concept: input.agent.concept,
      description: null,
      worldId: input.agent.worldId,
      importance: input.agent.importance,
      existingPortraitUrl: null,
    },
    worldStylePack: input.worldStylePack,
    captureMode: input.captureMode,
  });
}

export function toErrorMessage(error: unknown, t: TFunction): string {
  const message = error instanceof Error ? error.message : String(error);
  switch (message) {
    case 'LOOKDEV_STYLE_SESSION_REPLY_REQUIRED':
      return t('createBatch.errorStyleSessionReplyRequired');
    case 'LOOKDEV_STYLE_DIALOGUE_TARGET_REQUIRED':
      return t('createBatch.errorStyleSessionTargetRequired');
    case 'LOOKDEV_STYLE_DIALOGUE_TRUNCATED':
      return t('createBatch.errorStyleSessionTruncated');
    case 'LOOKDEV_STYLE_JSON_EMPTY':
    case 'LOOKDEV_STYLE_JSON_OBJECT_REQUIRED':
    case 'LOOKDEV_STYLE_DIALOGUE_REPLY_REQUIRED':
    case 'LOOKDEV_STYLE_DIALOGUE_SUMMARY_REQUIRED':
      return t('createBatch.errorStyleSessionResponseInvalid');
    case 'LOOKDEV_STYLE_SYNTHESIS_INPUT_REQUIRED':
      return t('createBatch.errorStyleSessionInputRequired');
    case 'LOOKDEV_STYLE_SYNTHESIS_CONTRACT_INVALID':
      return t('createBatch.errorStylePackSynthesisInvalid');
    default:
      return message;
  }
}

export function filterReadyCaptureStates(
  entries: Array<LookdevCaptureState | null>,
): LookdevCaptureState[] {
  return entries.filter((state): state is LookdevCaptureState => state !== null);
}
