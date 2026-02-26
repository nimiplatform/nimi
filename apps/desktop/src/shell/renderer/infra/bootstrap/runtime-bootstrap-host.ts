import { setModSdkHost } from '@nimiplatform/sdk/mod/host';

export type WireModSdkHostInput = Parameters<typeof setModSdkHost>[0];

export function wireModSdkHost(input: WireModSdkHostInput): void {
  setModSdkHost(input);
}
