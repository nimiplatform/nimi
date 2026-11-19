#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectCiScope } from './lib/ci-scope.mjs';
import { selectDocsReview } from './lib/docs-source.mjs';

function isCommitOid(value) {
  return /^[a-f0-9]{40}$/u.test(value || '') && !/^0+$/u.test(value);
}

export function detectCiScope({ repoRoot = process.cwd(), eventName, baseSha, headSha }) {
  if (!['pull_request', 'push', 'workflow_dispatch'].includes(eventName)) {
    throw new Error('unsupported CI event');
  }
  if (!isCommitOid(headSha)) throw new Error('CI comparison head is unavailable');
  const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  const full = eventName === 'workflow_dispatch';
  // Manual full runs compare the selected commit with its first parent, never
  // with a moving branch name or with the selected commit itself.
  const comparisonBase = full ? git(['rev-parse', '--verify', `${headSha}^1`]).trim() : baseSha;
  if (!isCommitOid(comparisonBase) || comparisonBase === headSha) {
    throw new Error('CI comparison base is unavailable or equals the head');
  }
  // GitHub can refresh the test merge while the PR payload still names an
  // earlier base. Route the merged tree's delta; retain the event base for
  // authority history review.
  let changedFilesBase = comparisonBase;
  if (eventName === 'pull_request') {
    const parents = git(['show', '-s', '--format=%P', headSha]).trim().split(' ');
    if (parents.length !== 2) throw new Error('PR path selection requires the tested merge commit');
    git(['rev-parse', '--verify', `${comparisonBase}^{commit}`]);
    changedFilesBase = parents[0];
  }
  const files = full ? [] : git(['diff', '--no-renames', '--name-only', '-z', changedFilesBase, headSha]).split('\0').filter(Boolean);
  const docsReview = selectDocsReview(repoRoot, files);
  return { comparison_base_sha: comparisonBase, changed_files_base_sha: changedFilesBase, docs_review_targets: docsReview, ...selectCiScope(files, { full, docsReviewTargets: docsReview }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { EVENT_NAME, BASE_SHA, HEAD_SHA, GITHUB_OUTPUT } = process.env;
  const scope = detectCiScope({ eventName: EVENT_NAME, baseSha: BASE_SHA, headSha: HEAD_SHA });
  for (const [key, value] of Object.entries(scope)) {
    appendFileSync(GITHUB_OUTPUT, `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
  }
  console.log(scope);
}
