// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-018c

// This tool's standard Host requires the current SDK/Kit combination from
// nimiScaffoldVersions. Older combinations cannot consume its Host-profile
// entrypoint. Reject them before sync writes glue; the App explicitly selects
// its new business dependencies. No legacy template or fallback is generated.

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
// projects). A registry pairing must match the current combination exactly.
export function resolveDependencyCombination(packageJson, versions) {
  const fallback = defaultDependencyCombination(versions);
  const section = packageJson?.dependencies;
  const sdk = section && typeof section === 'object' && !Array.isArray(section) ? section[SDK] : undefined;
  const kit = section && typeof section === 'object' && !Array.isArray(section) ? section[KIT] : undefined;
  if (!isRegistrySpec(sdk) || !isRegistrySpec(kit)) return fallback;
  if (sdk === fallback.sdkVersion && kit === fallback.kitVersion) return fallback;
  throw new Error(`Unsupported SDK/Kit combination: ${describe({ sdkVersion: sdk, kitVersion: kit })}. Required combination: ${describe(fallback)}. Select this combination in package.json, run nimi-app sync, install dependencies, then run nimi-app check.`);
}
