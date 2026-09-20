// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-018c

// Supported SDK/Kit dependency combinations.
//
// Fresh `create` uses the tool default combination (nimiScaffoldVersions).
// An existing App keeps its current SDK/Kit combination when that pairing is
// one of the limited combinations below; sync preserves it and its matching
// glue, while the app-tools and nimi-coding tool dependencies are still
// synchronized to the selected tool version. Manifest, lock, Cargo, glue,
// build/pack and workflow checks all resolve the combination through
// `resolveDependencyCombination` so no entry point accepts an arbitrary
// SDK x Kit pairing.
//
// Evidence for each row is a shipped app-tools default matrix
// (app-tools/package.json history) whose Kit release declares the paired SDK
// range and whose Kit release commit carries the listed nimi-shell-tauri
// crate version. Add a row only with that evidence; never widen to ranges.
export const SUPPORTED_DEPENDENCY_COMBINATIONS = Object.freeze([
  Object.freeze({ sdkVersion: '^0.11.0', kitVersion: '^0.7.0', nimiShellTauriVersion: '0.3.0' }),
  Object.freeze({ sdkVersion: '^0.12.0', kitVersion: '^0.8.0', nimiShellTauriVersion: '0.4.0' }),
  Object.freeze({ sdkVersion: '^0.13.0', kitVersion: '^0.9.0', nimiShellTauriVersion: '0.5.0' }),
  Object.freeze({ sdkVersion: '^0.14.0', kitVersion: '^0.10.0', nimiShellTauriVersion: '0.6.0' }),
  Object.freeze({ sdkVersion: '^0.15.0', kitVersion: '^0.11.0', nimiShellTauriVersion: '0.6.0' }),
]);

const SDK = '@nimiplatform/sdk';
const KIT = '@nimiplatform/kit';

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
// projects). A registry pairing must match one supported combination exactly.
export function resolveDependencyCombination(packageJson, versions) {
  const fallback = defaultDependencyCombination(versions);
  const section = packageJson?.dependencies;
  const sdk = section && typeof section === 'object' && !Array.isArray(section) ? section[SDK] : undefined;
  const kit = section && typeof section === 'object' && !Array.isArray(section) ? section[KIT] : undefined;
  if (!isRegistrySpec(sdk) || !isRegistrySpec(kit)) return fallback;
  if (sdk === fallback.sdkVersion && kit === fallback.kitVersion) return fallback;
  const supported = SUPPORTED_DEPENDENCY_COMBINATIONS.find((entry) => entry.sdkVersion === sdk && entry.kitVersion === kit);
  if (!supported) {
    throw new Error(`Unsupported SDK/Kit combination: ${describe({ sdkVersion: sdk, kitVersion: kit })}. Supported combinations: ${[...SUPPORTED_DEPENDENCY_COMBINATIONS, fallback].map(describe).filter((entry, index, all) => all.indexOf(entry) === index).join('; ')}. Select one complete combination, then rerun nimi-app sync and nimi-app check.`);
  }
  return Object.freeze({ ...supported, source: 'existing' });
}
