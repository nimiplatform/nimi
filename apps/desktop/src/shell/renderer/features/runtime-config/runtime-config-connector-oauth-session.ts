import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type {
  NimiManagedConnectorCredentialAcquisitionHost,
} from '@nimiplatform/sdk/runtime';
import {
  acquireCodexManagedCredential,
  createCodexOAuthConnectorOperationSnapshot,
  isCodexOAuthConnectorOperationCurrent,
  type CodexOAuthConnectorOperationSnapshot,
  type CodexOAuthPendingState,
} from './runtime-config-codex-oauth.js';
import type { ApiConnector } from './runtime-config-state-types.js';

export type ConnectorOAuthControllerState = {
  readonly busy: boolean;
  readonly pending: CodexOAuthPendingState | null;
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
// @nimi-authority: rule.nimi.desktop.ai-consumption.r023
export function createConnectorOAuthController(input: {
  readonly host: NimiManagedConnectorCredentialAcquisitionHost;
  readonly findConnector: (connectorId: string) => ApiConnector | null | undefined;
  readonly onAcquired: (
    acquired: { readonly connectorId: string },
    operation: CodexOAuthConnectorOperationSnapshot,
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
    const operation = createCodexOAuthConnectorOperationSnapshot(generation, connector);
    const operationIsCurrent = (connectorOverride?: ApiConnector | null) => (
      !disposed
      && abortController === controller
      && !controller.signal.aborted
      && isCodexOAuthConnectorOperationCurrent(
        operation,
        generation,
        connectorOverride !== undefined
          ? connectorOverride
          : input.findConnector(operation.connector.id),
      )
    );
    setState({ busy: true, pending: null });
    try {
      const acquired = await acquireCodexManagedCredential({
        profileId,
        connectorId: operation.connector.isDraft ? undefined : operation.connector.id,
        provider: operation.connector.provider,
        endpoint: operation.connector.endpoint,
        label: operation.connector.label,
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
      await input.onAcquired({ connectorId: acquired.connectorId }, operation, operationIsCurrent);
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
  readonly pending: CodexOAuthPendingState | null;
  readonly start: (connector: ApiConnector) => Promise<void>;
  readonly invalidate: (reason: string) => void;
};

/** React binding over the shared OAuth controller; disposes on unmount. */
export function useConnectorOAuthAcquisition(input: {
  readonly host: NimiManagedConnectorCredentialAcquisitionHost;
  readonly findConnector: (connectorId: string) => ApiConnector | null | undefined;
  readonly onAcquired: (
    acquired: { readonly connectorId: string },
    operation: CodexOAuthConnectorOperationSnapshot,
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
