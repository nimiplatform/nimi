import type { ScenarioOutput } from '../runtime/generated/runtime/v1/ai.js';
import { normalizeText } from './utils.js';

export function extractGenerateText(output: unknown): string {
  const value = output as ScenarioOutput | undefined;
  const variant = value?.output;
  if (variant?.oneofKind === 'textGenerate') {
    return normalizeText(variant.textGenerate.text);
  }
  return '';
}
