import { PRODUCT_UPDATE_POLICY } from '../../../config/product-update-policy.mjs';
import { PRODUCT_CHANNELS, ProductUpdateError, authenticateProductEnvelope, compareProductVersions, productManifestName, readBoundedResponse, validateProductRelease } from '../../../config/product-update-contract.mjs';

function productVersionFromTag(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('nimi/v')) return null;
  const version = tag.slice('nimi/v'.length);
  try { compareProductVersions(version, version); return version; }
  catch (error) {
    // A malformed tag is not a product version. This is only source routing;
    // no selected-candidate verification failure is swallowed here.
    if (error instanceof ProductUpdateError && error.code === 'UPDATE_VERSION_INVALID') return null;
    throw error;
  }
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-009
export async function resolveProductManifest(releases, channel, target, fetchImpl = fetch, publicKey = PRODUCT_UPDATE_POLICY.publicKey) {
  const manifestName = productManifestName(target);
  const candidates = releases.map((release) => ({ release, version: productVersionFromTag(release?.tag_name) }))
    .filter(({ release, version }) => version !== null && release.draft === false && release.immutable === true
      && (channel === 'beta' || release.prerelease === false)
      && Array.isArray(release.assets) && release.assets.some((asset) => asset.name === manifestName))
    .sort((a, b) => compareProductVersions(b.version, a.version));
  if (!candidates.length) throw new ProductUpdateError('UPDATE_RELEASE_NOT_FOUND');
  if (!publicKey) throw new ProductUpdateError('UPDATE_TRUST_NOT_CONFIGURED');
  for (const { release, version } of candidates) {
    const manifests = release.assets.filter((asset) => asset.name === manifestName);
    if (manifests.length !== 1) throw new ProductUpdateError('UPDATE_METADATA_INVALID');
    const manifest = manifests[0];
    const prefix = `https://github.com/${PRODUCT_UPDATE_POLICY.repository}/releases/download/${encodeURIComponent(release.tag_name)}/`;
    if (manifest.state !== 'uploaded' || manifest.browser_download_url !== `${prefix}${manifest.name}`
      || !/^sha256:[a-f0-9]{64}$/u.test(manifest.digest)) throw new ProductUpdateError('UPDATE_METADATA_INVALID');
    let response;
    try { response = await fetchImpl(manifest.browser_download_url, { signal: AbortSignal.timeout(PRODUCT_UPDATE_POLICY.requestTimeoutMs) }); }
    catch { throw new ProductUpdateError('UPDATE_UPSTREAM_UNAVAILABLE'); }
    if (!response.ok) throw new ProductUpdateError('UPDATE_UPSTREAM_UNAVAILABLE');
    const bytes = await readBoundedResponse(response, PRODUCT_UPDATE_POLICY.maximumMetadataBytes);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (`sha256:${digest}` !== manifest.digest) throw new ProductUpdateError('UPDATE_SIGNATURE_INVALID');
    let envelope;
    try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new ProductUpdateError('UPDATE_METADATA_INVALID'); }
    const identity = await authenticateProductEnvelope(envelope, publicKey);
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)
      || identity.schema !== 'nimi-product-release/v1' || !PRODUCT_CHANNELS.includes(identity.channel)) throw new ProductUpdateError('UPDATE_METADATA_INVALID');
    if (identity.releaseId !== release.tag_name || identity.version !== version) throw new ProductUpdateError('UPDATE_COHORT_INVALID');
    if (identity.target !== target) throw new ProductUpdateError('UPDATE_TARGET_MISMATCH');
    // Only an authenticated publisher identity can exclude another channel.
    // Its expiry does not govern this feed. Once this channel is selected,
    // any freshness/signature/asset failure stops; never try an older version.
    if (identity.channel !== channel) continue;
    const candidate = validateProductRelease(identity);
    const assets = release.assets.filter((asset) => asset.name === candidate.asset.name);
    if (assets.length !== 1 || assets[0].state !== 'uploaded'
      || assets[0].browser_download_url !== candidate.asset.url
      || assets[0].size !== candidate.asset.size || assets[0].digest !== `sha256:${candidate.asset.sha256}`) {
      throw new ProductUpdateError('UPDATE_ASSET_INVALID');
    }
    // Return the selected publisher envelope without reading older history.
    return envelope;
  }
  throw new ProductUpdateError('UPDATE_RELEASE_NOT_FOUND');
}
