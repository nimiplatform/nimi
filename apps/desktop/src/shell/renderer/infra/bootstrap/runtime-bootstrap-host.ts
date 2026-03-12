import { setInternalModSdkHost } from '@runtime/mod';
import type { ModSdkHost } from '../../../../../../../sdk/src/mod/internal/host-types.js';

export type WireModSdkHostInput = ModSdkHost;

export function wireModSdkHost(input: WireModSdkHostInput): void {
  setInternalModSdkHost(input);
}
