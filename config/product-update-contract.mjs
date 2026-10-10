import { PRODUCT_UPDATE_POLICY } from './product-update-policy.mjs';

export const PRODUCT_TARGETS = Object.freeze(['macos-arm64', 'windows-amd64']);
export const PRODUCT_CHANNELS = Object.freeze(['stable', 'beta']);
export class ProductUpdateError extends Error {
  constructor(code) { super(code); this.name = 'ProductUpdateError'; this.code = code; }
}
export function rejectProductUpdate(code) { throw new ProductUpdateError(code); }
function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    rejectProductUpdate('UPDATE_METADATA_INVALID');
  }
}
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(beta|rc)\.([1-9]\d*))?$/u;
export function compareProductVersions(left, right) {
  const a = VERSION.exec(left), b = VERSION.exec(right);
  if (!a || !b) rejectProductUpdate('UPDATE_VERSION_INVALID');
  for (const index of [1, 2, 3]) {
    const leftPart = BigInt(a[index]), rightPart = BigInt(b[index]);
    if (leftPart !== rightPart) return leftPart > rightPart ? 1 : -1;
  }
  const rank = (match) => match[4] === 'beta' ? 0 : match[4] === 'rc' ? 1 : 2;
  const channelDifference = Math.sign(rank(a) - rank(b));
  if (channelDifference) return channelDifference;
  const aPre = BigInt(a[5] || 0), bPre = BigInt(b[5] || 0);
  return aPre === bPre ? 0 : aPre > bPre ? 1 : -1;
}
export function productAssetUrl(releaseId, name) {
  return `https://github.com/${PRODUCT_UPDATE_POLICY.repository}/releases/download/${encodeURIComponent(releaseId)}/${encodeURIComponent(name)}`;
}
export function productManifestName(target) {
  if (!PRODUCT_TARGETS.includes(target)) rejectProductUpdate('UPDATE_TARGET_UNSUPPORTED');
  return `nimi-update-${target}.json`;
}
export function validateProductRelease(value, now = Date.now()) {
  exactObject(value, ['schema', 'releaseId', 'version', 'channel', 'target', 'publishedAt', 'expiresAt', 'sourceRevision', 'components', 'compatibility', 'asset']);
  if (value.schema !== 'nimi-product-release/v1' || typeof value.version !== 'string' || !VERSION.test(value.version)
    || value.releaseId !== `nimi/v${value.version}` || !PRODUCT_CHANNELS.includes(value.channel)
    || (value.channel === 'stable' && value.version.includes('-'))
    || !PRODUCT_TARGETS.includes(value.target) || !/^[a-f0-9]{40}$/u.test(value.sourceRevision)) {
    rejectProductUpdate('UPDATE_METADATA_INVALID');
  }
  const published = Date.parse(value.publishedAt), expires = Date.parse(value.expiresAt);
  if (![value.publishedAt, value.expiresAt].every((date) => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(date))
    || !Number.isFinite(published) || !Number.isFinite(expires) || expires <= published
    || published > now + 5 * 60 * 1000) rejectProductUpdate('UPDATE_METADATA_INVALID');
  if (expires <= now) rejectProductUpdate('UPDATE_METADATA_EXPIRED');
  exactObject(value.components, ['desktop', 'runtime', 'avatar']);
  for (const component of Object.values(value.components)) {
    exactObject(component, ['version', 'sha256']);
    if (typeof component.version !== 'string' || !VERSION.test(component.version)
      || typeof component.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(component.sha256)) rejectProductUpdate('UPDATE_COHORT_INVALID');
  }
  exactObject(value.compatibility, ['minimumProductVersion', 'minimumOsVersion', 'dataPolicy']);
  if (typeof value.compatibility.minimumProductVersion !== 'string' || !VERSION.test(value.compatibility.minimumProductVersion)
    || compareProductVersions(value.compatibility.minimumProductVersion, value.version) > 0
    || typeof value.compatibility.minimumOsVersion !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/u.test(value.compatibility.minimumOsVersion)
    || value.compatibility.dataPolicy !== 'owner-approved-forward') rejectProductUpdate('UPDATE_COMPATIBILITY_INVALID');
  exactObject(value.asset, ['name', 'url', 'size', 'sha256', 'installer']);
  const extension = value.target === 'macos-arm64' ? 'pkg' : 'exe';
  if (value.asset.name !== `Nimi-${value.version}-${value.target}.${extension}`
    || value.asset.url !== productAssetUrl(value.releaseId, value.asset.name)
    || !Number.isSafeInteger(value.asset.size) || value.asset.size < 1
    || value.asset.size > PRODUCT_UPDATE_POLICY.maximumAssetBytes
    || !/^[a-f0-9]{64}$/u.test(value.asset.sha256)
    || value.asset.installer !== (extension === 'pkg' ? 'macos-pkg' : 'windows-exe')) rejectProductUpdate('UPDATE_ASSET_INVALID');
  return value;
}
export function decodeBase64(value, expectedLength) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) rejectProductUpdate('UPDATE_METADATA_INVALID');
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  if (expectedLength !== undefined && bytes.length !== expectedLength) rejectProductUpdate('UPDATE_METADATA_INVALID');
  return bytes;
}
// Authentication exposes publisher-owned routing identity only. The selected
// candidate still requires validateProductRelease, including freshness.
export async function authenticateProductEnvelope(envelope, publicKey = PRODUCT_UPDATE_POLICY.publicKey) {
  if (!publicKey) rejectProductUpdate('UPDATE_TRUST_NOT_CONFIGURED');
  exactObject(envelope, ['payload', 'signature']);
  const bytes = decodeBase64(envelope.payload);
  if (bytes.length > PRODUCT_UPDATE_POLICY.maximumMetadataBytes) rejectProductUpdate('UPDATE_METADATA_INVALID');
  let trusted = false;
  try {
    const key = await crypto.subtle.importKey('raw', decodeBase64(publicKey, 32), 'Ed25519', false, ['verify']);
    trusted = await crypto.subtle.verify('Ed25519', key, decodeBase64(envelope.signature, 64), bytes);
  } catch { rejectProductUpdate('UPDATE_SIGNATURE_INVALID'); }
  if (!trusted) rejectProductUpdate('UPDATE_SIGNATURE_INVALID');
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { rejectProductUpdate('UPDATE_METADATA_INVALID'); }
  return value;
}
export async function verifyProductEnvelope(envelope, publicKey = PRODUCT_UPDATE_POLICY.publicKey, now = Date.now()) {
  return validateProductRelease(await authenticateProductEnvelope(envelope, publicKey), now);
}
// Bound both metadata transfer and decompressed body size.
export async function readBoundedResponse(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) rejectProductUpdate('UPDATE_METADATA_INVALID');
  if (!response.body) rejectProductUpdate('UPDATE_METADATA_INVALID');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) rejectProductUpdate('UPDATE_METADATA_INVALID');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
