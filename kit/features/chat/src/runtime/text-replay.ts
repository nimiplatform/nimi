import type { NimiAIConfigEffectiveSelection, NimiTextReplayCompatibility } from '@nimiplatform/kit/core/sdk-contract';
import type { AppAiChatMessage } from '../runtime.js';
import { validateNimiLocalAppReasoningContinuityCarrier } from '@nimiplatform/kit/core/sdk-contract';
import type { ConversationTurnHistoryMessage } from '../orchestration/contracts.js';
import { toAssistantTurnItems } from './assistant-output.js';

export type ConversationTextReplayPlan<T> = {
  readonly history: readonly T[];
  /** Index in the original history; persist it with that history. */
  readonly contextStart: number;
  readonly continuity: 'retained' | 'reset';
};

// @nimi-authority: rule.nimi.sdks.feature-clients.local-app-text-behaviors
/**
 * Construct the new request projection after the App's explicit model change.
 * Source messages/carriers stay untouched. A prior reset remains in force when
 * the user switches back; discarded reasoning is never resurrected implicitly.
 * Missing compatibility is unconfirmed, not an empty acceptance list.
 */
export function planConversationTextReplay<T extends ConversationTurnHistoryMessage>(input: {
  readonly history: readonly T[];
  readonly compatibility: NimiTextReplayCompatibility | undefined;
  readonly contextStart?: number;
  readonly executionMode?: 'sync' | 'stream';
}): ConversationTextReplayPlan<T> {
  const start = input.contextStart ?? 0;
  if (!Number.isSafeInteger(start) || start < 0 || start > input.history.length) throw new Error('Invalid conversation inference-context boundary.');
  const mode = input.executionMode ?? 'stream';
  if (mode !== 'sync' && mode !== 'stream') throw new Error('Unsupported text replay execution mode.');
  let incompatible = false;
  for (const message of input.history.slice(start)) {
    if (!message.outputItems) continue;
    // Validate source transcript before projecting it. A reset cannot hide a
    // damaged record or manufacture visible text from malformed opaque data.
    toAssistantTurnItems(message.text, message.outputItems);
    for (const item of message.outputItems) {
      if (item.type !== 'reasoning-continuity') continue;
      if (!input.compatibility) throw new Error('Text replay compatibility is unavailable. Refresh the model selection before continuing.');
      incompatible ||= !input.compatibility.acceptedCarriers.some((format) => format.kind === item.kind
        && format.version === item.version && format.executionModes.includes(mode));
    }
  }
  const contextStart = incompatible ? input.history.length : start;
  const history = input.history.map((message, index) => {
    if (index >= contextStart || !message.outputItems) return message;
    toAssistantTurnItems(message.text, message.outputItems);
    return { ...message, outputItems: message.outputItems.filter((item) => item.type === 'text') };
  });
  return { history, contextStart, continuity: incompatible ? 'reset' : 'retained' };
}

// @nimi-authority: rule.nimi.sdks.feature-clients.local-app-text-behaviors
/**
 * The same explicit request projection for a Host's common transcript. Tool
 * calls/results remain inert history; this helper executes nothing. The Host
 * must settle its own effects before using it. Unsupported historical images
 * fail with an action instead of being silently omitted from the new context.
 */
export function planAppAiChatReplay(input: {
  readonly history: readonly AppAiChatMessage[];
  readonly selection: NimiAIConfigEffectiveSelection;
  readonly contextStart?: number;
  readonly executionMode?: 'sync' | 'stream';
}): ConversationTextReplayPlan<AppAiChatMessage> {
  const { selection } = input;
  if (selection.capabilityContract !== 'text.generate' || selection.state !== 'ready') throw new Error('The text model is unavailable. Review the model configuration.');
  const features = selection.resource?.oneofKind === 'local' ? selection.resource.local.configuredFeatures
    : selection.resource?.oneofKind === 'cloud' ? selection.resource.cloud.target.supportedFeatures : [];
  const hasMedia = input.history.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type !== 'text'));
  if (hasMedia && !features.includes('input.image')) throw new Error('This model cannot accept the historical images. Choose an image-capable model or explicitly start a separate text-only conversation; the original media is preserved.');
  const mode = input.executionMode ?? 'stream';
  if (mode !== 'sync' && mode !== 'stream') throw new Error('Unsupported text replay execution mode.');
  const start = input.contextStart ?? 0;
  if (!Number.isSafeInteger(start) || start < 0 || start > input.history.length) throw new Error('Invalid conversation inference-context boundary.');
  let incompatible = false;
  const accepts = (kind: string, version: number) => {
    if (!selection.textReplay) throw new Error('Text replay compatibility is unavailable. Refresh the model selection before continuing.');
    return selection.textReplay.acceptedCarriers.some((format) => format.kind === kind && format.version === version && format.executionModes.includes(mode));
  };
  for (const [index, message] of input.history.entries()) {
    if (message.outputItems) {
      const text = typeof message.content === 'string' ? message.content : message.content.map((part) => part.type === 'text' ? part.text : '').join('');
      toAssistantTurnItems(text, message.outputItems);
    }
    for (const item of message.outputItems ?? []) if (index >= start && item.type === 'reasoning-continuity') incompatible ||= !accepts(item.kind, item.version);
    for (const item of message.turnItems ?? []) if (item.type === 'output' && item.output.type === 'reasoning-continuity') {
      const carrier = item.output.carrier;
      validateNimiLocalAppReasoningContinuityCarrier({ ...carrier, payload: Array.from(carrier.payload) });
      if (index >= start) incompatible ||= !accepts(carrier.kind, carrier.version);
    }
  }
  const contextStart = incompatible ? input.history.length : start;
  return {
    contextStart, continuity: incompatible ? 'reset' : 'retained',
    history: input.history.map((message, index) => index >= contextStart ? message : {
      ...message,
      ...(message.outputItems ? { outputItems: message.outputItems.filter((item) => item.type === 'text') } : {}),
      ...(message.turnItems ? { turnItems: message.turnItems.filter((item) => item.type !== 'output' || (item.output.type !== 'reasoning-continuity' && item.output.type !== 'reasoning-summary')) } : {}),
    }),
  };
}
