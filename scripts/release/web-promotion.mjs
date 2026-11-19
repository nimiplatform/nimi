import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webBuildInputsChanged } from '../lib/ci-scope.mjs';

export function canPromoteWebBuild({ event, sourceSha, securitySha, repoRoot = process.cwd() }) {
  if (!['push', 'workflow_dispatch'].includes(event)) throw new Error('Unsupported Web promotion event');
  if (!/^[a-f0-9]{40}$/u.test(sourceSha ?? '') || sourceSha !== securitySha) {
    throw new Error('Web build and successful security checks must identify the same commit');
  }
  const git = args => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const main = git(['rev-parse', '--verify', 'refs/remotes/origin/main']).trim();
  git(['merge-base', '--is-ancestor', sourceSha, main]);
  if (event === 'workflow_dispatch') return true;
  const paths = git(['diff', '--name-only', '--no-renames', '-z', sourceSha, main]).split('\0').filter(Boolean);
  return !webBuildInputsChanged(paths);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const current = canPromoteWebBuild({
    event: process.env.GITHUB_EVENT_NAME,
    sourceSha: process.env.SOURCE_SHA,
    securitySha: process.env.SECURITY_SHA,
  });
  if (!current) console.log('A newer main revision changed the Web build inputs. Skipping production promotion.');
  appendFileSync(process.env.GITHUB_OUTPUT, `current=${current}\n`);
}
