import type { CareCircle } from './types.js';

/**
 * Whether something still belongs in Today and in what the assistant is
 * given: true unless it belongs to a person or area whose care was ended.
 * Ended care keeps its items and notes (they stay in Items and Care); they
 * just stop being put in front of the user and the assistant.
 */
export function stillInCare(circles: readonly CareCircle[]): (entry: { readonly circleId: string | null }) => boolean {
  const ended = new Set(circles.filter((circle) => circle.status === 'ended').map((circle) => circle.id));
  return (entry) => entry.circleId === null || !ended.has(entry.circleId);
}
