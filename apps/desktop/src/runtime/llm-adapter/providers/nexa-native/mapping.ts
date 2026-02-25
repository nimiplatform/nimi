import type { LocalAiProviderHints } from '../../execution/types';

type NexaHints = NonNullable<LocalAiProviderHints['nexa']>;

function asNexaHints(providerHints?: LocalAiProviderHints): NexaHints {
  return providerHints?.nexa || {};
}

function normalizePositiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function attachNexaCommonHints(
  payload: Record<string, unknown>,
  providerHints?: LocalAiProviderHints,
): Record<string, unknown> {
  const nexa = asNexaHints(providerHints);
  const backend = String(nexa.backend || '').trim();
  const pluginId = String(nexa.pluginId || '').trim();
  const deviceId = String(nexa.deviceId || '').trim();
  const modelType = String(nexa.modelType || '').trim();
  const npuMode = String(nexa.npuMode || '').trim();

  if (backend) payload.backend = backend;
  if (pluginId) payload.plugin_id = pluginId;
  if (deviceId) payload.device_id = deviceId;
  if (modelType) payload.model_type = modelType;
  if (npuMode) payload.npu_mode = npuMode;
  return payload;
}

export function mapNexaNativeRerankPayload(input: {
  query: string;
  documents: string[];
  model?: string;
  topN?: number;
  providerHints?: LocalAiProviderHints;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    query: String(input.query || '').trim(),
    documents: (Array.isArray(input.documents) ? input.documents : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean),
  };
  const model = String(input.model || '').trim();
  const topN = normalizePositiveInt(input.topN);
  if (model) payload.model = model;
  if (topN) payload.top_n = topN;
  return attachNexaCommonHints(payload, input.providerHints);
}

export function mapNexaNativeCvPayload(input: {
  task: string;
  imageUri?: string;
  imageBase64?: string;
  model?: string;
  providerHints?: LocalAiProviderHints;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    task: String(input.task || '').trim(),
  };
  const imageUri = String(input.imageUri || '').trim();
  const imageBase64 = String(input.imageBase64 || '').trim();
  const model = String(input.model || '').trim();
  if (model) payload.model = model;
  if (imageUri) payload.image_uri = imageUri;
  if (imageBase64) payload.image_base64 = imageBase64;
  return attachNexaCommonHints(payload, input.providerHints);
}

export function mapNexaNativeDiarizePayload(input: {
  audioUri?: string;
  audioBase64?: string;
  mimeType?: string;
  model?: string;
  providerHints?: LocalAiProviderHints;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const audioUri = String(input.audioUri || '').trim();
  const audioBase64 = String(input.audioBase64 || '').trim();
  const mimeType = String(input.mimeType || '').trim();
  const model = String(input.model || '').trim();
  if (model) payload.model = model;
  if (audioUri) payload.audio_uri = audioUri;
  if (audioBase64) payload.audio_base64 = audioBase64;
  if (mimeType) payload.mime_type = mimeType;
  return attachNexaCommonHints(payload, input.providerHints);
}
