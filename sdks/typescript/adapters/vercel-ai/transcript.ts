import type { LanguageModelV3Content, SharedV3ProviderMetadata, SharedV3ProviderOptions } from '@ai-sdk/provider';
import type { NimiTextOutputItem, NimiTextTurnItem } from '@nimiplatform/sdk/contracts';
import { createNimiError } from '@nimiplatform/sdk';

type Carrier = Extract<NimiTextOutputItem, { type: 'reasoning-continuity' }>['carrier'];
type EncodedCarrier = { kind: string; version: number; payload: string };
type Relay = { transcriptVersion: 1; before: EncodedCarrier[]; after: EncodedCarrier[] };

function invalid(detail: string): never {
  throw createNimiError({ code: 'SDK_ADAPTER_TRANSCRIPT_INVALID', reasonCode: 'SDK_ADAPTER_TRANSCRIPT_INVALID', message: detail, actionHint: 'preserve_nimi_provider_metadata', source: 'sdk' });
}

function encode(carrier: Carrier): EncodedCarrier {
  if (!(carrier.payload instanceof Uint8Array) || !carrier.payload.length || carrier.payload.length > 64 * 1024) invalid('Invalid opaque continuity payload.');
  let binary = '';
  for (let index = 0; index < carrier.payload.length; index += 8192) binary += String.fromCharCode(...carrier.payload.subarray(index, index + 8192));
  return { kind: carrier.kind, version: carrier.version, payload: btoa(binary) };
}

function decode(value: unknown): Carrier {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Invalid continuity metadata.');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['kind', 'version', 'payload'].includes(key)) || typeof record.kind !== 'string' || !record.kind || record.kind.trim() !== record.kind
    || !Number.isSafeInteger(record.version) || Number(record.version) < 1 || Number(record.version) > 0xffffffff || typeof record.payload !== 'string' || record.payload.length > 87384) return invalid('Invalid continuity metadata.');
  let binary: string;
  try { binary = atob(record.payload); } catch { return invalid('Invalid continuity encoding.'); }
  if (!binary.length || binary.length > 64 * 1024) return invalid('Invalid continuity size.');
  return { kind: record.kind, version: Number(record.version), payload: Uint8Array.from(binary, (character) => character.charCodeAt(0)) };
}

function relay(options: SharedV3ProviderOptions | undefined): Relay | undefined {
  const data = options?.nimi;
  if (!data) return undefined;
  if (data.transcriptVersion !== 1 || !Array.isArray(data.before) || !Array.isArray(data.after)
    || Object.keys(data).some((key) => !['transcriptVersion', 'before', 'after'].includes(key))) return invalid('Nimi transcript metadata is incomplete or from an unsupported version.');
  return data as unknown as Relay;
}

export function withContinuity(output: NimiTextOutputItem, options?: SharedV3ProviderOptions): NimiTextTurnItem[] {
  const metadata = relay(options);
  const items = (values: readonly unknown[]): NimiTextTurnItem[] => values.map((value) => ({ type: 'output', output: { type: 'reasoning-continuity', carrier: decode(value) } }));
  return [...items(metadata?.before ?? []), { type: 'output', output }, ...items(metadata?.after ?? [])];
}

export function withoutCallContinuity(options?: SharedV3ProviderOptions): SharedV3ProviderOptions | undefined {
  if (!options?.nimi) return options;
  relay(options);
  // Vercel may copy call metadata onto a caller tool result. The encrypted
  // items belong to the assistant call and must be replayed exactly once.
  const { nimi: _nimi, ...rest } = options;
  return Object.keys(rest).length ? rest : undefined;
}

// @nimi-authority: rule.nimi.sdks.feature-clients.r005
export function canonicalVercelContent(items: readonly NimiTextOutputItem[]): LanguageModelV3Content[] {
  const result: LanguageModelV3Content[] = [];
  let before: EncodedCarrier[] = [];
  let lastRelay: Relay | undefined;
  for (const item of items) {
    if (item.type === 'reasoning-continuity') {
      if (lastRelay) lastRelay.after.push(encode(item.carrier));
      else before.push(encode(item.carrier));
      continue;
    }
    const metadata: Relay = { transcriptVersion: 1, before, after: [] };
    before = [];
    const providerMetadata = { nimi: metadata } as unknown as SharedV3ProviderMetadata;
    if (item.type === 'text') result.push({ type: 'text', text: item.text, providerMetadata });
    else if (item.type === 'reasoning-summary') result.push({ type: 'reasoning', text: item.text, providerMetadata });
    else if (item.type === 'tool-call') {
      result.push({ type: 'tool-call', toolCallId: item.toolCall.id, toolName: item.toolCall.name, input: JSON.stringify(item.toolCall.arguments), providerMetadata });
    } else return invalid('Unsupported ordered model output.');
    lastRelay = metadata;
  }
  if (!result.some((part) => part.type === 'text' || part.type === 'tool-call')) return invalid('A model step requires primary output.');
  for (const part of result) {
    const metadata = part.providerMetadata?.nimi as unknown as Relay | undefined;
    if (metadata && !metadata.before.length && !metadata.after.length) delete part.providerMetadata;
  }
  return result;
}
