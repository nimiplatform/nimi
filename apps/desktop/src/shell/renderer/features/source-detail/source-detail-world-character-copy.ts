import { Converter } from 'opencc-js/t2cn';

const toSimplifiedChinese = Converter({ from: 'tw', to: 'cn' });

// The stored projection keeps its authored spelling and identity. Convert only
// reader-facing text for Desktop's zh (Simplified Chinese) locale, after the
// source-based grouping and relation-only copy have been resolved.
export function sourceDetailDisplayText(value: string, locale: string): string {
  return locale === 'zh' ? toSimplifiedChinese(value) : value;
}

// Remove only the producer's exact relation-only sentences when explicit
// names and the relation are already displayed. Authored detail, uncertainty,
// chronology and source spelling remain intact; prose never supplies identity.
export function relationshipDetailCopy(
  summary: string | null | undefined,
  sourceName: string,
  targetName: string,
  type: string | null,
): string | null {
  if (!summary) return null;
  const relationOnly: Record<string, string[]> = {
    postedAddress: [`${sourceName}任官或活动记录关联地点「${targetName}」。`],
    biogAddress: [`${sourceName}与地点「${targetName}」有关。`],
    status: [`${sourceName}与身份「${targetName}」有关。`],
    entry: [`${sourceName}与入仕记录「${targetName}」有关。`],
    postedToOffice: [`${sourceName}曾任或关联官职：${targetName}。`],
    text: [`${sourceName}与著作「${targetName}」有关。`],
  };
  return summary === targetName || relationOnly[type ?? '']?.includes(summary.trim()) ? null : summary;
}

// Some relation-only references have no available book entity. Abbreviate the
// producer's complete sentence for the related bibliography, without promoting
// the clue to a resolved work, assigning authorship, or deriving its identity.
export function abbreviatedWorkReference(summary: string | null | undefined, sourceName: string): string | null {
  const prefix = `${sourceName}与著作「`;
  const suffix = '」有关。';
  if (!summary?.startsWith(prefix) || !summary.endsWith(suffix)) return null;
  const reference = summary.slice(prefix.length, -suffix.length).trim();
  return reference && !/[「」\n\r]/u.test(reference) ? reference : null;
}
