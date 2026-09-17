/**
 * Simulator diagnostics: instance, module, and session diagnostics with the
 * exhaustive failure-scope matrix. Diagnostics are Shell-owned projections;
 * they never expose raw Simulator identifiers to App UI.
 *
 * Authority: P-SIM-001, P-SIM-019 (failure-scope matrix).
 */

import type { SimulatorError, SimulatorErrorCode } from '../state-engine/errors.ts';

export type SimulatorDiagnosticScope = 'instance' | 'module' | 'session';

export interface SimulatorDiagnostic {
  readonly diagnosticId: string;
  readonly scope: SimulatorDiagnosticScope;
  readonly code: SimulatorErrorCode;
  readonly moduleId: string | null;
  readonly instanceId: string | null;
  readonly epoch: number;
}

export interface SimulatorDiagnosticsStore {
  reportInstanceFailure(error: SimulatorError, epoch: number): SimulatorDiagnostic;
  reportModuleFailure(error: SimulatorError, epoch: number): SimulatorDiagnostic;
  reportSessionFailure(error: SimulatorError, epoch: number): SimulatorDiagnostic;
  removeForInstance(instanceId: string): void;
  list(): readonly SimulatorDiagnostic[];
  sessionTerminal(): SimulatorDiagnostic | null;
  subscribe(listener: () => void): () => void;
}

/** Maps every Simulator error code to its exact diagnostic scope. */
export function simulatorErrorScope(code: SimulatorErrorCode): SimulatorDiagnosticScope {
  switch (code) {
    case 'SIMULATOR_INSTANCE_FAILED':
      return 'instance';
    case 'SIMULATOR_MODULE_FAILED':
      return 'module';
    case 'SIMULATOR_INTEGRITY_FAILURE':
      return 'session';
    default:
      return 'session';
  }
}

export function createDiagnosticsStore(): SimulatorDiagnosticsStore {
  let sequence = 0;
  let diagnostics: SimulatorDiagnostic[] = [];
  let terminal: SimulatorDiagnostic | null = null;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function record(scope: SimulatorDiagnosticScope, error: SimulatorError, epoch: number): SimulatorDiagnostic {
    sequence += 1;
    const diagnostic: SimulatorDiagnostic = Object.freeze({
      diagnosticId: `diag:${sequence}`,
      scope,
      code: error.code,
      moduleId: error.moduleId,
      instanceId: error.instanceId,
      epoch,
    });
    diagnostics = [...diagnostics, diagnostic];
    if (scope === 'session') terminal = diagnostic;
    notify();
    return diagnostic;
  }

  return {
    reportInstanceFailure(error, epoch) {
      return record('instance', error, epoch);
    },
    reportModuleFailure(error, epoch) {
      return record('module', error, epoch);
    },
    reportSessionFailure(error, epoch) {
      return record('session', error, epoch);
    },
    removeForInstance(instanceId) {
      const next = diagnostics.filter((diagnostic) => diagnostic.instanceId !== instanceId);
      if (next.length !== diagnostics.length) {
        diagnostics = next;
        notify();
      }
    },
    list() {
      return diagnostics;
    },
    sessionTerminal() {
      return terminal;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
