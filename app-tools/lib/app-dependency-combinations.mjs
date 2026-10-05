// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-018c

// The default remains the tested public combination. Explicitly selected
// development pairs use the same current Host, never an older template.
// Their complete tarballs and installed identities are checked separately;
// admitting a source pair here makes no publication or product-acceptance claim.

const SDK = '@nimiplatform/sdk';
const KIT = '@nimiplatform/kit';

export const ADDITIONAL_DEPENDENCY_COMBINATIONS = Object.freeze([
  Object.freeze({ sdkVersion: '^0.20.0', kitVersion: '^0.17.0', nimiShellTauriVersion: '0.9.0', source: 'existing' }),
  Object.freeze({ sdkVersion: '^0.21.0', kitVersion: '^0.18.0', nimiShellTauriVersion: '0.10.0', source: 'existing' }),
  Object.freeze({ sdkVersion: '^0.19.0', kitVersion: '^0.16.0', nimiShellTauriVersion: '0.8.0', source: 'existing' }),
]);

function isRegistrySpec(value) {
  return typeof value === 'string' && /^\^?(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u.test(value.trim()) && value.trim() === value;
}

export function defaultDependencyCombination(versions) {
  return Object.freeze({
    sdkVersion: versions.sdkVersion,
    kitVersion: versions.kitVersion,
    nimiShellTauriVersion: versions.nimiShellTauriVersion,
    source: 'default',
  });
}

function describe(combination) {
  return `${SDK}@${combination.sdkVersion} with ${KIT}@${combination.kitVersion}`;
}

// Resolves the combination an App is on from its package.json. Local,
// workspace or missing specs are not a selected combination and resolve to the
// tool default (the sync normalization target for fresh or local-only
// projects). A registry pairing must match a declared combination exactly.
export function resolveDependencyCombination(packageJson, versions) {
  const fallback = defaultDependencyCombination(versions);
  const section = packageJson?.dependencies;
  const sdk = section && typeof section === 'object' && !Array.isArray(section) ? section[SDK] : undefined;
  const kit = section && typeof section === 'object' && !Array.isArray(section) ? section[KIT] : undefined;
  if (!isRegistrySpec(sdk) || !isRegistrySpec(kit)) return fallback;
  if (sdk === fallback.sdkVersion && kit === fallback.kitVersion) return fallback;
  const selected = ADDITIONAL_DEPENDENCY_COMBINATIONS.find(pair => pair.sdkVersion === sdk && pair.kitVersion === kit);
  if (selected) return selected;
  throw new Error(`Unsupported SDK/Kit combination: ${describe({ sdkVersion: sdk, kitVersion: kit })}. Required combination: ${describe(fallback)}. Select this combination in package.json, run nimi-app sync, install dependencies, then run nimi-app check.`);
}
