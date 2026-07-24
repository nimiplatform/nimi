import fs from 'node:fs';
import path from 'node:path';

export function resolveBinaryOnPath(name, env = process.env, platform = process.platform) {
  if (typeof name !== 'string' || name.length === 0) return false;
  const pathSeparator = platform === 'win32' ? ';' : ':';
  const pathValue = readPathEnv(env);
  const pathEntries = pathValue
    .split(pathSeparator)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const executableNames = candidateExecutableNames(name, env, platform);
  const hasPathSeparator = /[\\/]/.test(name);

  const candidates = [];
  if (hasPathSeparator || pathEntries.length === 0) {
    candidates.push(...executableNames);
  } else {
    for (const dir of pathEntries) {
      for (const executableName of executableNames) {
        candidates.push(path.join(dir, executableName));
      }
    }
  }

  for (const candidate of candidates) {
    if (isExecutableFile(candidate, platform)) return candidate;
  }
  return null;
}

function readPathEnv(env) {
  if (typeof env.PATH === 'string') return env.PATH;
  if (typeof env.Path === 'string') return env.Path;
  if (typeof env.path === 'string') return env.path;
  return '';
}

function candidateExecutableNames(name, env, platform) {
  if (platform !== 'win32') return [name];
  if (path.extname(name).length > 0) return [name];
  const pathext = typeof env.PATHEXT === 'string' && env.PATHEXT.length > 0
    ? env.PATHEXT
    : '.COM;.EXE;.BAT;.CMD';
  return pathext
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .flatMap((entry) => {
      const ext = entry.startsWith('.') ? entry : `.${entry}`;
      return [`${name}${ext.toLowerCase()}`, `${name}${ext.toUpperCase()}`];
    });
}

function isExecutableFile(candidate, platform) {
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) return false;
    fs.accessSync(
      candidate,
      platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK
    );
    return true;
  } catch {
    return false;
  }
}

