import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORPUS = '.nimi/spec';
const CLI = path.join(repoRoot, 'node_modules', '@nimiplatform', 'nimi-coding', 'bin', 'nimicoding.mjs');

// Checks that used to assert a sentence appears in an authority container ask
// this instead: does the exact unit exist, is it active, and does it carry the
// relations the boundary depends on. That is a claim about compiled authority
// rather than about the prose someone happened to write, so rewording a
// statement no longer breaks the gate and deleting the unit still does.
export function queryAuthorityUnit(unitId) {
  let stdout;
  try {
    // The CLI entry directly rather than through pnpm exec: a nested pnpm run
    // does not resolve the binary and every query would report the unit absent.
    stdout = execFileSync(
      process.execPath,
      [CLI, 'authority', 'query', CORPUS, unitId, '--max-bytes', '2000000', '--json'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch {
    return null;
  }
  try {
    const report = JSON.parse(stdout);
    return report.ok ? report.packet : null;
  } catch {
    return null;
  }
}

// Returns one failure string per unit that is absent or not active.
export function requireActiveUnits(label, unitIds) {
  const failures = [];
  for (const unitId of unitIds) {
    const packet = queryAuthorityUnit(unitId);
    if (packet === null) {
      failures.push(`${label}: authority unit ${unitId} is not present in ${CORPUS}`);
      continue;
    }
    const lifecycle = packet.unit?.lifecycle ?? packet.lifecycle;
    if (lifecycle !== undefined && lifecycle !== 'active') {
      failures.push(`${label}: authority unit ${unitId} is ${lifecycle}, not active`);
    }
  }
  return failures;
}
