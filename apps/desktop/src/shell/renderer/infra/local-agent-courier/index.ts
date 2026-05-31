import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { callRealmApi, emitRealmDataError } from '@renderer/infra/realm/realm-api';
import { ShellPollingManager } from '@renderer/infra/lifecycle/polling-manager';
import {
  COURIER_POLLING_KEY as PROVISION_COURIER_POLLING_KEY,
  COURIER_POLL_INTERVAL_MS as PROVISION_COURIER_POLL_INTERVAL_MS,
  runLocalAgentProvisionCourierPass as runProvisionCourierPass,
  type LocalAgentProvisionCourierPassResult,
} from './provision-courier';
import {
  COURIER_POLLING_KEY as TERMINATION_COURIER_POLLING_KEY,
  COURIER_POLL_INTERVAL_MS as TERMINATION_COURIER_POLL_INTERVAL_MS,
  runLocalAgentTerminationCourierPass as runTerminationCourierPass,
  type LocalAgentTerminationCourierPassResult,
} from './termination-courier';

const courierPolling = new ShellPollingManager();

function getCurrentUser(): Record<string, unknown> | null {
  return useAppStore.getState().auth.user;
}

export function runLocalAgentTerminationCourierPass(): Promise<LocalAgentTerminationCourierPassResult> {
  return runTerminationCourierPass({
    callApi: callRealmApi,
    emitCourierError: emitRealmDataError,
    getCurrentUser,
  });
}

export function startLocalAgentTerminationCourier(): void {
  courierPolling.start(
    TERMINATION_COURIER_POLLING_KEY,
    () => {
      void runLocalAgentTerminationCourierPass().catch(() => {});
    },
    TERMINATION_COURIER_POLL_INTERVAL_MS,
  );
}

export function stopLocalAgentTerminationCourier(): void {
  courierPolling.stop(TERMINATION_COURIER_POLLING_KEY);
}

export function runLocalAgentProvisionCourierPass(): Promise<LocalAgentProvisionCourierPassResult> {
  return runProvisionCourierPass({
    callApi: callRealmApi,
    emitCourierError: emitRealmDataError,
    getCurrentUser,
  });
}

export function startLocalAgentProvisionCourier(): void {
  courierPolling.start(
    PROVISION_COURIER_POLLING_KEY,
    () => {
      void runLocalAgentProvisionCourierPass().catch(() => {});
    },
    PROVISION_COURIER_POLL_INTERVAL_MS,
  );
}

export function stopLocalAgentProvisionCourier(): void {
  courierPolling.stop(PROVISION_COURIER_POLLING_KEY);
}

export function stopLocalAgentCouriers(): void {
  courierPolling.stopAll();
}

export type {
  LocalAgentProvisionCourierPassResult,
  LocalAgentTerminationCourierPassResult,
};
