import type { KeyObject } from 'node:crypto';
import type { ProductRelease } from '../../../config/product-update-contract.mjs';
export function signedProductFixture(patch?: Record<string, unknown>, bytes?: Buffer, signingKey?: KeyObject): {
  privateKey: KeyObject; key: string; candidate: ProductRelease;
  envelope: { payload: string; signature: string }; manifestBytes: Buffer; bytes: Buffer;
  release: { tag_name: string; draft: boolean; prerelease: boolean; immutable: boolean;
    assets: Array<{ name: string; state: string; digest: string; size?: number; browser_download_url: string }> };
};
