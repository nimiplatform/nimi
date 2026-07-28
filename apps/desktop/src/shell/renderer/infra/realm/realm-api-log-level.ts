import { ReasonCode } from '@nimiplatform/sdk/types';

const SDK_RUNTIME_REALM_OPERATION_NOT_ADMITTED = 'SDK_RUNTIME_REALM_OPERATION_NOT_ADMITTED';

export function resolveRealmDataErrorLogLevel(input: {
  readonly action: string;
  readonly reasonCode?: string;
  readonly realmOffline: boolean;
  readonly runtimeOffline: boolean;
}): 'warn' | 'error' {
  if (input.realmOffline || input.runtimeOffline) {
    return 'warn';
  }
  if (input.reasonCode === SDK_RUNTIME_REALM_OPERATION_NOT_ADMITTED) {
    return 'error';
  }
  if (input.action === 'load-current-user'
    && input.reasonCode === ReasonCode.APP_AUTHORIZATION_DENIED) {
    return 'warn';
  }
  return 'error';
}
