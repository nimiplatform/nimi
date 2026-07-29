import type { NimiClient } from '@nimiplatform/sdk';
import type { NimiRuntimeAccountCaller } from '@nimiplatform/sdk/runtime';
import { runtimeAccountLoginEnabled } from './runtime-platform';

/** Retained compatibility entry point; third-party local apps cannot mint account callers. */
export function getRuntimeAccountCaller(): NimiRuntimeAccountCaller {
  throw Object.assign(new Error('Zhiyu account caller capability is not admitted.'), {
    reasonCode: 'zhiyu-account-caller-capability-not-admitted',
    actionHint: 'admit_zhiyu_account_caller_capability',
    source: 'sdk',
  });
}

export async function loadRuntimeAccountUser(_client: NimiClient) {
  if (!runtimeAccountLoginEnabled) {
    return null;
  }
  return Promise.reject(Object.assign(new Error('Zhiyu account caller capability is not admitted.'), {
    reasonCode: 'zhiyu-account-caller-capability-not-admitted',
    actionHint: 'admit_zhiyu_account_caller_capability',
    source: 'sdk',
  }));
}
