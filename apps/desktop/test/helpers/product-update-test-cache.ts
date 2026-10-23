import { execFile } from 'node:child_process';
import { chmod, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DesktopProductUpdateHost } from '../../src-electron/product-update-host.js';
import { resolveWindowsPowerShell7 } from '../../../../scripts/lib/windows-powershell.mjs';

const execute = promisify(execFile);
const aclScript = fileURLToPath(new URL('./product-update-test-cache.ps1', import.meta.url));

async function windowsAcl(mode: 'prepare' | 'verify' | 'expose', target: string): Promise<void> {
  await execute(resolveWindowsPowerShell7(), ['-NoProfile', '-File', aclScript, '-Mode', mode, '-Target', target], {
    windowsHide: true,
    timeout: 30_000,
  });
}

// These controller tests use real private scratch storage. They exercise the
// download/state machine, not the installed updater's identity or UAC boundary.
export async function preparePrivateUpdateTestCache(root: string): Promise<void> {
  if (process.platform === 'win32') await windowsAcl('prepare', root);
  else await mkdir(root, { recursive: true, mode: 0o700 });
}

export async function verifyPrivateUpdateTestFile(file: string): Promise<void> {
  if (process.platform === 'win32') await windowsAcl('verify', file);
}

export async function exposeUpdateTestFile(file: string): Promise<void> {
  if (process.platform === 'win32') await windowsAcl('expose', file);
  else await chmod(file, 0o644);
}

export function createProductUpdateTestHost(input: ConstructorParameters<typeof DesktopProductUpdateHost>[0]): DesktopProductUpdateHost {
  return new DesktopProductUpdateHost({
    ...input,
    prepareCache: input.prepareCache ?? (() => preparePrivateUpdateTestCache(input.cacheRoot)),
  });
}
