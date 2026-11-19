import { minVersion, satisfies, valid, validRange } from 'semver';

// Patched release lines used by Nimi Apps. Vite GHSA-p4f5-76q4-ffq7
// and Electron's Chromium backports have separate fixes on maintained lines.
const fixes = {
  vite: [
    ['>=8.3.0 <8.3.7', '8.3.7'], ['>=8.2.0 <8.2.5', '8.2.5'],
    ['>=8 <8.1.7', '8.1.7'], ['>=7 <7.3.8', '7.3.8'], ['>=4 <6.4.6', '6.4.6'],
  ],
  electron: [
    ['>=45 <45.4.1', '45.4.1'], ['>=44 <44.11.5', '44.11.5'], ['>=43 <43.8.12', '43.8.12'],
  ],
};

export function lockedRegistryVersion(entry) {
  return typeof entry?.version === 'string' ? valid(entry.version.split('(')[0]) : null;
}

// Sync can raise a conventional range within its existing bounds. An exact
// vulnerable pin or a custom range remains an explicit publisher decision.
export function planToolchainUpdates(pkg, importer, versions) {
  const updates = [];
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, releases] of Object.entries(fixes)) {
      const from = pkg[section]?.[name];
      if (typeof from !== 'string') continue;
      const entry = importer?.[section]?.[name];
      const locked = lockedRegistryVersion(entry);
      const minimum = validRange(from) && minVersion(from);
      const affected = releases.find(([range]) => minimum && satisfies(minimum, range));
      const lockedFix = releases.find(([range]) => locked && satisfies(locked, range));
      if (!affected && !lockedFix) continue;
      const fixedVersion = (lockedFix || affected)[1];
      const preferred = minVersion(versions[name + 'Version'])?.version;
      const recommended = [preferred, fixedVersion].find(version => version && satisfies(version, from)
        && !releases.some(([range]) => satisfies(version, range)));
      const operator = from.match(/^([~^])\d+\.\d+\.\d+$/u)?.[1];
      const to = affected && operator && recommended ? operator + recommended : from;
      const alreadyPatched = locked && !lockedFix && satisfies(locked, from);
      updates.push({ section, name, from, to, locked, lockedAffected: Boolean(lockedFix),
        fixedVersion, manual: !recommended && !alreadyPatched });
    }
  }
  return updates;
}
