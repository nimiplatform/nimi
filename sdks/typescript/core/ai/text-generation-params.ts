export type NimiAITextGenerationParameterSet = {
  parameters: {
    temperature?: number;
    topP?: number;
    topK?: number;
    maxTokens?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
    stop?: string[];
  };
  timeoutMs?: number;
};

export type NimiAITextGenerationParamsCoercionResult =
  | { ok: true; value: NimiAITextGenerationParameterSet }
  | { ok: false; field: string; message: string };

type NimiAITextGenerationParamsCoercionError = Extract<
  NimiAITextGenerationParamsCoercionResult,
  { ok: false }
>;

/**
 * Coerces the standardized text.generate defaults exposed by the public
 * CapabilityContract. It does not interpret Driver configuration or bindings.
 */
export function coerceNimiAITextGenerationParams(
  defaults: unknown,
): NimiAITextGenerationParamsCoercionResult {
  const params = paramRecord(defaults);
  const temperature = optionalFiniteParam(params, 'temperature');
  if (isCoercionError(temperature)) return temperature;
  const topP = optionalFiniteParam(params, 'topP');
  if (isCoercionError(topP)) return topP;
  const topK = optionalPositiveIntegerParam(params, 'topK');
  if (isCoercionError(topK)) return topK;
  const maxTokens = optionalPositiveIntegerParam(params, 'maxTokens');
  if (isCoercionError(maxTokens)) return maxTokens;
  const presencePenalty = optionalFiniteParam(params, 'presencePenalty');
  if (isCoercionError(presencePenalty)) return presencePenalty;
  const frequencyPenalty = optionalFiniteParam(params, 'frequencyPenalty');
  if (isCoercionError(frequencyPenalty)) return frequencyPenalty;
  const timeoutMs = optionalPositiveIntegerParam(params, 'timeoutMs');
  if (isCoercionError(timeoutMs)) return timeoutMs;
  const stop = optionalStopSequences(params);
  if (isCoercionError(stop)) return stop;

  return {
    ok: true,
    value: {
      parameters: {
        ...(temperature !== undefined ? { temperature } : {}),
        ...(topP !== undefined ? { topP } : {}),
        ...(topK !== undefined ? { topK } : {}),
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(presencePenalty !== undefined ? { presencePenalty } : {}),
        ...(frequencyPenalty !== undefined ? { frequencyPenalty } : {}),
        ...(stop !== undefined ? { stop } : {}),
      },
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    },
  };
}

function paramRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function optionalFiniteParam(
  params: Record<string, unknown>,
  key: string,
): number | NimiAITextGenerationParamsCoercionError | undefined {
  const raw = params[key];
  const value = typeof raw === 'number' ? String(raw) : normalizeText(raw);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return { ok: false, field: key, message: `AIConfig defaults.${key} must be a finite number.` };
  }
  return parsed;
}

function optionalPositiveIntegerParam(
  params: Record<string, unknown>,
  key: string,
): number | NimiAITextGenerationParamsCoercionError | undefined {
  const parsed = optionalFiniteParam(params, key);
  if (parsed === undefined || typeof parsed === 'object') return parsed;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { ok: false, field: key, message: `AIConfig defaults.${key} must be a positive integer.` };
  }
  return parsed;
}

function optionalStopSequences(
  params: Record<string, unknown>,
): string[] | NimiAITextGenerationParamsCoercionError | undefined {
  const raw = params.stopSequences ?? params.stop;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      field: 'stopSequences',
      message: 'AIConfig defaults.stopSequences must be a string array.',
    };
  }
  const values = raw.map((entry) => normalizeText(entry)).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function isCoercionError(value: unknown): value is NimiAITextGenerationParamsCoercionError {
  return Boolean(value && typeof value === 'object' && 'ok' in value && value.ok === false);
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}
