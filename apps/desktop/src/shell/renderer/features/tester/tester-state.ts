import type React from 'react';
import { CAPABILITIES, type CapabilityId, type CapabilityState, type CapabilityStates, type DiagnosticsInfo } from './tester-types.js';
import { ensureRouteOptionsSnapshotShape, linkedRouteCapabilityIds, routeCapabilityFor } from './tester-route.js';
import { loadDesktopRouteOptions } from '../runtime-config/desktop-route-options-service';

export function makeEmptyDiagnostics(): DiagnosticsInfo {
  return { requestParams: null, resolvedRoute: null, responseMetadata: null };
}

export function makeInitialCapabilityState(): CapabilityState {
  return {
    snapshot: null,
    binding: null,
    routeLoading: false,
    routeError: '',
    result: 'idle',
    output: null,
    rawResponse: '',
    busy: false,
    busyLabel: '',
    error: '',
    diagnostics: makeEmptyDiagnostics(),
  };
}

export function makeInitialCapabilityStates(): CapabilityStates {
  return Object.fromEntries(CAPABILITIES.map((capability) => [capability.id, makeInitialCapabilityState()])) as CapabilityStates;
}

export async function loadRouteSnapshot(input: {
  capabilityId: CapabilityId;
  setStates: React.Dispatch<React.SetStateAction<CapabilityStates>>;
}): Promise<void> {
  const { capabilityId, setStates } = input;
  const targetCapability = routeCapabilityFor(capabilityId);
  if (!targetCapability) {
    return;
  }
  const linkedIds = linkedRouteCapabilityIds(capabilityId);
  setStates((prev) => ({
    ...prev,
    ...Object.fromEntries(linkedIds.map((id) => [
      id,
      { ...prev[id], routeLoading: true, routeError: '' },
    ])),
  }));
  try {
    const snapshot = ensureRouteOptionsSnapshotShape(
      await loadDesktopRouteOptions(targetCapability),
    );
    if (!snapshot) {
      throw new Error('TESTER_ROUTE_OPTIONS_INVALID');
    }
    setStates((prev) => ({
      ...prev,
      ...Object.fromEntries(linkedIds.map((id) => [
        id,
        { ...prev[id], snapshot, routeLoading: false, routeError: '' },
      ])),
    }));
  } catch (error) {
    setStates((prev) => ({
      ...prev,
      ...Object.fromEntries(linkedIds.map((id) => [
        id,
        {
          ...prev[id],
          routeLoading: false,
          routeError: error instanceof Error ? error.message : String(error || 'Failed to load route options.'),
        },
      ])),
    }));
  }
}
