export type ProductRelease = {
  schema: 'nimi-product-release/v1'; releaseId: string; version: string;
  channel: 'stable' | 'beta'; target: 'macos-arm64' | 'windows-amd64';
  publishedAt: string; expiresAt: string; sourceRevision: string;
  components: Record<'desktop' | 'runtime' | 'avatar', { version: string; sha256: string }>;
  compatibility: { minimumProductVersion: string; minimumOsVersion: string; dataPolicy: 'owner-approved-forward' };
  asset: { name: string; url: string; size: number; sha256: string; installer: 'macos-pkg' | 'windows-exe' };
};
export class ProductUpdateError extends Error { code: string; constructor(code: string); }
export function rejectProductUpdate(code: string): never;
export function compareProductVersions(left: string, right: string): number;
export function productAssetUrl(releaseId: string, name: string): string;
export function matchesProductAssetUrl(value: unknown, releaseId: string, name: string): boolean;
export function productManifestName(target: string): string;
export function validateProductRelease(value: unknown, now?: number): ProductRelease;
export function verifyProductEnvelope(value: unknown, publicKey?: string | null, now?: number): Promise<ProductRelease>;
export function authenticateProductEnvelope(value: unknown, publicKey?: string | null): Promise<unknown>;
export function readBoundedResponse(response: Response, limit: number): Promise<Uint8Array>;
export function decodeBase64(value: string, expectedLength?: number): Uint8Array;
export const PRODUCT_TARGETS: readonly string[];
export const PRODUCT_CHANNELS: readonly string[];
