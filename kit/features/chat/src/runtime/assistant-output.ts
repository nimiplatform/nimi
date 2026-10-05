import type {
  NimiTextOutputItem,
  NimiTextTurnItem,
} from '@nimiplatform/kit/core/sdk-contract';
import type { ConversationAssistantOutputItem } from '../orchestration/contracts.js';

type ContinuityCarrier = Extract<NimiTextOutputItem, { readonly type: 'reasoning-continuity' }>['carrier'];

// The shared SDK bounds for one opaque carrier; 64 KiB is 87,384 base64 characters.
const MAX_CONTINUITY_KIND_BYTES = 128;
const MAX_CONTINUITY_PAYLOAD_BYTES = 64 * 1024;
const MAX_CONTINUITY_PAYLOAD_BASE64_CHARS = 87_384;

export type AssistantOutputCollector = {
  text: (text: string, itemIndex: number | undefined) => void;
  summary: (text: string, itemIndex: number) => void;
  continuity: (carrier: ContinuityCarrier, itemIndex: number) => void;
  /** The ordered items when the turn returned continuity, otherwise undefined. */
  complete: () => readonly ConversationAssistantOutputItem[] | undefined;
};

// @nimi-authority: rule.nimi.sdks.feature-clients.local-app-text-behaviors
/**
 * Collects one assistant turn's ordered final text and opaque reasoning
 * continuity carriers, so that the session owner can store the turn and replay
 * it unmodified, including authorized summaries as separate output items.
 */
export function createAssistantOutputCollector(): AssistantOutputCollector {
  const items = new Map<number, ConversationAssistantOutputItem>();
  let unorderedText = false;
  let continuity = false;
  return {
    text(text, itemIndex) {
      if (itemIndex === undefined) {
        unorderedText ||= text.length > 0;
        return;
      }
      const current = items.get(itemIndex);
      if (current && current.type !== 'text') {
        throw new Error('model output reused one ordered item index for text and reasoning continuity');
      }
      items.set(itemIndex, { type: 'text', text: `${current?.text ?? ''}${text}` });
    },
    summary(text, itemIndex) {
      const current = items.get(itemIndex);
      if (current && current.type !== 'reasoning-summary') throw new Error('model output reused a summary item index');
      items.set(itemIndex, { type: 'reasoning-summary', text: `${current?.text ?? ''}${text}` });
      continuity = true;
    },
    continuity(carrier, itemIndex) {
      if (items.has(itemIndex)) {
        throw new Error('model output reused one ordered item index for reasoning continuity');
      }
      const item: ConversationAssistantOutputItem = {
        type: 'reasoning-continuity',
        kind: carrier.kind,
        version: carrier.version,
        payloadBase64: carrier.payload instanceof Uint8Array ? encodeBase64(carrier.payload) : '',
      };
      toNimiOutputItem(item);
      items.set(itemIndex, item);
      continuity = true;
    },
    complete() {
      if (!continuity) {
        return undefined;
      }
      if (unorderedText) {
        throw new Error('model output mixed reasoning continuity with text outside the ordered item sequence');
      }
      const ordered = [...items.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, item]) => item)
        .filter((item) => item.type === 'reasoning-continuity' || item.text.length > 0);
      for (let index = 0; index < items.size; index += 1) if (!items.has(index)) throw new Error('model output skipped an ordered item index');
      let bytes = 0;
      for (const item of ordered) {
        const projected = toNimiOutputItem(item);
        bytes += projected.type === 'reasoning-continuity' ? projected.carrier.payload.byteLength : 'text' in projected ? new TextEncoder().encode(projected.text).byteLength : 0;
      }
      if (bytes > 256 * 1024) throw new Error('model output exceeds the shared text output budget');
      if (!ordered.some((item) => item.type === 'text')) {
        throw new Error('model output returned reasoning continuity without final text');
      }
      return ordered;
    },
  };
}

// @nimi-authority: rule.nimi.sdks.feature-clients.local-app-text-behaviors
/**
 * The canonical transcript of one assistant history message: its stored
 * ordered output returned unmodified, or its visible text as one text item.
 * Stored output whose text differs from the visible text fails closed, since
 * replaying it would send the model a turn the user never saw.
 */
export function toAssistantTurnItems(
  text: string,
  outputItems: readonly ConversationAssistantOutputItem[] | undefined,
): NimiTextTurnItem[] {
  if (!outputItems || outputItems.length === 0) {
    return [{ type: 'output', output: { type: 'text', text } }];
  }
  const turnItems = outputItems.map((item): NimiTextTurnItem => ({ type: 'output', output: toNimiOutputItem(item) }));
  const replayedText = outputItems.map((item) => item.type === 'text' ? item.text : '').join('');
  if (!outputItems.some((item) => item.type === 'text') || replayedText.trim() !== text.trim()) {
    throw new Error('assistant history outputItems must hold the message text unchanged; drop them when the text changes');
  }
  return turnItems;
}

function toNimiOutputItem(item: ConversationAssistantOutputItem): NimiTextOutputItem {
  if (item?.type === 'text' || item?.type === 'reasoning-summary') {
    if (typeof item.text !== 'string' || item.text.length === 0) {
      throw new Error('assistant history text item must be non-empty');
    }
    return { type: item.type, text: item.text };
  }
  if (item?.type !== 'reasoning-continuity') {
    throw new Error('assistant history outputItems admit only text and reasoning-continuity items');
  }
  const { kind, version, payloadBase64 } = item;
  if (typeof kind !== 'string' || !kind || kind !== kind.trim() || /[\u0000-\u001f\u007f]/u.test(kind)
    || new TextEncoder().encode(kind).byteLength > MAX_CONTINUITY_KIND_BYTES
    || !Number.isSafeInteger(version) || version < 1 || version > 0xffff_ffff
    || typeof payloadBase64 !== 'string' || !payloadBase64
    || payloadBase64.length > MAX_CONTINUITY_PAYLOAD_BASE64_CHARS) {
    throw new Error('reasoning continuity carrier identity or bounded payload is invalid');
  }
  const payload = decodeBase64(payloadBase64);
  if (!payload || payload.byteLength === 0 || payload.byteLength > MAX_CONTINUITY_PAYLOAD_BYTES
    || encodeBase64(payload) !== payloadBase64) {
    throw new Error('reasoning continuity carrier payload is not canonical bounded base64');
  }
  return { type: 'reasoning-continuity', carrier: { kind, version, payload } };
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.byteLength; index += 8192) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}
