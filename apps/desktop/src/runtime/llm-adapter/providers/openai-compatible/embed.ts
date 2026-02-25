import { normalizeOpenAICompatibleEndpoint } from './request';

type OpenAICompatibleEmbeddingInput = {
  endpoint: string;
  model: string;
  input: string | string[];
  apiKey?: string;
  abortSignal?: AbortSignal;
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
};

type OpenAICompatibleEmbeddingResponse = {
  data?: Array<{ embedding?: unknown }>;
};

function normalizeEmbeddingInput(input: string | string[]): string[] {
  const values = Array.isArray(input) ? input : [input];
  return values
    .map((value) => String(value || '').trim())
    .filter((value) => value.length > 0);
}

function assertEmbeddingVector(value: unknown, index: number): number[] {
  if (!Array.isArray(value)) {
    throw new Error(`PLAY_PROVIDER_UNAVAILABLE: embedding vector ${index} is invalid`);
  }

  const vector = value.map((item) => Number(item));
  if (vector.length === 0 || vector.some((item) => !Number.isFinite(item))) {
    throw new Error(`PLAY_PROVIDER_UNAVAILABLE: embedding vector ${index} contains invalid numbers`);
  }

  return vector;
}

function trimErrorBody(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return normalized.length > 200 ? `${normalized.slice(0, 200)}...` : normalized;
}

export async function invokeOpenAICompatibleEmbedding(
  input: OpenAICompatibleEmbeddingInput,
): Promise<number[][]> {
  const endpoint = normalizeOpenAICompatibleEndpoint(String(input.endpoint || '').trim());
  if (!endpoint) {
    throw new Error('PLAY_PROVIDER_UNAVAILABLE: embedding endpoint required');
  }

  const model = String(input.model || '').trim();
  if (!model) {
    throw new Error('PLAY_PROVIDER_UNAVAILABLE: embedding model required');
  }

  const values = normalizeEmbeddingInput(input.input);
  if (values.length === 0) {
    throw new Error('PLAY_PROVIDER_UNAVAILABLE: embedding input required');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const apiKey = String(input.apiKey || '').trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await input.fetchImpl(`${endpoint}/embeddings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      input: values.length === 1 ? values[0] : values,
    }),
    signal: input.abortSignal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `PLAY_PROVIDER_UNAVAILABLE: embedding request failed HTTP_${response.status} ${trimErrorBody(body)}`,
    );
  }

  const payload = (await response.json()) as OpenAICompatibleEmbeddingResponse;
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  if (rows.length === 0) {
    throw new Error('PLAY_PROVIDER_UNAVAILABLE: embedding response missing data');
  }

  return rows.map((row, index) => assertEmbeddingVector(row?.embedding, index));
}
