import type { TemporalContext } from './types.js';

const TEMPORAL_PHRASES: Array<{ pattern: RegExp; days: number }> = [
  { pattern: /次日|翌日|第二天/, days: 1 },
  { pattern: /数日后|数天后/, days: 5 },
  { pattern: /三天后|三日后/, days: 3 },
  { pattern: /七天后|七日后|一周后/, days: 7 },
  { pattern: /十天后|旬日后/, days: 10 },
  { pattern: /半月后|十五天后/, days: 15 },
  { pattern: /一月后|月余/, days: 30 },
  { pattern: /数月后/, days: 90 },
  { pattern: /半年后/, days: 180 },
  { pattern: /一年后|年余/, days: 365 },
  { pattern: /转眼到了春天|春天来了|春暖花开/, days: 90 },
  { pattern: /转眼到了夏天|夏天来了|盛夏/, days: 90 },
  { pattern: /转眼到了秋天|秋天来了|金秋/, days: 90 },
  { pattern: /转眼到了冬天|冬天来了|隆冬/, days: 90 },
];

export function getInitialTemporalContext(_worldId: string): TemporalContext {
  return {
    eraNotation: '',
    ceYear: 0,
    displayLabel: '',
  };
}

export function advanceTemporalContext(
  current: TemporalContext,
  _trunkEventIndex: number,
): TemporalContext {
  return current;
}

export function detectTemporalAdvance(
  assistantText: string,
  current: TemporalContext,
): TemporalContext {
  if (current.ceYear <= 0) {
    return current;
  }

  let maxDays = 0;
  for (const { pattern, days } of TEMPORAL_PHRASES) {
    if (pattern.test(assistantText) && days > maxDays) {
      maxDays = days;
    }
  }

  if (maxDays === 0) {
    return current;
  }

  const yearsAdvanced = Math.floor(maxDays / 365);
  if (yearsAdvanced === 0) {
    return current;
  }

  const newCeYear = current.ceYear + yearsAdvanced;
  return {
    ...current,
    ceYear: newCeYear,
    displayLabel: current.eraNotation
      ? `${current.eraNotation}（约公元 ${newCeYear} 年）`
      : '',
  };
}
