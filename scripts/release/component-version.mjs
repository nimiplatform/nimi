import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function requireComponentVersion(version, candidate = process.env.GITHUB_EVENT_NAME === 'pull_request' || process.env.NIMI_NPM_RELEASE_RC === 'true') {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/u.exec(version);
  if (!match || (match[4] !== undefined && !candidate)) {
    throw new Error(`Invalid component version ${version} for ${candidate ? 'candidate' : 'stable'} packaging`);
  }
  return version;
}

export function npmPublicationTag(version, stableTag = 'latest') {
  requireComponentVersion(version, true);
  if (!['latest', 'maintenance-0.12'].includes(stableTag)) throw new Error('Unsupported npm distribution tag');
  return version.includes('-rc.') ? 'pre' : stableTag;
}

export function npmDependencyFloor(ownerVersion, range) {
  requireComponentVersion(ownerVersion, true);
  if (!range?.startsWith('^')) throw new Error('Expected a component caret range');
  return requireComponentVersion(range.slice(1), ownerVersion.includes('-rc.'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [option, value, range] = process.argv.slice(2);
  if (option === '--npm-tag') {
    const manifest = JSON.parse(readFileSync(value, 'utf8'));
    console.log(npmPublicationTag(manifest.version, manifest.publishConfig?.tag));
  } else if (option === '--dependency-floor') {
    console.log(npmDependencyFloor(value, range));
  } else {
    requireComponentVersion(option);
  }
}
