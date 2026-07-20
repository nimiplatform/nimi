/**
 * Simulator guard bootstrap. This module and its static imports are the only
 * code evaluated before the browser-effect guards exist: guard
 * implementation plus immutable catalog data. The Shell, Kit, SDK, selected
 * source, and every effect-capable dependency are dynamically imported only
 * after descriptor verification and guard installation succeed.
 *
 * Authority: P-SIM-018; simulator-protocol.md §16.3.
 */

import { simulatorEffectCatalog } from '../../.generated/effect-catalog';
import {
  installSimulatorEffectGuards,
  type SimulatorEffectCatalog,
} from '../effects/guards.ts';

export async function bootstrapSimulator(): Promise<void> {
  const guard = installSimulatorEffectGuards({
    catalog: simulatorEffectCatalog as unknown as SimulatorEffectCatalog,
    target: globalThis as unknown as Record<string, unknown>,
  });
  const { mountSimulatorShell } = await import('../shell/mount.ts');
  mountSimulatorShell(guard);
}
