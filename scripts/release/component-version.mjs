import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function requireComponentVersion(version, candidate = process.env.GITHUB_EVENT_NAME === 'pull_request') {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.(0|[1-9]\d*))?$/u.exec(version);
  if (!match || (match[4] !== undefined && !candidate)) {
    throw new Error(`Invalid component version ${version} for ${candidate ? 'candidate' : 'stable'} packaging`);
  }
  return version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  requireComponentVersion(process.argv[2]);
}
