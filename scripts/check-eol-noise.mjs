import { execFileSync, spawnSync } from 'node:child_process';

function getArgFlag(flag) {
  return process.argv.slice(2).includes(flag);
}

function runGit(args) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function hasGitDiff(args) {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    stdio: 'ignore',
  });
  if (result.status === 0) {
    return false;
  }
  if (result.status === 1) {
    return true;
  }
  const suffix = result.error ? ` (${result.error.message})` : '';
  throw new Error(
    `git ${args.join(' ')} failed with status ${result.status ?? 'unknown'}${suffix}`,
  );
}

function listChangedFiles(staged) {
  const args = staged
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR']
    : ['diff', '--name-only', '--diff-filter=ACMR'];
  const output = runGit(args);
  if (!output) {
    return [];
  }
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function detectNoiseForFile(file) {
  const kinds = [];

  const hasStagedAny = hasGitDiff(['diff', '--cached', '--quiet', '--', file]);
  const hasStagedSemantic = hasGitDiff(['diff', '--cached', '--ignore-cr-at-eol', '--quiet', '--', file]);
  if (hasStagedAny && !hasStagedSemantic) {
    kinds.push('staged');
  }

  const hasUnstagedAny = hasGitDiff(['diff', '--quiet', '--', file]);
  const hasUnstagedSemantic = hasGitDiff(['diff', '--ignore-cr-at-eol', '--quiet', '--', file]);
  if (hasUnstagedAny && !hasUnstagedSemantic) {
    kinds.push('unstaged');
  }

  if (kinds.length === 0) {
    return null;
  }
  return { file, kinds };
}

function formatRestoreHint(entry) {
  if (entry.kinds.length === 2) {
    return `git restore --staged --worktree -- ${shellQuote(entry.file)}`;
  }
  if (entry.kinds[0] === 'staged') {
    return `git restore --staged -- ${shellQuote(entry.file)}`;
  }
  return `git restore --worktree -- ${shellQuote(entry.file)}`;
}

function main() {
  const stagedOnly = getArgFlag('--staged-only');
  const quietSuccess = getArgFlag('--quiet-success');
  const files = stagedOnly
    ? listChangedFiles(true)
    : Array.from(new Set([...listChangedFiles(false), ...listChangedFiles(true)])).sort();

  const entries = files
    .map((file) => detectNoiseForFile(file))
    .filter((entry) => entry !== null)
    .filter((entry) => !stagedOnly || entry.kinds.includes('staged'));

  if (entries.length === 0) {
    if (!quietSuccess) {
      process.stdout.write('[check:eol-noise] No pure EOL-only tracked changes detected.\n');
    }
    return;
  }

  process.stdout.write(
    '[check:eol-noise] Found tracked files whose diff disappears with --ignore-cr-at-eol:\n',
  );
  for (const entry of entries) {
    process.stdout.write(`- ${entry.file} [${entry.kinds.join(', ')}]\n`);
    process.stdout.write(`  restore: ${formatRestoreHint(entry)}\n`);
  }
  process.stdout.write(
    '\n[check:eol-noise] These are usually CRLF/LF-only changes. Review before staging or committing.\n',
  );
  process.exitCode = 1;
}

main();
