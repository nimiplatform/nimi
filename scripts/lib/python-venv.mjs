import path from 'node:path';

export function resolvePythonVenvExecutable(venvRoot, platform = process.platform) {
  if (typeof venvRoot !== 'string' || venvRoot.length === 0) {
    throw new Error('python virtual environment root is required');
  }
  if (platform === 'win32') {
    return path.win32.join(venvRoot, 'Scripts', 'python.exe');
  }
  return path.posix.join(venvRoot, 'bin', 'python3');
}

export function resolveSystemPythonCommand(platform = process.platform) {
  return platform === 'win32' ? 'python' : 'python3';
}
