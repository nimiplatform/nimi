/**
 * Deterministic client-side safety filter for ParentOS AI output.
 *
 * Fail-close: if a response contains banned diagnostic, medication, or anxiety
 * wording, discard the original text and show the structured fallback instead.
 */

interface BannedTermRule {
  label: string;
  pattern: RegExp;
}

const BANNED_TERM_RULES: readonly BannedTermRule[] = [
  { label: '发育迟缓', pattern: /发育迟缓|發育遲緩/u },
  { label: '异常', pattern: /异常(?!值)|異常(?!值)/u },
  { label: '障碍', pattern: /障碍|障礙/u },
  { label: '应该', pattern: /应该|應該/u },
  { label: '应该吃', pattern: /应该吃|應該吃/u },
  { label: '建议用药', pattern: /建议用药|建議用藥/u },
  { label: '建议服用', pattern: /建议服用|建議服用/u },
  { label: '建议治疗', pattern: /建议治疗|建議治療/u },
  { label: '推荐治疗', pattern: /推荐治疗|推薦治療/u },
  { label: '落后', pattern: /落后|落後/u },
  { label: '危险', pattern: /危险|危險/u },
  { label: '警告', pattern: /警告/u },
] as const;

export const BANNED_TERMS: readonly string[] = BANNED_TERM_RULES.map((rule) => rule.label);

function findTriggeredRule(text: string) {
  return BANNED_TERM_RULES.find((rule) => rule.pattern.test(text)) ?? null;
}

export function containsBannedTerm(text: string): boolean {
  return findTriggeredRule(text) !== null;
}

export interface SafetyFilterResult {
  safe: boolean;
  filtered: string;
  triggeredTerm: string | null;
}

const FALLBACK_MESSAGE =
  '回答包含不适当的表述，已被系统过滤。建议咨询专业人士获取更详细的信息。';

export function filterAIResponse(text: string): SafetyFilterResult {
  const triggeredRule = findTriggeredRule(text);
  if (triggeredRule) {
    return { safe: false, filtered: FALLBACK_MESSAGE, triggeredTerm: triggeredRule.label };
  }

  return { safe: true, filtered: text, triggeredTerm: null };
}
