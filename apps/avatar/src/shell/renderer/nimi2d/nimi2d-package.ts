import {
  createNimi2DRenderPlan,
  optionalCapabilityProfileRef,
  type Nimi2DBackendCapabilityProfile,
  type Nimi2DLayerTransformBinding,
  type Nimi2DPackageAsset,
  type Nimi2DPackageManifest,
  type Nimi2DRenderPlan,
  type Nimi2DTier,
} from '@nimiplatform/nimi2d/runtime';
import { readTextFile } from '../live2d/model-loader.js';

export type {
  Nimi2DBackendCapabilityProfile,
  Nimi2DLayerTransformBinding,
  Nimi2DPackageAsset,
  Nimi2DPackageManifest,
  Nimi2DRenderPlan as Nimi2DLoadedPackage,
  Nimi2DTier,
};

function requiredSha256Hex(value: string | null | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new Error('Nimi2D backend requires package digest sha256');
  }
  return normalized;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(raw: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Nimi2D backend requires Web Crypto SHA-256 support');
  }
  const data = new TextEncoder().encode(raw);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

async function assertPackageDigest(raw: string, expectedDigestSha256: string | null | undefined): Promise<string> {
  const expected = requiredSha256Hex(expectedDigestSha256);
  const actual = await sha256Hex(raw);
  if (actual !== expected) {
    throw new Error('Nimi2D package digest mismatch');
  }
  return actual;
}

function assertPackageAdmissionEvidence(renderPlan: Nimi2DRenderPlan): void {
  if (!renderPlan.manifest.source?.validator_evidence_ref) {
    throw new Error('Nimi2D package validator evidence ref is required');
  }
  if (!renderPlan.manifest.source?.content_admission_ref && !renderPlan.manifest.governance.content_admission_ref) {
    throw new Error('Nimi2D package content admission ref is required');
  }
}

export async function loadNimi2DPackage(input: {
  packageManifestPath: string;
  packageDigestSha256: string | null;
  capabilityProfileRef: string | null;
}): Promise<Nimi2DRenderPlan> {
  const packageManifestRaw = await readTextFile(input.packageManifestPath);
  await assertPackageDigest(packageManifestRaw, input.packageDigestSha256);
  const capabilityProfileRaw = input.capabilityProfileRef
    ? await readTextFile(input.capabilityProfileRef)
    : null;
  const renderPlan = createNimi2DRenderPlan({
    packageManifestRaw,
    capabilityProfileRaw,
    packageManifestRef: input.packageManifestPath,
  });
  assertPackageAdmissionEvidence(renderPlan);
  return renderPlan;
}

export { optionalCapabilityProfileRef };
