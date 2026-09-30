import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type {
  NimiManagedConnectorCredentialAcquisitionHost,
} from '@nimiplatform/sdk/runtime';
import {
  acquireManagedConnectorCredential,
  createManagedOAuthConnectorOperationSnapshot,
  isManagedOAuthConnectorOperationCurrent,
  type ManagedOAuthConnectorOperationSnapshot,
  type ManagedOAuthPendingState,
} from './runtime-config-managed-oauth.js';
import type { ApiConnector } from './runtime-config-state-types.js';

export type ConnectorOAuthControllerState = {
  readonly busy: boolean;
  readonly pending: ManagedOAuthPendingState | null;
};

export type ConnectorOAuthController = {
  readonly getState: () => ConnectorOAuthControllerState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly start: (connector: ApiConnector) => Promise<void>;
  readonly invalidate: (reason: string) => void;
  readonly dispose: () => void;
};

/**
 * Plain (React-free) managed-OAuth orchestration shared by the Cloud page and
 * the in-task connector creation form. A generation counter plus a full
 * connector snapshot guard the async callback: a page switch, cancel, field
 * change, or account change invalidates the generation, and a stale
 * completion never writes into newer state.
 */
// @nimi-authority: rule.nimi.sdks.feature-clients.r060
export function createConnectorOAuthController(input: {
  readonly host: NimiManagedConnectorCredentialAcquisitionHost;
  readonly findConnector: (connectorId: string) => ApiConnector | null | undefined;
  readonly onAcquired: (
    acquired: { readonly connectorId: string; readonly accountLabel?: string },
    operation: ManagedOAuthConnectorOperationSnapshot,
    /** Re-checks generation/abort/snapshot at any later point (e.g. inside a state updater). */
    isCurrent: (connectorOverride?: ApiConnector | null) => boolean,
  ) => void | Promise<void>;
  readonly onError?: (message: string) => void;
}): ConnectorOAuthController {
  let state: ConnectorOAuthControllerState = Object.freeze({ busy: false, pending: null });
  let generation = 0;
  let abortController: AbortController | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();

  const publish = () => {
    for (const listener of listeners) listener();
  };
  const setState = (next: ConnectorOAuthControllerState) => {
    state = Object.freeze(next);
    publish();
  };

  const invalidate = (reason: string) => {
    generation += 1;
    abortController?.abort(new DOMException(reason, 'AbortError'));
    abortController = null;
    if (state.busy || state.pending) {
      setState({ busy: false, pending: null });
    }
  };

  const start = async (connector: ApiConnector) => {
    const profileId = String(connector.providerAuthProfile || '').trim();
    if (!profileId) {
      input.onError?.('Managed OAuth connector is missing provider auth profile.');
      return;
    }
    abortController?.abort(new DOMException('Managed OAuth acquisition was replaced', 'AbortError'));
    const controller = new AbortController();
    abortController = controller;
    generation += 1;
    const operation = createManagedOAuthConnectorOperationSnapshot(generation, connector);
    const operationIsCurrent = (connectorOverride?: ApiConnector | null) => (
      !disposed
      && abortController === controller
      && !controller.signal.aborted
      && isManagedOAuthConnectorOperationCurrent(
        operation,
        generation,
        connectorOverride !== undefined
          ? connectorOverride
          : input.findConnector(operation.connector.id),
      )
    );
    setState({ busy: true, pending: null });
    try {
      const acquired = await acquireManagedConnectorCredential({
        profileId,
        // A draft creates a new account registration; a saved Connector is
        // explicitly reauthorized with the registration Runtime bound to it.
        connectorId: operation.connector.isDraft ? undefined : operation.connector.id,
        label: operation.connector.isDraft ? undefined : operation.connector.label,
        onPending: (pendingState) => {
          if (operationIsCurrent()) {
            setState({ busy: true, pending: pendingState });
          }
        },
        signal: controller.signal,
      }, input.host);
      if (!operationIsCurrent()) {
        return;
      }
      setState({ busy: false, pending: null });
      await input.onAcquired({ connectorId: acquired.connectorId, accountLabel: acquired.accountLabel }, operation, operationIsCurrent);
    } catch (caught) {
      if (!controller.signal.aborted) {
        input.onError?.(caught instanceof Error ? caught.message : String(caught || 'Managed sign-in failed'));
      }
    } finally {
      if (abortController === controller) {
        abortController = null;
        setState({ busy: false, pending: null });
      }
    }
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    invalidate,
    dispose() {
      disposed = true;
      invalidate('Managed OAuth surface closed');
    },
  };
}

export type ConnectorOAuthAcquisition = {
  readonly busy: boolean;
  readonly pending: ManagedOAuthPendingState | null;
  readonly start: (connector: ApiConnector) => Promise<void>;
  readonly invalidate: (reason: string) => void;
};

/**
 * Abandons an in-flight managed OAuth operation when the configuration of the
 * Connector it started from changes. The busy flag turning on is not such a
 * change, so starting a sign-in never cancels itself.
 */
export function useInvalidateManagedOAuthOnConfigurationChange(input: {
  readonly busy: boolean;
  readonly configuration: string;
  readonly invalidate: (reason: string) => void;
}): void {
  const { busy, configuration, invalidate } = input;
  const configurationRef = useRef(configuration);
  useEffect(() => {
    if (configurationRef.current === configuration) {
      return;
    }
    configurationRef.current = configuration;
    if (busy) {
      invalidate('Managed connector configuration changed');
    }
  }, [busy, configuration, invalidate]);
}

/** React binding over the shared OAuth controller; disposes on unmount. */
export function useConnectorOAuthAcquisition(input: {
  readonly host: NimiManagedConnectorCredentialAcquisitionHost;
  readonly findConnector: (connectorId: string) => ApiConnector | null | undefined;
  readonly onAcquired: (
    acquired: { readonly connectorId: string; readonly accountLabel?: string },
    operation: ManagedOAuthConnectorOperationSnapshot,
    isCurrent: (connectorOverride?: ApiConnector | null) => boolean,
  ) => void | Promise<void>;
  readonly onError?: (message: string) => void;
}): ConnectorOAuthAcquisition {
  // Live refs so in-flight callbacks read the latest inputs at completion
  // time instead of the render-time closure.
  const findConnectorRef = useRef(input.findConnector);
  const onAcquiredRef = useRef(input.onAcquired);
  const onErrorRef = useRef(input.onError);
  findConnectorRef.current = input.findConnector;
  onAcquiredRef.current = input.onAcquired;
  onErrorRef.current = input.onError;
  const controllerRef = useRef<ConnectorOAuthController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createConnectorOAuthController({
      host: input.host,
      findConnector: (connectorId) => findConnectorRef.current(connectorId),
      onAcquired: (acquired, operation, isCurrent) => onAcquiredRef.current(acquired, operation, isCurrent),
      onError: (message) => onErrorRef.current?.(message),
    });
  }
  const controller = controllerRef.current;
  useEffect(() => () => controller.dispose(), [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const start = useCallback((connector: ApiConnector) => controller.start(connector), [controller]);
  const invalidate = useCallback((reason: string) => controller.invalidate(reason), [controller]);
  return { busy: state.busy, pending: state.pending, start, invalidate };
}
