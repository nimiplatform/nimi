import fs from 'node:fs';
import path from 'node:path';

function gateRunPattern(gate) {
  const escaped = String(gate).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`^v2-${escaped}-[a-f0-9]{12}-\\d+$`, 'u');
}

export function pruneOldGateEvidenceRuns(baseRoot, gate, { retainPriorRuns = 2 } = {}) {
  const removed = [];
  const failed = [];
  let entries;
  try {
    entries = fs.readdirSync(baseRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return { removed, failed };
    return { removed, failed: [{ root: baseRoot, code: error?.code || 'UNKNOWN', message: String(error?.message || error) }] };
  }

  const pattern = gateRunPattern(gate);
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !pattern.test(entry.name)) continue;
    const root = path.join(baseRoot, entry.name);
    try {
      runs.push({ root, mtimeMs: fs.statSync(root).mtimeMs });
    } catch (error) {
      failed.push({ root, code: error?.code || 'UNKNOWN', message: String(error?.message || error) });
    }
  }
  runs.sort((left, right) => right.mtimeMs - left.mtimeMs || right.root.localeCompare(left.root));
  for (const { root } of runs.slice(retainPriorRuns)) {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
      removed.push(root);
    } catch (error) {
      failed.push({ root, code: error?.code || 'UNKNOWN', message: String(error?.message || error) });
    }
  }
  return { removed, failed };
}
