// Engineering-only signatures. These keys never enter build trust policy.
import { createHash, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { productAssetUrl } from '../../../config/product-update-contract.mjs';
export function signedProductFixture(patch = {}, bytes = Buffer.from('engineering installer bytes'), signingKey) {
  const privateKey = signingKey ?? generateKeyPairSync('ed25519').privateKey;
  const publicKey = createPublicKey(privateKey);
  const key = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  const version = patch.version ?? '0.3.0';
  const target = patch.target ?? 'macos-arm64';
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const name = `Nimi-${version}-${target}.${target === 'macos-arm64' ? 'pkg' : 'exe'}`;
  const candidate = { schema: 'nimi-product-release/v1', releaseId: `nimi/v${version}`, version, channel: 'beta', target,
    publishedAt: new Date(Date.now() - 60_000).toISOString(), expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    sourceRevision: 'a'.repeat(40), components: Object.fromEntries(['desktop', 'runtime', 'avatar'].map((part) => [part, { version, sha256 }])),
    compatibility: { minimumProductVersion: '0.2.0', minimumOsVersion: '13.0', dataPolicy: 'owner-approved-forward' },
    asset: { name, url: productAssetUrl(`nimi/v${version}`, name), size: bytes.length, sha256, installer: target === 'macos-arm64' ? 'macos-pkg' : 'windows-exe' }, ...patch };
  const payload = Buffer.from(JSON.stringify(candidate));
  const envelope = { payload: payload.toString('base64'), signature: sign(null, payload, privateKey).toString('base64') };
  const manifestBytes = Buffer.from(JSON.stringify(envelope));
  const manifestName = `nimi-update-${target}.json`;
  const release = { tag_name: candidate.releaseId, draft: false, prerelease: true, immutable: true, assets: [
    { name: manifestName, state: 'uploaded', digest: `sha256:${createHash('sha256').update(manifestBytes).digest('hex')}`, browser_download_url: productAssetUrl(candidate.releaseId, manifestName) },
    { name: candidate.asset.name, state: 'uploaded', digest: `sha256:${sha256}`, size: bytes.length, browser_download_url: candidate.asset.url },
  ] };
  return { privateKey, key, candidate, envelope, manifestBytes, bytes, release };
}
