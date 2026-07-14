import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function resolvePortableProcessInvocation(command, args, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32' && command === 'pnpm') {
    const pnpmCliPath = options.pnpmCliPath || discoverWindowsPnpmCli();
    return {
      command: process.execPath,
      args: [pnpmCliPath, ...args],
    };
  }
  return { command, args };
}

function discoverWindowsPnpmCli() {
  const explicit = String(process.env.NIMI_PNPM_CLI || '').trim();
  if (explicit) {
    if (!isFile(explicit)) throw new Error(`NIMI_PNPM_CLI is not a file: ${explicit}`);
    return explicit;
  }
  const shims = execFileSync('where.exe', ['pnpm.cmd'], { encoding: 'utf8' })
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
  for (const shim of shims) {
    const source = fs.readFileSync(shim, 'utf8');
    const match = source.match(/%dp0%[\\/]([^"\r\n]*pnpm\.cjs)/iu);
    if (!match?.[1]) continue;
    const candidate = path.resolve(path.dirname(shim), match[1]);
    if (isFile(candidate)) return candidate;
  }
  throw new Error('pnpm.cmd was found but its pnpm.cjs target could not be resolved');
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}
