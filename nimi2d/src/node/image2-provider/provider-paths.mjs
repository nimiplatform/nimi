import path from 'node:path';

function normalizeContainmentPath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function assertContainedPath(baseDir, candidatePath, pathLabel) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedCandidate = path.resolve(candidatePath);
  const relative = path.relative(
    normalizeContainmentPath(resolvedBase),
    normalizeContainmentPath(resolvedCandidate),
  );
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolvedCandidate;
  }
  throw new Error(`NIMI2D_CODEX_IMAGE2_REQUEST_INVALID: ${pathLabel} must stay inside the provider request directory.`);
}

export function resolveRequestExecutionCwd(requestPath, request) {
  const baseDir = path.dirname(path.resolve(requestPath));
  const cwd = request?.execution?.cwd;
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new Error('NIMI2D_CODEX_IMAGE2_REQUEST_INVALID: $.execution.cwd must be a non-empty string.');
  }
  const resolvedCwd = path.isAbsolute(cwd) ? path.resolve(cwd) : path.resolve(baseDir, cwd);
  return assertContainedPath(baseDir, resolvedCwd, '$.execution.cwd');
}
