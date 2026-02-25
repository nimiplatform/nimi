import type { LocalAiProviderHints } from '../../execution/types';

type LocalHints = NonNullable<LocalAiProviderHints['localai']>;

function asLocalHints(providerHints?: LocalAiProviderHints): LocalHints {
  return providerHints?.localai || {};
}

export function mapLocalAiNativeSttProviderParams(input: {
  providerHints?: LocalAiProviderHints;
}): Record<string, string> {
  const local = asLocalHints(input.providerHints);
  const params: Record<string, string> = {};
  const backend = String(local.backend || '').trim();
  const whisperVariant = String(local.whisperVariant || '').trim();

  if (backend) {
    params.backend = backend;
  }
  if (whisperVariant) {
    params.whisper_variant = whisperVariant;
  }
  return params;
}

export function mapLocalAiNativeImagePayload(input: {
  prompt: string;
  model?: string;
  size?: string;
  n?: number;
  providerHints?: LocalAiProviderHints;
}): Record<string, unknown> {
  const local = asLocalHints(input.providerHints);
  const payload: Record<string, unknown> = {
    prompt: String(input.prompt || '').trim(),
  };

  const model = String(input.model || '').trim();
  const size = String(input.size || '').trim();
  if (model) payload.model = model;
  if (size) payload.size = size;
  if (Number.isFinite(input.n) && Number(input.n) > 0) {
    payload.n = Math.floor(Number(input.n));
  }

  const backend = String(local.backend || '').trim();
  const pipeline = String(local.stablediffusionPipeline || '').trim();
  if (backend) payload.backend = backend;
  if (pipeline) payload.pipeline = pipeline;

  return payload;
}

export function mapLocalAiNativeVideoPayload(input: {
  prompt: string;
  model?: string;
  durationSeconds?: number;
  providerHints?: LocalAiProviderHints;
}): Record<string, unknown> {
  const local = asLocalHints(input.providerHints);
  const payload: Record<string, unknown> = {
    prompt: String(input.prompt || '').trim(),
  };

  const model = String(input.model || '').trim();
  if (model) payload.model = model;
  if (Number.isFinite(input.durationSeconds) && Number(input.durationSeconds) > 0) {
    payload.duration_seconds = Math.floor(Number(input.durationSeconds));
  }

  const backend = String(local.backend || local.videoBackend || '').trim();
  const videoBackend = String(local.videoBackend || '').trim();
  if (backend) payload.backend = backend;
  if (videoBackend) payload.video_backend = videoBackend;

  return payload;
}
