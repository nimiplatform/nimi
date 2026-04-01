/**
 * choice-parser.ts — SJ-DIAL-005
 * Parses structured A/B choices from assistant output.
 * Crisis scenes require choices; non-crisis scenes are narrative-only.
 */
import type { ParsedChoices, Choice, SceneType } from './types.js';

// Matches "A. text", "**A.** text", "A：text", "A、text"
const LETTERED_CHOICE_RE = /(?:^|\n)\s*\*{0,2}([A-C])[.·：。、]\s*\*{0,2}\s*(.+?)(?=(?:\n\s*\*{0,2}[A-C][.·：。、])|$)/gs;

// Matches "选A：text", "选A: text"
const XUANZE_RE = /选([A-C])[：:]\s*(.+?)(?=选[A-C][：:]|\n\n|$)/gs;

// Consequence separator: "|" or "→" or "（后果："
const CONSEQUENCE_RE = /[|→](.+)$|（后果[：:](.+)）/;

function extractConsequence(text: string): { main: string; consequence: string } {
  const match = CONSEQUENCE_RE.exec(text);
  if (!match) return { main: text.trim(), consequence: '' };
  const consequence = (match[1] ?? match[2] ?? '').trim();
  const main = text.slice(0, match.index).trim();
  return { main, consequence };
}

function runPattern(pattern: RegExp, text: string): Choice[] {
  pattern.lastIndex = 0;
  const choices: Choice[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const label = (match[1] ?? '').toUpperCase();
    const raw = (match[2] ?? '').trim();
    if (!label || !raw) continue;
    const { main, consequence } = extractConsequence(raw);
    choices.push({ key: label, label, description: main, consequencePreview: consequence });
  }
  return choices;
}

/**
 * parseChoices — extracts A/B choices from AI output.
 * Returns ParsedChoices with isCrisisScene flag.
 * Empty choices in a non-crisis scene is valid (narrative-only turn).
 */
export function parseChoices(assistantText: string, sceneType: SceneType): ParsedChoices {
  const isCrisisScene = sceneType === 'crisis';

  // Try lettered pattern first
  let choices = runPattern(LETTERED_CHOICE_RE, assistantText);

  // Fall back to 选A pattern
  if (choices.length < 2) {
    const fallback = runPattern(XUANZE_RE, assistantText);
    if (fallback.length >= choices.length) choices = fallback;
  }

  // Deduplicate by key
  const seen = new Set<string>();
  const deduped = choices.filter((c) => {
    if (seen.has(c.key)) return false;
    seen.add(c.key);
    return true;
  });

  return { choices: deduped, isCrisisScene };
}
