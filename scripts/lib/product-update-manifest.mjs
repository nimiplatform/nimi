import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { PRODUCT_UPDATE_POLICY } from '../../config/product-update-policy.mjs';
import { ProductUpdateError, productAssetUrl, validateProductRelease } from '../../config/product-update-contract.mjs';
import { verifyWindowsProductIdentity } from '../../config/windows-product-identity.mjs';

export async function hashProductFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function hashProductTree(root) {
  const hash = createHash('sha256');
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { await visit(file); continue; }
      if (!entry.isFile()) throw new ProductUpdateError('UPDATE_COHORT_INVALID');
      const relative = path.relative(root, file).split(path.sep).join('/');
      hash.update(`${relative}\0${(await stat(file)).size}\0`);
      for await (const chunk of createReadStream(file)) hash.update(chunk);
    }
  }
  await visit(root);
  return hash.digest('hex');
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-009
export async function buildProductUpdateManifest({ identity, assetPath, admission, privateKey, installedInventory, publicKey = PRODUCT_UPDATE_POLICY.publicKey }) {
  if (!publicKey) throw new ProductUpdateError('UPDATE_TRUST_NOT_CONFIGURED');
  if (identity.schema !== 'nimi-product-build/v1' || !Array.isArray(identity.dirtyInput) || identity.dirtyInput.length) {
    throw new ProductUpdateError('UPDATE_SOURCE_NOT_RELEASEABLE');
  }
  if (identity.minimumOsVersion !== admission.compatibility.minimumOsVersion) throw new ProductUpdateError('UPDATE_COMPATIBILITY_INVALID');
  if (identity.target==='macos-arm64' && identity.realmOrigin!=='https://realm.nimi.ai') throw new ProductUpdateError('UPDATE_RELEASE_POLICY_MISMATCH');
  if (identity.target === 'windows-amd64') {
    const installed = await verifyWindowsProductIdentity(installedInventory, publicKey);
    if (installed.version !== identity.version || installed.sourceRevision !== identity.sourceRevision || installed.channel !== admission.channel
      || !isDeepStrictEqual(installed.components,identity.components)) throw new ProductUpdateError('UPDATE_COHORT_INVALID');
  }
  const size = (await stat(assetPath)).size, sha256 = await hashProductFile(assetPath);
  if (size !== identity.asset.size || sha256 !== identity.asset.sha256 || path.basename(assetPath) !== identity.asset.name) {
    throw new ProductUpdateError('UPDATE_ASSET_DIGEST_MISMATCH');
  }
  const release = validateProductRelease({
    schema: 'nimi-product-release/v1', version: identity.version, releaseId: `nimi/v${identity.version}`,
    target: identity.target, sourceRevision: identity.sourceRevision, components: identity.components,
    channel: admission.channel, publishedAt: admission.publishedAt, expiresAt: admission.expiresAt,
    compatibility: admission.compatibility,
    asset: { name: identity.asset.name, url: productAssetUrl(`nimi/v${identity.version}`, identity.asset.name), size, sha256,
      installer: identity.target === 'macos-arm64' ? 'macos-pkg' : 'windows-exe' },
  });
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new ProductUpdateError('UPDATE_SIGNATURE_INVALID');
  const observed = createPublicKey(key).export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  if (observed !== publicKey) throw new ProductUpdateError('UPDATE_SIGNATURE_INVALID');
  const payload = Buffer.from(JSON.stringify(release));
  return { payload: payload.toString('base64'), signature: sign(null, payload, key).toString('base64') };
}

export async function readProductManifestInput(file) { return JSON.parse(await readFile(file, 'utf8')); }
