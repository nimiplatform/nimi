/**
 * observation-matcher.ts — 观察维度匹配器
 *
 * 根据孩子月龄，从 observation-framework 中选择当前适用的观察维度。
 * 处理年龄段过渡期（±12个月）的维度并存逻辑。
 */

import type { ObservationDimension } from '../knowledge-base/index.js';

const TRANSITION_BUFFER = 12; // months of overlap during framework transitions

/**
 * Given a child's age in months, return the observation dimensions
 * that are relevant, including transition-period overlap.
 */
export function getActiveDimensions(
  allDimensions: readonly ObservationDimension[],
  ageMonths: number,
): ObservationDimension[] {
  return allDimensions.filter((d) => {
    const start = d.ageRange.startMonths;
    const end = d.ageRange.endMonths === -1 ? 999 : d.ageRange.endMonths;

    // Core range
    if (ageMonths >= start && ageMonths <= end) return true;

    // Transition: allow dimensions that ended recently (within buffer)
    if (ageMonths > end && ageMonths <= end + TRANSITION_BUFFER) return true;

    // Transition: allow dimensions that will start soon (within buffer)
    if (ageMonths < start && ageMonths >= start - TRANSITION_BUFFER) return true;

    return false;
  });
}
