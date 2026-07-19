/**
 * Nimi motion provider (P-DESIGN-027 / nimi-ui-motion-contract.md §6-7).
 *
 * Wires the admitted animation substrate (`motion` package) to the
 * OS-level reduced-motion preference: transform/layout travel is
 * stripped while opacity feedback is preserved, so spatial causality
 * survives when the user asks for reduced motion.
 */

import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

export function NimiMotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
