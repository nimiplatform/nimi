/**
 * Bridge between the shell view props (session handlers + instance/module
 * projections) and the chrome component tree. Keeps chrome components free
 * of prop drilling while the State Engine remains the only product truth.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { SimulatorShellRoute } from '../routes.ts';
import type { SimulatorSessionInstanceView } from '../session.ts';

export interface ShellModuleSurface {
  readonly id: string;
  readonly label: string;
}

export interface ShellModule {
  readonly moduleId: string;
  readonly surfaces: readonly ShellModuleSurface[];
}

export interface ShellActions {
  readonly phase: 'open' | 'resetting' | 'terminal';
  readonly route: SimulatorShellRoute;
  readonly instances: readonly SimulatorSessionInstanceView[];
  readonly modules: readonly ShellModule[];
  readonly moduleCount: number;
  readonly open: (moduleId: string, surfaceId: string) => void;
  readonly close: (instanceId: string) => void;
  readonly activate: (instanceId: string) => void;
  readonly deactivate: (instanceId: string) => void;
  readonly navigate: (route: SimulatorShellRoute) => void;
  readonly reset: () => void;
}

const ShellActionsContext = createContext<ShellActions | null>(null);

export function ShellActionsProvider({ value, children }: { value: ShellActions; children: ReactNode }) {
  return <ShellActionsContext.Provider value={value}>{children}</ShellActionsContext.Provider>;
}

export function useShellActions(): ShellActions {
  const ctx = useContext(ShellActionsContext);
  if (!ctx) throw new Error('useShellActions must be used inside ShellActionsProvider');
  return ctx;
}

/** Module accent token (falls back to a neutral tone for unknown modules). */
export function moduleAccent(moduleId: string): string {
  return `var(--mod-${moduleId}, #a8b8d6)`;
}

/** First live (non-disposed) instance of a module, in creation order. */
export function liveInstancesOf(
  instances: readonly SimulatorSessionInstanceView[],
  moduleId: string,
): SimulatorSessionInstanceView[] {
  return instances.filter((entry) => entry.moduleId === moduleId && entry.status !== 'disposed');
}
