import type { ScenarioOutput } from '../runtime/generated/runtime/v1/ai.js';
import { createNimiError } from '../runtime/errors.js';
import { ReasonCode } from '../types/index.js';
import { normalizeText } from './utils.js';

export function extractGenerateText(output: unknown): string {
  const value = output as ScenarioOutput | undefined;
  const variant = value?.output;
  if (variant?.oneofKind === 'textGenerate') {
    return normalizeText(variant.textGenerate.text);
  }
  throw createNimiError({
    message: 'runtime media output missing typed textGenerate result',
    reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    actionHint: 'regenerate_runtime_proto_and_sdk',
    source: 'runtime',
  });
}
