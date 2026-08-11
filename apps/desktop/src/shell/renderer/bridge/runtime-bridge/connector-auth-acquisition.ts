import {
  parseNimiConnectorAuthAcquisitionPendingState,
  parseNimiManagedConnectorCredentialAcquisitionResult,
  type NimiManagedConnectorCredentialAcquisitionHost,
  type NimiManagedConnectorCredentialAcquisitionHostInput,
} from '@nimiplatform/sdk/runtime';
import {
  hasElectronInvoke,
  listenShell,
} from '@nimiplatform/kit/shell/renderer/bridge';

import {
  DESKTOP_CANCEL_MANAGED_CONNECTOR_AUTH_COMMAND,
  DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND,
  desktopManagedConnectorAuthPendingEvent,
} from '../../../shared/connector-auth-acquisition-contract.js';
import { invokeChecked } from './invoke.js';

export const desktopManagedConnectorCredentialAcquisitionHost:
NimiManagedConnectorCredentialAcquisitionHost = Object.freeze({
  async acquireManagedConnectorCredential(
    input: NimiManagedConnectorCredentialAcquisitionHostInput,
  ): Promise<unknown> {
    if (!hasElectronInvoke()) {
      throw new Error('Managed connector authorization requires the Desktop native host.');
    }
    const requestId = createRequestId();
    if (input.signal?.aborted) throw cancellationReason(input.signal);
    const unsubscribe = await listenShell(
      desktopManagedConnectorAuthPendingEvent(requestId),
      (event) => {
        if (input.signal?.aborted) return;
        input.onPending?.(parseNimiConnectorAuthAcquisitionPendingState(event.payload));
      },
    );
    let cancellation: Promise<{ readonly canceled: boolean }> | undefined;
    const onAbort = () => {
      cancellation ??= invokeChecked(
        DESKTOP_CANCEL_MANAGED_CONNECTOR_AUTH_COMMAND,
        { payload: { requestId } },
        parseCancellationResult,
      ).catch(() => ({ canceled: false }));
    };
    input.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      if (input.signal?.aborted) throw cancellationReason(input.signal);
      return await invokeChecked(
        DESKTOP_MANAGED_CONNECTOR_AUTH_COMMAND,
        {
          payload: {
            requestId,
            profileId: input.profileId,
            connectorId: input.connectorId,
            provider: input.provider,
            endpoint: input.endpoint,
            label: input.label,
          },
        },
        parseNimiManagedConnectorCredentialAcquisitionResult,
      );
    } catch (error) {
      if (input.signal?.aborted && (await cancellation)?.canceled) {
        throw cancellationReason(input.signal);
      }
      throw error;
    } finally {
      input.signal?.removeEventListener('abort', onAbort);
      unsubscribe();
    }
  },
});

function cancellationReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Managed connector acquisition was canceled', 'AbortError');
}

function parseCancellationResult(value: unknown): { readonly canceled: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('managed connector cancellation result must be an object');
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (Object.keys(record).some((key) => key !== 'canceled') || typeof record.canceled !== 'boolean') {
    throw new Error('managed connector cancellation result is invalid');
  }
  return { canceled: record.canceled };
}

function createRequestId(): string {
  if (!globalThis.crypto || typeof globalThis.crypto.randomUUID !== 'function') {
    throw new Error('Managed connector authorization requires secure request IDs.');
  }
  return `connector-auth-${globalThis.crypto.randomUUID()}`;
}
