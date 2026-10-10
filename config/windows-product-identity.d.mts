import type { ProductRelease } from './product-update-contract.mjs';
export const WINDOWS_PRODUCT_ROLES: Readonly<{ desktop: string; runtime: string; updater: string }>;
export type WindowsProductIdentity = Pick<ProductRelease, 'releaseId' | 'version' | 'channel' | 'sourceRevision' | 'components'> & { schema: 'nimi-windows-product-identity/v1'; target: 'windows-amd64'; files: Record<string, string> };
export function validateWindowsProductIdentity(value: unknown): WindowsProductIdentity;
export function verifyWindowsProductIdentity(envelope: unknown, publicKey?: string | null): Promise<WindowsProductIdentity>;
