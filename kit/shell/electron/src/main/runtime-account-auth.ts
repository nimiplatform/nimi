import type { Runtime, NimiRuntimeAccountCaller } from '@nimiplatform/sdk/runtime';
import { ReasonCode as RuntimeGeneratedReasonCode } from '@nimiplatform/sdk/runtime/generated';

import type {
  ElectronRuntimeBridgeTrustedMetadataProvider,
} from './types.js';
import { NimiElectronShellHostError } from './types.js';

/**
 * Legacy shape retained only until the protected native carrier replaces all
 * Electron consumers. None of these values are consulted by this module: a
 * renderer, endpoint, caller envelope, or app-owned runtime object can never
 * establish account or protected access authority.
 */
export type NimiElectronRuntimeAccountAuthRuntime = Pick<Runtime, 'account' | 'auth'>;

export type NimiElectronRuntimeAccountAppSessionInput = {
  readonly appInstanceId: string;
  readonly deviceId: string;
  readonly appVersion?: string;
  readonly capabilities: readonly string[];
  readonly developerRegistration?: boolean;
  readonly ttlSeconds?: number;
  readonly refreshSkewMs?: number;
};

export type NimiElectronRuntimeCallerEnvelopeInput = {
  readonly sourceHost: string;
  readonly launchHostId?: string;
  readonly launchNonce?: string;
  readonly releaseDescriptorRef?: string;
  readonly capabilitySetRef?: string;
};

export type NimiElectronRuntimeAccountTrustedMetadataProviderInput = {
  readonly appId: string;
  readonly runtimeEndpoint: string;
  readonly accountCaller: NimiRuntimeAccountCaller;
  readonly appSession: NimiElectronRuntimeAccountAppSessionInput;
  readonly callerEnvelope?: NimiElectronRuntimeCallerEnvelopeInput;
  readonly runtime?: NimiElectronRuntimeAccountAuthRuntime;
};

export type NimiElectronInstalledAppLaunchBinding = {
  readonly appInstanceId: string;
  readonly deviceId: string;
  readonly launchHostId: string;
  readonly launchNonce: string;
  readonly releaseDescriptorRef: string;
};

export type NimiElectronInstalledAppSessionInput =
  Omit<NimiElectronRuntimeAccountAppSessionInput, 'appInstanceId' | 'deviceId' | 'developerRegistration'> & {
    readonly developerRegistration?: boolean;
  };

export type NimiElectronInstalledAppRuntimeAccountTrustedMetadataProviderInput =
  Omit<NimiElectronRuntimeAccountTrustedMetadataProviderInput, 'accountCaller' | 'appSession'> & {
    readonly installedApp: NimiElectronInstalledAppLaunchBinding;
    readonly appSession: NimiElectronInstalledAppSessionInput;
  };

/**
 * Electron cannot turn an ordinary Runtime endpoint, self-registration, or a
 * renderer-supplied envelope into account authority. A future implementation
 * must consume a Runtime-issued session through the verified native carrier.
 */
export function createNimiElectronRuntimeAccountTrustedMetadataProvider(
  _input: NimiElectronRuntimeAccountTrustedMetadataProviderInput,
): ElectronRuntimeBridgeTrustedMetadataProvider {
  return protectedCarrierRequiredProvider();
}

/**
 * Installed child launch/session admission is pending A.1. This constructor
 * intentionally has the same fail-closed behavior as the generic path so an
 * app-owned launch binding cannot approximate a protected carrier.
 */
export function createNimiElectronInstalledAppRuntimeAccountTrustedMetadataProvider(
  _input: NimiElectronInstalledAppRuntimeAccountTrustedMetadataProviderInput,
): ElectronRuntimeBridgeTrustedMetadataProvider {
  return protectedCarrierRequiredProvider();
}

function protectedCarrierRequiredProvider(): ElectronRuntimeBridgeTrustedMetadataProvider {
  const provider: ElectronRuntimeBridgeTrustedMetadataProvider = async () => {
    throw new NimiElectronShellHostError({
      code: 'capability-unavailable',
      message: 'Electron Runtime account authority requires a protected desktop control carrier',
      reasonCode: RuntimeGeneratedReasonCode[
        RuntimeGeneratedReasonCode.DESKTOP_CONTROL_TRANSPORT_REQUIRED
      ],
      actionHint: 'connect_protected_desktop_control_carrier',
      source: 'runtime',
    });
  };
  provider.invalidate = () => {};
  return provider;
}
