import { authenticateProductEnvelope, rejectProductUpdate, compareProductVersions } from './product-update-contract.mjs';

export const WINDOWS_PRODUCT_ROLES = Object.freeze({ desktop: 'Nimi.exe', runtime: 'runtime/nimi.exe', updater: 'NimiProductUpdater.exe' });
const SHA = /^[a-f0-9]{64}$/u;
function closed(value, keys) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).sort().join(',') !== keys.slice().sort().join(',')) rejectProductUpdate('UPDATE_COHORT_INVALID');
}
export function validateWindowsProductIdentity(value) {
  closed(value, ['schema', 'releaseId', 'version', 'channel', 'target', 'sourceRevision', 'components', 'files']);
  if (value.schema !== 'nimi-windows-product-identity/v1' || value.target !== 'windows-amd64' || value.channel !== 'beta'
    || value.releaseId !== `nimi/v${value.version}` || !/^[a-f0-9]{40}$/u.test(value.sourceRevision)) rejectProductUpdate('UPDATE_COHORT_INVALID');
  compareProductVersions(value.version, value.version);
  closed(value.components, ['desktop', 'runtime', 'avatar']);
  for (const component of Object.values(value.components)) {
    closed(component, ['version', 'sha256']); compareProductVersions(component.version, component.version);
    if (!SHA.test(component.sha256)) rejectProductUpdate('UPDATE_COHORT_INVALID');
  }
  if (!value.files || Array.isArray(value.files) || typeof value.files !== 'object' || Object.keys(value.files).length > 8192) rejectProductUpdate('UPDATE_COHORT_INVALID');
  const seen = new Set();
  for (const [name, digest] of Object.entries(value.files)) {
    // One canonical relative inventory, including every DLL/native module and
    // ASAR. Windows aliases, alternate streams and traversal are forbidden.
    if (!name || name.length > 240 || name.includes('\\') || name.includes(':') || name.startsWith('/') || !SHA.test(digest)
      || name.split('/').some((part) => !part || part === '.' || part === '..' || /[ .]$/u.test(part) || /[\x00-\x1f<>"|?*]/u.test(part)
        || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))
      || seen.has(name.toLowerCase())) rejectProductUpdate('UPDATE_COHORT_INVALID');
    seen.add(name.toLowerCase());
  }
  for (const file of [...Object.values(WINDOWS_PRODUCT_ROLES), 'resources/app.asar']) if (!SHA.test(value.files[file] ?? '')) rejectProductUpdate('UPDATE_COHORT_INVALID');
  if (value.files['resources/app.asar'] !== value.components.desktop.sha256 || value.files[WINDOWS_PRODUCT_ROLES.runtime] !== value.components.runtime.sha256) rejectProductUpdate('UPDATE_COHORT_INVALID');
  return value;
}
// Installation identity is durable publisher admission, not time-limited
// permission to start another install. Update envelopes retain freshness.
export async function verifyWindowsProductIdentity(envelope, publicKey) {
  return validateWindowsProductIdentity(await authenticateProductEnvelope(envelope, publicKey));
}
