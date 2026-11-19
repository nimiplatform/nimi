// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-018c
import { gt, intersects, minVersion, satisfies, subset, valid, validRange } from 'semver';

// The manifest names the tested candidate/default combination. Explicitly selected
// development pairs use the same current Host, never an older template.
// Their complete tarballs and installed identities are checked separately;
// admitting a source pair here makes no publication or product-acceptance claim.

const SDK = '@nimiplatform/sdk';
const KIT = '@nimiplatform/kit';

export const ADDITIONAL_DEPENDENCY_COMBINATIONS = Object.freeze([
  Object.freeze({ sdkVersion: '^0.24.0-rc.2', kitVersion: '^0.24.0-rc.1', nimiShellTauriVersion: '0.12.0', source: 'existing' }),
  Object.freeze({ sdkVersion: '^0.22.2', kitVersion: '^0.22.1', nimiShellTauriVersion: '0.11.1', source: 'existing' }),
  Object.freeze({ sdkVersion: '^0.22.1', kitVersion: '^0.22.1', nimiShellTauriVersion: '0.11.1', source: 'existing' }),
  Object.freeze({ sdkVersion: '^0.22.1', kitVersion: '^0.22.0', nimiShellTauriVersion: '0.11.0', source: 'existing' }),
  Object.freeze({ sdkVersion: '^0.22.0', kitVersion: '^0.22.0', nimiShellTauriVersion: '0.11.0', source: 'existing' }),
  Object.freeze({ sdkVersion: '^0.21.0', kitVersion: '^0.21.0', nimiShellTauriVersion: '0.10.0', source: 'existing' }),
  Object.freeze({ sdkVersion: '^0.21.0', kitVersion: '^0.20.0', nimiShellTauriVersion: '0.10.0', source: 'existing' }),
  Object.freeze({ sdkVersion: '^0.21.0', kitVersion: '^0.19.0', nimiShellTauriVersion: '0.10.0', source: 'existing' }),
  Object.freeze({ sdkVersion: '^0.21.0', kitVersion: '^0.18.1', nimiShellTauriVersion: '0.10.0', source: 'existing' }),
  Object.freeze({ sdkVersion: '^0.21.0', kitVersion: '^0.18.0', nimiShellTauriVersion: '0.10.0', source: 'existing' }),
  Object.freeze({ sdkVersion: '^0.20.0', kitVersion: '^0.17.0', nimiShellTauriVersion: '0.9.0', source: 'existing' }),
  Object.freeze({ sdkVersion: '^0.18.1', kitVersion: '^0.15.3', nimiShellTauriVersion: '0.7.0', source: 'existing' }),
  Object.freeze({ sdkVersion: '^0.19.0', kitVersion: '^0.16.0', nimiShellTauriVersion: '0.8.0', source: 'existing' }),
]);

export function isLocalDependencySpec(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return /^(?:file|link|patch|path|portal|workspace):/iu.test(normalized)
    || /^(?:\.{1,2}[\\/]|~[\\/]|[A-Za-z]:[\\/]|\\\\)/u.test(normalized)
    || /\.(?:tar\.gz|tgz)(?:[?#].*)?$/iu.test(normalized);
}

// The released CLI may be a later patch selected by the project's bounded range.
export function appToolsDeclaration(declared, toolRange) {
  if (declared === toolRange) return declared;
  const minimum = typeof declared === 'string' && validRange(declared) && minVersion(declared);
  const running = minVersion(toolRange);
  if (minimum && running && gt(minimum, running)) {
    throw new Error(`This App requires app-tools ${declared}. Install the selected tool before running init, sync or check.`);
  }
  return minimum && running && (valid(declared) || subset(declared, '^' + minimum.version)) && satisfies(running, declared)
    ? declared : toolRange;
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

// semver's range intersection can reject a prerelease pin that satisfies the range.
function selectionsOverlap(recorded, selected) {
  const selectedPin = valid(validRange(selected));
  if (selectedPin) return satisfies(selectedPin, recorded);
  const recordedPin = valid(validRange(recorded));
  if (recordedPin) return satisfies(recordedPin, selected);
  return intersects(recorded, selected);
}

export function matchesRecordedHostDependencies(npm, combination) {
  return selectionsOverlap(npm[SDK], combination.sdkVersion)
    && selectionsOverlap(npm[KIT], combination.kitVersion);
}

// Some rows share a minor line but select different native crates. Match each
// declaration to its most specific admitted floor, then validate the pair.
function matchingLine(spec, lines) {
  const range = typeof spec === 'string' && validRange(spec);
  if (!range || !minVersion(range)) return undefined;
  const pin = valid(range);
  let best;
  for (const line of new Set(lines)) {
    const admitted = pin ? satisfies(pin, line) : subset(range, line);
    if (admitted && (!best || gt(minVersion(line), minVersion(best)))) best = line;
  }
  return best;
}

export function resolveDependencyCombination(packageJson, versions) {
  const fallback = defaultDependencyCombination(versions);
  const section = packageJson?.dependencies;
  const declaredSdk = section?.[SDK];
  const declaredKit = section?.[KIT];
  const sdk = declaredSdk === undefined || isLocalDependencySpec(declaredSdk) ? fallback.sdkVersion : declaredSdk;
  const kit = declaredKit === undefined || isLocalDependencySpec(declaredKit) ? fallback.kitVersion : declaredKit;
  if (sdk === fallback.sdkVersion && kit === fallback.kitVersion) return fallback;
  const pairs = [fallback, ...ADDITIONAL_DEPENDENCY_COMBINATIONS];
  const sdkLine = matchingLine(sdk, pairs.map(pair => pair.sdkVersion));
  const kitLine = matchingLine(kit, pairs.map(pair => pair.kitVersion));
  const selected = pairs.find(pair => pair.sdkVersion === sdkLine && pair.kitVersion === kitLine);
  if (selected) return { ...selected, sdkVersion: sdk, kitVersion: kit };
  throw new Error(`Unsupported SDK/Kit combination: ${describe({ sdkVersion: sdk, kitVersion: kit })}. Select a verified pair explicitly before sync. Tool default: ${describe(fallback)}.`);
}
